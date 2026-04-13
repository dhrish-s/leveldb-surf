# LevelDB + SuRF: Range Query Filter Extension


**Repository:** github.com/dhrish-s/leveldb-surf

---

## Why This Project Exists — The Real-World Problem

LevelDB is a key-value store built on a Log-Structured Merge Tree (LSM-tree). It powers Google Chrome (IndexedDB backend), Bitcoin Core (UTXO storage), and Minecraft (world chunk storage). Every SSTable (sorted immutable file on disk) has a **Bloom filter** attached to it. A Bloom filter can answer one question:

> "Is this exact key possibly in this file?"

It **cannot** answer range queries like:

> "Does any key between `dog` and `lion` exist in this file?"

This means when you run a range scan, LevelDB opens **every** SSTable whose key-range overlaps your query — even if that file contains zero keys in your range. Every opened SSTable means reading data blocks from disk. That is wasted I/O.

**Real-world impact:** Applications that rely on range scans — time-series databases querying a time window, blockchain nodes scanning transaction ranges, game engines loading world regions — all pay this penalty on every query. The more SSTables that pass the coarse key-range overlap check but contain no actual keys in the queried range, the more I/O is wasted.

**Our fix:** We replaced the Bloom filter with **SuRF (Succinct Range Filter)** — a compressed trie data structure from the SIGMOD 2018 Best Paper that can answer both point queries and range queries. When SuRF says "no key exists in [lo, hi]", LevelDB skips reading that SSTable's data blocks entirely. The original paper demonstrated up to 5x improvement in range query performance in RocksDB using SuRF.

---

## Results Summary

All benchmarks run with 1,000,000 keys, 16-byte keys, 100-byte values.

### Standard Benchmarks — Bloom vs SuRF

| Benchmark    | Bloom (baseline) | SuRF         | Change  | Why                                              |
|--------------|------------------|--------------|---------|--------------------------------------------------|
| fillrandom   | 3.953 µs/op      | 4.653 µs/op  | +18%    | SuRF trie build is more expensive than Bloom hash |
| seekrandom   | 4.317 µs/op      | 10.781 µs/op | +150%   | RangeMayMatch not triggered (no lo/hi set)        |
| readrandom   | 3.691 µs/op      | 5.606 µs/op  | +52%    | SuRF deserialization costlier than Bloom lookup    |
| readseq      | 0.213 µs/op      | 0.245 µs/op  | +15%    | Minimal overhead on sequential access              |

SuRF is larger and more complex than Bloom — point queries and sequential reads are expected to be slower. The advantage is in range scans on miss-heavy workloads, which Bloom cannot optimize at all.

### Range Scan Benchmark — The Key Result (`surfscan`)

| Filter | surfscan (empty ranges) | Keys Found |
|--------|------------------------|------------|
| Bloom  | 2.102 µs/op            | 0          |
| SuRF   | 1.420 µs/op            | 0          |

**SuRF is 32% faster than Bloom on empty-range scans.**

0 keys found confirms correctness — all queried ranges are above the inserted key space, so there are genuinely no matching keys (no false negatives).

**Why `seekrandom` does not show an advantage:** The standard `seekrandom` benchmark performs `Seek()` without setting `options.lo` and `options.hi`. Without these bounds, `RangeMayMatch` is never called. The `surfscan` benchmark explicitly sets these bounds to activate the SuRF range filter, which is why it shows the improvement.

### Trade-off Summary

SuRF wins on **miss-heavy range workloads** — queries where most SSTables contain no keys in the queried range. Bloom wins on **point queries** where its simpler bit-array lookup is faster than SuRF's trie deserialization. The right filter depends on the workload: applications dominated by range scans (time-series, analytics) benefit from SuRF; applications dominated by point lookups (caching, exact-key retrieval) are better served by Bloom.

---

## Project Architecture

### The Problem — Wasted I/O on Range Scans

When a range query `[lo, hi]` runs, LevelDB performs two checks:

1. **Coarse check** (already exists): Skip SSTables whose `[smallest, largest]` key range does not overlap `[lo, hi]`. This uses `FileMetaData` stored in the version set.
2. **Fine check** (we add): For SSTables that pass the coarse check, does any *actual* key exist in `[lo, hi]`?

Without the fine check, every SSTable that passes the coarse check gets its data blocks read from disk — even if it contains zero keys in the queried range.

**Example:**
```
SSTable B: smallest=bear, largest=hippo → passes coarse check
Actual keys in SSTable B: bear, cat, elephant
Query range: [dog, fox]

Without SuRF: LevelDB opens SSTable B, reads data blocks, finds nothing. Wasted I/O.
With SuRF:    RangeMayMatch("dog", "fox") → false → skip data block reads entirely.
```

### How SuRF Works

SuRF builds a compressed trie (internally called FST — Fast Succinct Trie) from all keys in an SSTable. To answer "any key in [lo, hi]?", it finds the successor of `lo` in the trie. If that successor is greater than `hi`, the answer is no — no key exists in the range. The trie uses approximately 10 bits per key, comparable to a Bloom filter.

### Where the Hook Lives — The Read Path

The `RangeMayMatch` check is inserted in `table_cache.cc::NewIterator()`, **after** `FindTable()` loads the SSTable's filter block into memory, and **before** `table->NewIterator()` reads data blocks:

```
DB::NewIterator(options)                          [db_impl.cc]
  options.lo/hi passed through
  └── Version::AddIterators(options, iters, lo, hi)  [version_set.cc]
        ├── Level 0: each file → TableCache::NewIterator(lo, hi)
        └── Levels 1+: NewConcatenatingIterator(lo, hi)
              └── TwoLevelIterator
                    outer: LevelFileNumIterator (walks file list)
                    inner: GetFileIterator(TableCacheArg{cache, lo, hi})
                             └── TableCache::NewIterator()          [table_cache.cc]
                                   FindTable()
                                     ← SSTable opened, filter loaded into RAM
                                   table->RangeMayMatch(lo, hi)    ← CHECK HERE
                                     false → Release(handle)
                                             return EmptyIterator
                                             (data block reads skipped entirely)
                                     true  → table->NewIterator()
                                               └── read data blocks
```

### Why After FindTable() and Not Before

The filter bytes (the serialized SuRF trie) live inside the `.ldb` SSTable file in the filter block. To access them, the file must be opened — and opening the file IS `FindTable()`. Therefore `RangeMayMatch` **cannot** run before `FindTable()`.

For **warm** (cached) SSTables, `FindTable()` is an LRU cache hit (nearly free), and `RangeMayMatch` then prevents all data block reads — maximum benefit. For **cold** SSTables, `FindTable()` reads the filter block from disk as part of `Table::Open()`, but `RangeMayMatch` still prevents the more expensive data block reads — reduced but real benefit.

A pre-open range check would require storing filter data in a separate partition outside the SSTable. RocksDB implemented this as "partitioned filters" in 2017. This is a natural future extension beyond this project's scope.

### The Write Path — Filter Build During Compaction

```
DoCompactionWork()
  └── BuildTable()
        └── TableBuilder::Add(key, value)           [table_builder.cc]
              └── FilterBlockBuilder::AddKey()       [filter_block.cc]
                    buffers all keys (single filter per SSTable)
              └── TableBuilder::Finish()
                    └── FilterBlockBuilder::Finish()
                          └── SuRFPolicy::CreateFilter(all_keys)  [surf_filter.cc]
                                builds SuRF trie → serializes → writes to SSTable
```

### The Safety Rule

```
KeyMayMatch / RangeMayMatch:
  false → MUST be correct. Definitely no key/range. Never lie here.
  true  → CAN be wrong. False positives are acceptable (just slower).

False negative = data loss   = catastrophic = never acceptable
False positive = extra I/O   = acceptable   = just a performance penalty

Filters are PERFORMANCE ONLY — they never affect correctness.
```

---

## All Files Changed From Original LevelDB

Every modified file lives in `/workspace/project/` and is copied into the LevelDB source tree by `rebuild.sh`.

| # | File | Copies To | What Changed | Week |
|---|------|-----------|-------------|------|
| 1 | `filter_policy.h` | `include/leveldb/filter_policy.h` | Added `RangeMayMatch()` virtual method with default `return true`; declared `NewSuRFFilterPolicy()` | 2 |
| 2 | `surf_filter.cc` | `util/surf_filter.cc` | New file: complete SuRF filter policy with thread_local deserialization cache | 2 |
| 3 | `filter_block.cc` | `table/filter_block.cc` | Changed from per-2KB filters to single filter per SSTable; `base_lg_=32` | 3 |
| 4 | `filter_block_test.cc` | `table/filter_block_test.cc` | Updated `MultiChunk` test to expect single combined filter behavior | 3 |
| 5 | `table.h` | `include/leveldb/table.h` | Added public `RangeMayMatch(lo, hi)` method declaration | 3 |
| 6 | `table.cc` | `table/table.cc` | Implemented `Table::RangeMayMatch()` delegating to filter | 3 |
| 7 | `table_cache.h` | `db/table_cache.h` | Updated `NewIterator` signature with `lo`/`hi` default parameters | 3 |
| 8 | `table_cache.cc` | `db/table_cache.cc` | Core hook: `RangeMayMatch` check after `FindTable()`, with `cache_->Release(handle)` on skip | 3 |
| 9 | `version_set.h` | `db/version_set.h` | Updated `AddIterators` and `NewConcatenatingIterator` signatures with `lo`/`hi` | 3 |
| 10 | `version_set.cc` | `db/version_set.cc` | Added `TableCacheArg` struct to thread `lo`/`hi` through `void* arg`; updated `GetFileIterator`, `AddIterators`, `NewConcatenatingIterator`, `MakeInputIterator`, `ApproximateOffsetOf` | 3 |
| 11 | `options.h` | `include/leveldb/options.h` | Added `Slice lo` and `Slice hi` fields to `ReadOptions`; added `#include "leveldb/slice.h"` | 3 |
| 12 | `db_impl.cc` | `db/db_impl.cc` | One-line change: pass `options.lo`/`options.hi` to `AddIterators()` | 3 |
| 13 | `db_bench.cc` | `benchmarks/db_bench.cc` | Switched filter to `NewSuRFFilterPolicy()`; added `SuRFRangeScan` benchmark and `surfscan` registration | 4 |

**Files NOT changed:** `table_builder.cc`, `bloom.cc`, `dbformat.cc` — these work correctly as-is.

---

## Key Design Decisions

### Single Filter Per SSTable (filter_block.cc)
The original LevelDB calls `GenerateFilter()` every 2KB of data block output, creating many small filters per SSTable. SuRF's `deSerialize()` crashes (segfault/FPE) on tries built from only 10-50 keys. We changed `filter_block.cc` to build ONE filter containing all keys in the SSTable. The trick: setting `base_lg_=32` means `block_offset >> 32 = 0` for any offset under 4GB, so `FilterBlockReader` always finds `filter[0]` — the single combined filter.

### Thread-Local Deserialization Cache (surf_filter.cc)
SuRF's serialized trie can be ~42KB per SSTable. Deserializing on every `KeyMayMatch`/`RangeMayMatch` call (copying 42KB + rebuilding the trie) caused OOM at 1M keys. We use a `thread_local` cache: if `filter.data()` pointer matches the last call, reuse the already-deserialized `surf::SuRF*` object. This works because `filter.data()` points into LevelDB's block cache — same SSTable = same pointer, different SSTable = different pointer. Each thread gets its own cached object, so no locking is needed.

### Alignment Copy Before Deserialization (surf_filter.cc)
`SuRF::deSerialize(char*)` internally casts to `uint64_t*`, requiring 8-byte alignment. `filter.data()` points into LevelDB's block cache which may not be 8-byte aligned. We copy to a `std::string buf` before calling `deSerialize` — `std::string` guarantees sufficient alignment.

### Public `RangeMayMatch` on Table (table.h / table.cc)
`Table::Rep` is forward-declared in `table.h` — its members (including the filter) are only defined inside `table.cc`. Even with `friend class TableCache`, `table_cache.cc` cannot access `rep_->filter` because it does not know what `Rep` contains. Adding a public `RangeMayMatch(lo, hi)` method on `Table` is the clean solution.

### `TableCacheArg` Struct for Threading Range Bounds (version_set.cc)
`GetFileIterator` is a static callback with signature `(void* arg, ...)`. The `void* arg` originally carried only `TableCache*`. We introduced a `TableCacheArg` struct containing `{cache, lo, hi}` and use `RegisterCleanup` with a custom deleter to avoid memory leaks.

### `surf/surf.hpp` Isolation (CRITICAL)
`surf/surf.hpp` is a header-only library. Including it in `table.h` caused it to be pulled into every `.cc` file that includes `table.h`, giving the linker hundreds of duplicate function definitions (ODR violation). **`surf/surf.hpp` is included ONLY in `surf_filter.cc` — never anywhere else.**

---

## Bugs We Hit and How We Fixed Them

These are documented here because they represent non-trivial systems-level debugging.

| Bug | Symptom | Root Cause | Fix |
|-----|---------|-----------|-----|
| ODR violation | Linker error: multiple definitions of `surf::*` | `surf/surf.hpp` included in `table.h`, pulled into every `.cc` file | Remove include from `table.h`; keep only in `surf_filter.cc` |
| Alignment crash | SIGFPE / SIGSEGV in `deSerialize` | `SuRF::deSerialize()` casts to `uint64_t*`; `filter.data()` not 8-byte aligned | Copy to `std::string buf` before deserializing |
| OOM at 1M keys | Process killed during benchmark | 42KB copy per `KeyMayMatch` call × thousands of calls | `thread_local` cache with pointer comparison |
| Incomplete type error | Cannot access `rep_->filter` from `table_cache.cc` | `Table::Rep` is forward-declared; members invisible outside `table.cc` | Add public `RangeMayMatch()` method on `Table` |
| Missing header in rebuild | Signature mismatch between `.h` and `.cc` | `rebuild.sh` copied `.cc` files but not `.h` headers | Add header copy rules to `rebuild.sh` |
| `Slice` not a type | Compile error in `options.h` | Added `Slice lo, hi` without including the header | Add `#include "leveldb/slice.h"` to `options.h` |
| `KeyMayMatch` vs `RangeMayMatch` | Wrong method called, wrong parameter types | Typo: wrote `filter->KeyMayMatch(lo, hi)` | Correct to `filter->RangeMayMatch(lo, hi)` |
| SuRF crash on small tries | Segfault/FPE in `deSerialize` on per-2KB filters | Trie built from 10-50 keys too small for SuRF internals | Single filter per SSTable (`base_lg_=32`) |

---

## Repository Structure

```
leveldb-surf/
│
├── Dockerfile                    # Builds the complete dev environment
├── docker-compose.yml            # Container config with volume mounts
├── .gitattributes                # Enforces LF line endings (critical for Windows→Linux)
├── .gitignore                    # Excludes compiled files and benchmark databases
├── README.md                     # This file
│
├── .vscode/
│   └── settings.json             # VS Code settings (LF endings, C++ format)
│
├── project/
│   ├── filter_policy.h           # Week 2: added RangeMayMatch + NewSuRFFilterPolicy
│   ├── surf_filter.cc            # Week 2: full SuRF filter with thread_local cache
│   ├── filter_block.cc           # Week 3: single filter per SSTable (base_lg_=32)
│   ├── filter_block_test.cc      # Week 3: updated MultiChunk test expectations
│   ├── table.h                   # Week 3: added public RangeMayMatch declaration
│   ├── table.cc                  # Week 3: implemented Table::RangeMayMatch
│   ├── table_cache.h             # Week 3: updated NewIterator signature with lo/hi
│   ├── table_cache.cc            # Week 3: core RangeMayMatch hook after FindTable()
│   ├── version_set.h             # Week 3: updated AddIterators/NewConcatenatingIterator sigs
│   ├── version_set.cc            # Week 3: TableCacheArg, threading lo/hi through void* arg
│   ├── options.h                 # Week 3: added Slice lo/hi to ReadOptions
│   ├── db_impl.cc                # Week 3: one-line change passing lo/hi to AddIterators
│   ├── db_bench.cc               # Week 4: SuRF filter + surfscan benchmark
│   ├── notes/
│   │   ├── source_reading_notes.md  # Deep notes on all source files (1278 lines)
│   │   ├── week2_notes.md           # Week 2 decisions and implementation notes
│   │   └── demos/                   # Notes for each demo D1-D12
│   └── demos/                    # Hands-on demo files D1-D12
│       ├── d01_open_close.cc
│       ├── d02_put.cc
│       ├── d03_get.cc
│       ├── d04_delete.cc
│       ├── d05_writebatch.cc
│       ├── d06_iterator.cc
│       ├── d07_range_scan.cc
│       ├── d08_snapshot.cc
│       ├── d09_getproperty.cc
│       ├── d10_compaction.cc
│       ├── d11_filter_policy.cc
│       └── d12_leveldbutil.cc
│
└── benchmarks/
    ├── rebuild.sh                # Compile and test after every code change
    ├── baseline_benchmark.sh     # Capture before-SuRF performance numbers
    └── baseline/                 # Baseline results (captured Week 1)
        ├── seekrandom.txt        # 4.317 µs/op
        ├── readrandom.txt        # 3.691 µs/op
        ├── readseq.txt           # 0.213 µs/op
        └── fillrandom.txt        # 3.953 µs/op
```

---

## Environment Setup

### Why Docker
We use Docker so every teammate gets an identical Linux environment regardless of OS. Docker creates a mini Ubuntu 22.04 computer inside your laptop. LevelDB and SuRF live compiled inside that container. Code files live on your host machine but are shared into the container through a volume mount. You edit code in VS Code on your host. The container compiles and tests it.

### Why `.gitattributes` and `core.autocrlf false`
Windows saves text files with CRLF (`\r\n`) line endings. Linux needs LF (`\n`). Shell scripts with CRLF fail inside the container with `bad interpreter` errors. The `.gitattributes` file forces git to store all source files with LF endings. We also set `git config --global core.autocrlf false` so git never silently converts line endings.

### Why SSH Keys
GitHub disabled password authentication in August 2021. SSH keys (`ed25519`) are the standard authentication method. Verified with `ssh -T git@github.com`.

---

## The Dockerfile — Step by Step

**Base image:** `FROM ubuntu:22.04` — pinned for g++ 11 (C++17, required by SuRF) and cmake 3.22 (LevelDB requires 3.9+).

**Dependencies:** `apt-get install build-essential cmake git ...` — compiler, build system, version control, debugging tools in one layer.

**LevelDB clone:** `git clone --recurse-submodules` — `--recurse-submodules` is critical; without it `third_party/googletest/` is empty and tests fail.

**SuRF setup:** Clone from `github.com/efficient/SuRF`, copy headers into `include/surf/` so `#include "surf/surf.hpp"` resolves without extra compiler flags.

**CMakeLists.txt patch + build:** Three operations in ONE RUN command (must be atomic to avoid Docker layer caching issues):
1. `sed` patches CMakeLists.txt to include `surf_filter.cc`
2. Creates empty placeholder so cmake can find the file
3. Compiles everything

**Test validation:** `./leveldb_tests` runs during image build. Result: 210 pass, 1 skipped (zstd — expected, not installed).

---

## Daily Workflow

**Start the container:**
```powershell
cd "path-to-repo"
docker compose up -d
docker exec -it leveldb-surf bash
```

**Attach VS Code:** Click green `><` button → "Attach to Running Container" → select `leveldb-surf`.

**After any code change (inside container):**
```bash
bash /workspace/benchmarks/rebuild.sh
```

**Run benchmarks:**
```bash
cd /workspace/leveldb/build
rm -rf /tmp/dbbench
./db_bench --benchmarks=fillrandom,surfscan --num=1000000
```

**Commit (on host):**
```bash
git add project/
git commit -m "Week X: description"
git push origin main
```

---

## What `rebuild.sh` Does

1. **Copy files** from `/workspace/project/` into LevelDB source tree (each file to its correct location)
2. **Incremental build** via `cmake --build` (only recompiles changed files)
3. **Run all tests** via `./leveldb_tests` — all 210 original tests must pass after every change

---

## LevelDB Source Files — What Each One Does

Understanding these files was required before writing any code (Week 1 study).

**`include/leveldb/filter_policy.h`** — The abstract interface every filter must implement: `Name()`, `CreateFilter()`, `KeyMayMatch()`. We added `RangeMayMatch()` with a safe default `return true` so existing Bloom filters work unchanged.

**`util/bloom.cc`** — The existing Bloom filter. Uses a bit array and double-hashing. Cannot answer range queries because hashing destroys key ordering.

**`util/surf_filter.cc`** — Our new file. Implements `SuRFPolicy` with all four methods plus thread_local deserialization cache and alignment-safe copy.

**`table/filter_block.h` + `filter_block.cc`** — `FilterBlockBuilder` builds filters during compaction. `FilterBlockReader` reads them during lookups. Originally created a filter every 2KB (`kFilterBaseLg=11`). We changed to one filter per SSTable (`base_lg_=32`).

**`table/table_builder.cc`** — Builds one complete SSTable. Only 4 lines touch the filter. We do not change this file.

**`table/table.cc`** — Read path. `Table::Open()` reads footer → index → filter block into memory. `InternalGet()` calls `KeyMayMatch()` for point queries. We added `RangeMayMatch()` for range queries.

**`db/version_set.cc`** — Tracks all SSTables across all 7 levels. `AddIterators()` is the starting point for range scan iterators. We thread `lo/hi` through here via `TableCacheArg`.

**`db/table_cache.cc`** — LRU cache of open SSTable files. `FindTable()` opens files and loads filters. `NewIterator()` is our hook point — `RangeMayMatch` runs here after `FindTable()`.

**`db/dbformat.cc` (`InternalFilterPolicy`)** — Hidden wrapper that strips internal key bytes (sequence number + type) before calling your filter. Your `SuRFPolicy` always receives clean user keys. We do not change this file.

---

## Architectural Limitation and Future Work

Our `RangeMayMatch` check runs after `FindTable()` loads the filter into memory. A pre-open range check — verifying no keys exist in `[lo, hi]` before opening the SSTable file at all — would require storing filter data in a separate partition outside the SSTable, in its own cache tier. RocksDB implemented this as **partitioned filters** in 2017. This represents a natural extension beyond this project's scope.

Another future direction is varying the miss rate to show how SuRF's advantage scales: at 100% miss rate (all empty ranges), SuRF is 32% faster; as miss rate decreases toward 0%, the advantage shrinks since more SSTables contain matching keys and cannot be skipped.

---

## Key Concepts Glossary

**LSM-tree** — Log-Structured Merge Tree. Writes go to memory first, then flush to sorted immutable files on disk.

**SSTable** — Sorted String Table. Immutable file containing data blocks, index block, and filter block.

**Bloom filter** — Bit array + hash functions. Answers point queries only. Cannot answer range queries because hashing destroys key ordering.

**SuRF** — Succinct Range Filter. Compressed trie answering both point and range queries using ~10 bits per key.

**FST** — Fast Succinct Trie. The compressed bit-array representation SuRF uses internally.

**Compaction** — Background process merging SSTables. This is when `CreateFilter()` is called.

**FilterPolicy** — LevelDB's plug-in interface: `Name()`, `CreateFilter()`, `KeyMayMatch()`, `RangeMayMatch()` (added by us).

**InternalFilterPolicy** — Hidden wrapper stripping internal key bytes before calling your filter. Your code always receives clean user keys.

**False positive** — Filter says "might have data" when it does not. Acceptable — just reads data blocks unnecessarily.

**False negative** — Filter says "definitely no data" when there is data. Catastrophic — silent data loss. Must never happen.

**Partitioned filters** — RocksDB's 2017 architecture storing filter data in a separate cache tier, enabling range checks before opening an SSTable. Not implemented in LevelDB; a natural future extension.

**micros/op** — Microseconds per operation. Smaller = faster.

---

## Project Timeline

| Week | What | Status |
|------|------|--------|
| 1 | Study all 8 source files, capture baseline benchmarks, build demos D1-D12 | COMPLETE |
| 2 | Implement `SuRFPolicy` in `surf_filter.cc`, add `RangeMayMatch` to `filter_policy.h` | COMPLETE |
| 3 | Wire `RangeMayMatch` into range scan path: `table_cache.cc`, `version_set.cc`, `table.h/cc`, `options.h`, `db_impl.cc`, `filter_block.cc` | COMPLETE |
| 4 | Switch `db_bench.cc` to SuRF, add `surfscan` benchmark, run all benchmarks | COMPLETE |
| 5 | Analysis and report | IN PROGRESS |
| 6 | Presentation | TODO |

**Test status:** 210/210 tests passing after all changes.

---

## Current Checklist

- [x] SSH key generated and added to GitHub
- [x] Repository created at `github.com/dhrish-s/leveldb-surf`
- [x] Docker image built — 210/211 tests pass (1 skipped: zstd, expected)
- [x] All setup files committed and pushed
- [x] VS Code attached to container
- [x] Week 1: All 8 source files studied — notes in `project/notes/source_reading_notes.md`
- [x] Week 1: Baseline benchmarks captured — seekrandom 4.317 µs/op
- [x] Week 1: Hands-on demos D1-D12 completed
- [x] Week 2: SuRF filter implemented — `filter_policy.h` + `surf_filter.cc` — 210/210 tests pass
- [x] Week 3: Range scan integration — all files wired, `RangeMayMatch` active — 210/210 tests pass
- [x] Week 4: Benchmarking complete — SuRF 32% faster on empty-range surfscan
- [ ] Week 5: Analysis and report
- [ ] Week 6: Presentation