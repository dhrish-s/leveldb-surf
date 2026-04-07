# Week 4 Notes — Benchmarking and Performance Optimization
# File: project/notes/week4_notes.md


---

## Goal

Measure SuRF performance against Bloom filter baseline. Identify and fix
performance issues. Demonstrate SuRF's range filter advantage on the correct
workload.

---

## filter_block.cc Fix — Single Filter Per SSTable

### The 2KB Problem (Deferred From Week 2, Fixed Week 4)

`FilterBlockBuilder::StartBlock()` calls `GenerateFilter()` every 2KB of data.
This creates many small SuRF tries per SSTable — one per 2KB chunk with only
10-50 keys each.

**Why this was catastrophic:**
SuRF's `LoudsDense` and `LoudsSparse` internal structures require a minimum
number of keys to produce valid serialized bytes. With 10-50 keys, the trie
is so small that `deSerialize()` crashes with a segfault or FPE when the
`uint64_t*` cast encounters misaligned or invalid data.

**The fix — `filter_block.cc`:**

`StartBlock()` changed to do nothing (no longer calls `GenerateFilter`):
```cpp
void FilterBlockBuilder::StartBlock(uint64_t block_offset) {
  uint64_t filter_index = (block_offset / kFilterBase);
  assert(filter_index >= filter_offsets_.size());
  (void)filter_index;  // suppress unused warning
}
```

`Finish()` changed to build ONE filter from ALL buffered keys:
```cpp
Slice FilterBlockBuilder::Finish() {
  if (!start_.empty()) {
    GenerateFilter();  // called ONCE with all keys
  }

  // Empty SSTable: write original format so reader returns true (safe fallback)
  if (result_.empty()) {
    PutFixed32(&result_, 0);
    result_.push_back(kFilterBaseLg);
    return Slice(result_);
  }

  // Single-filter format: base_lg_=32 forces all blocks to map to index 0
  // block_offset >> 32 = 0 for any offset < 4GB
  // FilterBlockReader always finds filter[0] for every block
  const uint32_t array_offset = result_.size();
  PutFixed32(&result_, 0);             // entry[0]: filter starts at byte 0
  PutFixed32(&result_, array_offset);  // sentinel: filter ends here
  PutFixed32(&result_, array_offset);  // footer: offset table location
  result_.push_back(32);               // base_lg_ = 32
  return Slice(result_);
}
```

**Why `base_lg_ = 32`:**
`FilterBlockReader::KeyMayMatch` uses `block_offset >> base_lg_` to find
which filter to use for a given block. With `base_lg_ = 32`, any
`block_offset < 4GB` maps to index 0. All blocks use the same single filter.
No changes needed to `FilterBlockReader`.

**`filter_block_test.cc` updates:**
- `EmptyBuilder`: expected bytes stay as `\x00\x00\x00\x00\x0b` because the
  empty case uses the original format (safe fallback)
- `MultiChunk`: updated to expect ALL keys visible from ALL offsets — correct
  behavior for a single combined filter. Previously tested per-block isolation
  which was Bloom-specific behavior

---

## The Alignment Bug — Why `deSerialize` Crashed

`SuRF::deSerialize(char* src)` internally casts `src` to `uint64_t*`:
```cpp
uint64_t* data = reinterpret_cast<uint64_t*>(src);
```

This requires 8-byte alignment. `filter.data()` points into LevelDB's block
cache memory which may not be 8-byte aligned. Misaligned `uint64_t*` read
causes SIGFPE or SIGSEGV on some architectures.

**Fix in `surf_filter.cc`:**
Copy filter bytes to a `std::string` before calling `deSerialize`:
```cpp
std::string buf(filter.data(), filter.size());
char* src = &buf[0];
surf::SuRF* surf_obj = surf::SuRF::deSerialize(src);
```

`std::string` guarantees proper alignment for its internal buffer.

---

## Performance Problem — Per-Call Deserialization

Even with the alignment fix, `readrandom` was 17x slower than Bloom:
- Every `KeyMayMatch` call: allocate `std::string` (42KB), copy, deserialize
  full SuRF trie, lookup, destroy
- Bloom: 2 hash operations, check 2 bits — nanoseconds
- SuRF per-call: microseconds

**Fix — `thread_local` cache in `surf_filter.cc`:**
```cpp
thread_local const char* last_filter_ptr = nullptr;
thread_local surf::SuRF* cached_surf = nullptr;

if (filter.data() != last_filter_ptr) {
  // Different SSTable — rebuild cache
  if (cached_surf != nullptr) { cached_surf->destroy(); delete cached_surf; }
  std::string buf(filter.data(), filter.size());
  char* src = &buf[0];
  cached_surf = surf::SuRF::deSerialize(src);
  last_filter_ptr = filter.data();
}
return cached_surf->lookupKey(key.ToString());
```

**Why pointer comparison works:**
`filter.data()` points into LevelDB's block cache. As long as the same
SSTable's filter block is cached, the pointer is stable. Different SSTables
have different pointers. This is a cheap pointer comparison — O(1) vs O(42KB
copy) for cache hits.

**Why `thread_local`:**
Multiple threads may access the same filter concurrently. Each thread gets
its own cached SuRF object — no mutex needed. Thread-safe by design.

---

## ODR Violation — surf.hpp Header-Only Problem

**Attempt:** Cache `surf::SuRF*` in `Table::Rep` struct in `table.cc`.

**Problem:** `surf/surf.hpp` is a header-only library. Including it in
`table.cc` caused `multiple definition` linker errors because every `.cc`
file that includes `table.h` (which included `surf.hpp`) gets its own copy
of all SuRF function definitions. The linker sees hundreds of duplicate
symbols.

**Root cause discovered:**
`table.h` accidentally had `#include "surf/surf.hpp"` added. This caused the
entire problem — `table.h` is included by almost every `.cc` file in LevelDB
(`version_set.cc`, `table_cache.cc`, `db_impl.cc`, `builder.cc`, etc.), so
all of them pulled in `surf.hpp` and the linker found SuRF functions defined
in every compilation unit.

**Fix:** Remove `#include "surf/surf.hpp"` from `table.h`. SuRF include
belongs only in `surf_filter.cc`.

The caching in `Table::Rep` was abandoned. The `thread_local` approach in
`surf_filter.cc` is the correct solution.

---

## db_bench.cc Change

Line ~524 changed from:
```cpp
filter_policy_(FLAGS_bloom_bits >= 0
                   ? NewBloomFilterPolicy(FLAGS_bloom_bits)
                   : nullptr),
```
To:
```cpp
filter_policy_(NewSuRFFilterPolicy()),
```

SuRF is always used regardless of `--bloom_bits` flag.

---

## `surfscan` Benchmark — Wiring `lo/hi` Through `db_impl.cc`

### The Problem

`db_bench seekrandom` never calls `RangeMayMatch`. Here is why:

`DBImpl::NewInternalIterator()` calls:
```cpp
versions_->current()->AddIterators(options, &list);
```

`lo` and `hi` are empty `Slice()` — the default. `AddIterators` receives empty
bounds, passes empty bounds to `GetFileIterator`, which passes empty bounds to
`TableCache::NewIterator`. The guard `if (!lo.empty() && !hi.empty())` is
never triggered. `RangeMayMatch` is never called.

### Fix 1 — `include/leveldb/options.h`

Added `lo` and `hi` fields to `ReadOptions`:
```cpp
struct ReadOptions {
  bool verify_checksums = false;
  bool fill_cache = true;
  const Snapshot* snapshot = nullptr;

  // SuRF: optional range bounds for range scan filter optimization
  Slice lo;
  Slice hi;
};
```

Also added `#include "leveldb/slice.h"` to `options.h` — `Slice` was not
previously included there and the compiler could not find the type.

### Fix 2 — `db/db_impl.cc`

Changed line 1097 in `NewInternalIterator`:
```cpp
// Before:
versions_->current()->AddIterators(options, &list);

// After:
versions_->current()->AddIterators(options, &list, options.lo, options.hi);
```

This one line change activates the entire range filter chain when a caller
sets `options.lo` and `options.hi`.

### Fix 3 — `benchmarks/db_bench.cc`

Added `SuRFRangeScan` benchmark that sets explicit `lo/hi` bounds:
```cpp
void SuRFRangeScan(ThreadState* thread) {
  ReadOptions options;
  KeyBuffer lo_key;
  KeyBuffer hi_key;

  for (int i = 0; i < reads_; i++) {
    // Query range ABOVE all inserted keys — guaranteed empty ranges
    const int k = FLAGS_num + thread->rand.Uniform(FLAGS_num);
    lo_key.Set(k);
    const int hi_k = k + 10;
    hi_key.Set(hi_k);

    // Set lo/hi — activates RangeMayMatch in AddIterators
    options.lo = lo_key.slice();
    options.hi = hi_key.slice();

    Iterator* iter = db_->NewIterator(options);
    iter->Seek(lo_key.slice());
    // scan loop...
    delete iter;
    thread->stats.FinishedSingleOp();
  }
}
```

Registered as `surfscan` in the benchmark dispatcher.

---

## Benchmark Results

### Baseline (Bloom filter, 1M keys, March 2026)
```
seekrandom : 4.317 µs/op
readrandom : 3.691 µs/op
readseq    : 0.213 µs/op
fillrandom : 3.953 µs/op
```

### SuRF — Standard Benchmarks (1M keys)
```
fillrandom : 4.653 µs/op   (18% slower — trie build cost)
seekrandom : 10.781 µs/op  (2.5x slower — KeyMayMatch cost, no RangeMayMatch triggered)
readrandom : 5.606 µs/op   (52% slower — thread_local cache helps but SuRF still heavier)
readseq    : 0.245 µs/op   (15% slower — nearly identical, sequential scan unaffected)
```

### SuRF — surfscan benchmark (empty ranges, 1M keys)
```
Bloom surfscan: 2.102 µs/op  (0 keys found)
SuRF  surfscan: 1.420 µs/op  (0 keys found)
SuRF is 32% faster
```

---

## Why SuRF Wins On surfscan

Query range is set ABOVE all inserted keys (keys 0..999999, queries from
1000000 onward). Every range is empty — no key exists there.

```
Bloom: cannot answer range queries
  Must open every candidate SSTable
  Check each data block
  Conclude: nothing found
  Cost: full SSTable traversal per query

SuRF: lookupRange(lo, hi) → false immediately
  Skips SSTable entirely
  No data block reads
  Cost: one trie traversal per SSTable
  Result: 0 keys found (correct, no false negatives)
```

The 0 keys scanned is NOT a bug — it is proof the filter is working
correctly. The ranges genuinely have no keys, and SuRF never lied about it.

---

## Why seekrandom Does Not Show SuRF's Advantage

`db_bench seekrandom`:
```cpp
Iterator* iter = db_->NewIterator(options);  // options has no lo/hi
iter->Seek(key);
```

`options.lo` and `options.hi` are empty `Slice()`. The entire range filter
chain is bypassed. SuRF's `RangeMayMatch` is never called. Only
`KeyMayMatch` is called (point query path), where SuRF is inherently slower
than Bloom due to trie traversal cost.

---

## The Core Trade-off

```
SuRF wins when:  range queries with HIGH MISS RATE (empty ranges)
                 Many candidate SSTables have no keys in [lo, hi]
                 SuRF skips them; Bloom cannot

Bloom wins when: point queries, hit-heavy workloads, small datasets
                 Simple bit array + hash = nanosecond check
                 SuRF trie traversal is more expensive per lookup
```

This matches the SIGMOD 2018 paper which tested SuRF on datasets LARGER
than memory with many empty range queries — exactly the conditions where
SuRF's SSTable skipping saves disk I/O.

---

## rebuild.sh Changes (Week 4)

Added copy rules for new files:
```bash
cp project/filter_block.cc  → table/filter_block.cc
cp project/filter_block_test.cc → table/filter_block_test.cc
cp project/table.h          → include/leveldb/table.h
cp project/table.cc         → table/table.cc
cp project/table_cache.h    → db/table_cache.h
cp project/db_bench.cc      → benchmarks/db_bench.cc
cp project/db_impl.cc       → db/db_impl.cc
cp project/options.h        → include/leveldb/options.h
```