# LevelDB + SuRF: Range Query Filter Extension
**Team:** Jahnavi Manoj · Dhrish Kumar Suman
**University:** University of Southern California
**Repository:** github.com/dhrish-s/leveldb-surf

---

## What This Project Does

LevelDB is a key-value store built on a Log-Structured Merge Tree (LSM-tree). It is used inside Google Chrome, Bitcoin Core, and Minecraft. Every SSTable (sorted file on disk) has a Bloom filter attached to it. A Bloom filter can answer one question: "is this exact key possibly in this file?" It cannot answer range queries like "does any key between `dog` and `lion` exist in this file?"

This means when you run a range scan, LevelDB opens every SSTable whose key-range overlaps your query — even if that file contains zero keys in your range. That is wasted I/O.

**We fix this by replacing the Bloom filter with SuRF (Succinct Range Filter)** — a data structure that can answer range queries. When SuRF says no key exists in a range, LevelDB skips that SSTable entirely. The SIGMOD 2018 Best Paper showed up to 5x improvement in range query performance in RocksDB using SuRF.

---

## Repository Structure

```
leveldb-surf/
│
├── Dockerfile                    # Builds the complete dev environment
├── docker-compose.yml            # Container config with volume mounts
├── .gitattributes                # Enforces LF line endings (critical for Windows)
├── .gitignore                    # Excludes compiled files and benchmark databases
├── README.md                     # This file
│
├── .vscode/
│   └── settings.json             # VS Code settings (LF endings, C++ format)
│
├── project/
│   ├── notes/
│   │   └── source_reading_notes.md  # Deep notes on all 8 source files (1076 lines)
│   └── demos/                    # Individual demo files (added in Week 1 Part D)
│       ├── d01_open_close.cc
│       ├── d02_put.cc
│       └── ...
│
└── benchmarks/
    ├── rebuild.sh                # Compile and test after every code change
    ├── baseline_benchmark.sh     # Capture before-SuRF performance numbers
    └── baseline/                 # Baseline results (captured Week 1 Part C)
        ├── seekrandom.txt        # 4.317 micros/op — KEY BEFORE NUMBER
        ├── readrandom.txt        # 3.691 micros/op
        ├── readseq.txt           # 0.213 micros/op
        └── fillrandom.txt        # 3.953 micros/op
```

---

## Environment Setup — What We Did and Why

### Why Docker?

We use Docker so every teammate gets an identical Linux environment regardless of whether they are on Windows, Mac, or Linux. The alternative — installing g++, cmake, and dependencies directly on Windows — leads to version mismatches, PATH problems, and hours of debugging the environment instead of the project.

Docker creates a mini Ubuntu 22.04 computer inside your laptop. LevelDB and SuRF live compiled inside that container. Your code files live on your Windows laptop but are shared into the container through a volume mount. You write code in VS Code on Windows. The container compiles and tests it.

### Why SSH Keys?

GitHub disabled password authentication in August 2021. SSH keys are the standard way to authenticate. We generated an `ed25519` key pair, moved it to the default location `C:\Users\ASUS\.ssh\`, and added the public key to GitHub. The connection is verified with `ssh -T git@github.com`.

### Why `.gitattributes`?

Windows saves text files with CRLF (`\r\n`) line endings. Linux needs LF (`\n`) only. Shell scripts with CRLF fail inside the container with `bad interpreter` errors. The `.gitattributes` file forces git to always store `.sh`, `Dockerfile`, `.yml`, `.cc`, and `.h` files with LF endings regardless of the OS.

### Why `core.autocrlf false`?

Git on Windows has `autocrlf=true` by default — it silently converts line endings. We disabled this with `git config --global core.autocrlf false` so git never touches our line endings.

---

## The Dockerfile — Step by Step

```
FROM ubuntu:22.04
```
Pinned to Ubuntu 22.04 for g++ 11 (C++17, required by SuRF) and cmake 3.22 (LevelDB requires 3.9+).

```
RUN apt-get update && apt-get install -y build-essential cmake git ...
```
Installs compiler, build system, version control, and debugging tools in one layer.

```
RUN git clone --recurse-submodules https://github.com/google/leveldb.git
```
`--recurse-submodules` is critical — without it `third_party/googletest/` is empty and tests fail.

```
RUN git clone https://github.com/efficient/SuRF.git
RUN cp -r /workspace/SuRF/include/* /workspace/leveldb/include/surf/
```
Clones SuRF from the paper authors and copies headers into LevelDB's include tree so `#include "surf/surf.hpp"` works without extra flags.

```
RUN cd /workspace/leveldb && \
    sed -i '/"util\/bloom.cc"/a\    "util\/surf_filter.cc"' CMakeLists.txt && \
    printf '// placeholder\n' > util/surf_filter.cc && \
    cmake ... && cmake --build . --parallel 4
```
Three things in ONE RUN command (critical — must be atomic):
1. `sed` patches CMakeLists.txt to include `surf_filter.cc`
2. Creates empty placeholder so cmake can find the file
3. Compiles everything including the placeholder

Combined into one RUN because separate RUN commands caused Docker layer caching to miss the placeholder, causing `Cannot find source file: util/surf_filter.cc`.

```
RUN /workspace/leveldb/build/leveldb_tests
```
Runs all 211 tests during image build. **Result: 210 pass, 1 skipped (zstd — expected).**

---

## Daily Workflow

**Every day when you sit down (after a reboot):**
```powershell
cd "path"
docker compose up -d
docker exec -it leveldb-surf bash
```

**If container is already running (no reboot):**
```powershell
docker exec -it leveldb-surf bash
```

**Attach VS Code to the container:**
1. Open VS Code
2. Click the green `><` button bottom-left
3. Select "Attach to Running Container"
4. Select `leveldb-surf`
5. VS Code terminal is now inside Linux — no more switching

**After any code change (inside container terminal):**
```bash
bash /workspace/benchmarks/rebuild.sh
```

**After a work session (on Windows):**
```powershell
git add project/your_file.cc
git commit -m "Week X: description of what you did"
git push origin main
```

---

## What `rebuild.sh` Does

```
Step 1: Copy files from /workspace/project/ into LevelDB source tree
        surf_filter.h         → include/leveldb/
        surf_filter.cc        → util/
        filter_policy.h       → include/leveldb/
        filter_block.cc       → table/
        table.cc              → table/
        two_level_iterator.cc → table/
        table_cache.cc        → db/
        version_set.cc        → db/

Step 2: cmake --build (incremental — only recompiles changed files)

Step 3: ./leveldb_tests — ALL original tests must keep passing
```

---

## LevelDB Source — What Each File Does

This section documents every source file we studied in Week 1. Understanding these files is required before writing any code.

### `include/leveldb/filter_policy.h` — The Contract
The abstract interface every filter must implement. Defines 3 methods:
- `Name()` — returns filter name, stored in SSTable, must match on read or filter is ignored
- `CreateFilter(keys, n, dst)` — builds filter from n sorted keys, appends bytes to dst
- `KeyMayMatch(key, filter)` — returns false = definitely absent, true = maybe present

**We add a 4th method:**
- `RangeMayMatch(lo, hi, filter)` — returns false = no key in [lo,hi], true = maybe has keys

Currently `RangeMayMatch` has **0 grep results** across the entire codebase. That zero is the entire project.

### `util/bloom.cc` — The Existing Filter (We Replace This)
Implements Bloom filter using a bit array and double-hashing.
- `CreateFilter`: hashes each key k times (k = bits_per_key × 0.69), sets those bits ON
- `KeyMayMatch`: hashes query key same way, checks if all k bits are ON
- **Critical flaw for ranges**: `BloomHash()` destroys all key ordering. "ant" and "zebra" become unrelated numbers. Cannot answer "any key between bear and fox?"

### `table/filter_block.h` + `filter_block.cc` — The 2KB Problem
`FilterBlockBuilder` builds the filter during compaction. `FilterBlockReader` reads it during lookups.

**The 2KB problem (Challenge 1):**
```
kFilterBaseLg = 11 → kFilterBase = 2^11 = 2048 bytes = 2KB
GenerateFilter() is called every 2KB of data → many mini-filters per SSTable
SuRF needs ALL keys at once to build one valid trie
```

**On-disk filter block layout:**
```
[filter 0][filter 1][filter 2]...[offset table][array_offset][base_lg=11]
                                                              ↑ last byte
```
Constructor reads from END backwards: last byte = base_lg, 4 bytes before = array_offset.

**Filter lookup:** `filter_index = block_offset >> base_lg_` (= block_offset / 2048)

**What we change in Week 2:**
Stop calling `GenerateFilter()` at every 2KB boundary. Buffer ALL keys. Call `CreateFilter()` once in `Finish()`.

### `table/table_builder.cc` — Write Path (4 Lines That Matter)
Builds one complete SSTable from scratch. Only 4 lines touch the filter:
1. Constructor: `new FilterBlockBuilder(opt.filter_policy)` — plug-in point
2. `Add()`: `filter_block->AddKey(key)` — key given to filter before data block flush
3. `Flush()`: `filter_block->StartBlock(offset)` — triggers GenerateFilter() at 2KB
4. `Finish()`: `filter_block->Finish()` + stores `filter_policy->Name()` in metaindex

**We do not change this file.** Only `FilterBlockBuilder` changes.

### `table/table.cc` — Read Path (The Gap We Fill)
Librarian who opens and reads an SSTable.
- `Table::Open()`: reads footer → index → filter into memory
- `ReadMeta()`: looks for `"filter." + policy->Name()`. Name mismatch = filter silently ignored
- `InternalGet()` line 225: `filter->KeyMayMatch()` — **point queries already optimized**
- `NewIterator()`: creates TwoLevelIterator — **NO filter check for range scans** ← gap we fill

### `db/version_set.cc` — The Library Directory
Tracks all SSTables across all 7 levels (Level 0–6).
- `FileMetaData`: every SSTable has `smallest` and `largest` key — the coarse filter
- `AddIterators()`: creates iterators for all candidate SSTables — **our hook location**
- `LevelFileNumIterator`: walks through SSTable file list (outer iterator)
- `GetFileIterator()`: opens one SSTable (currently unconditional — no filter check)

**Two-level filtering:**
- Coarse (already exists): skip if file range [smallest, largest] doesn't overlap query
- Fine (we add): `RangeMayMatch(lo, hi)` — skip if no actual key in [lo, hi]

### `db/table_cache.cc` — The SSTable Cache (Our Hook Point)
LRU cache of open SSTable files. Opening from disk is slow; cache makes repeat access fast.
- `FindTable()`: cache hit = fast (memory), cache miss = `Table::Open()` (disk I/O)
- `NewIterator()` — **OUR EXACT HOOK POINT**:
  ```
  BEFORE FindTable() is called:
  if RangeMayMatch(lo, hi) == false → return empty iterator (zero disk I/O)
  ```

**The threading problem (Challenge 2):**
The query range `[lo, hi]` must be threaded through:
```
AddIterators(lo, hi)
  → NewConcatenatingIterator(lo, hi)
    → GetFileIterator(lo, hi)
      → TableCache::NewIterator(lo, hi)
        → RangeMayMatch check BEFORE FindTable()
```
This requires changing function signatures across multiple files — the main engineering challenge of the project.

### `InternalFilterPolicy` — The Hidden Wrapper
Defined in `db/dbformat.cc`. Wraps your filter and strips internal key bytes before calling it.

LevelDB stores keys internally as: `"cat" + [7-byte sequence number] + [1-byte type]`

`InternalFilterPolicy` strips the extra 8 bytes. **Your SuRFPolicy always receives clean user keys.** You never handle internal key format. This applies to `CreateFilter`, `KeyMayMatch`, and `RangeMayMatch`.

---

## Project Architecture — What We Are Building

### The Problem in Detail

When a range query `[lo, hi]` runs:
1. **Coarse check** (already exists): skip SSTables whose `[smallest, largest]` doesn't overlap `[lo, hi]`
2. **Fine check** (missing): for SSTables that pass the coarse check, are there *actual* keys in `[lo, hi]`?

Example:
```
SSTable B: smallest=bear, largest=hippo → passes coarse check
Actual keys in SSTable B: bear, cat, elephant (none between dog and fox)
Query: [dog, fox]
Without SuRF: LevelDB opens SSTable B, scans, finds nothing. Wasted I/O.
With SuRF:    RangeMayMatch("dog","fox") → false → skip SSTable B entirely
```

### The Solution — SuRF

SuRF builds a compressed trie from all keys. To answer "any key in [elk, hippo]?", it finds the successor of "elk" in the trie. If that successor > "hippo" — answer is no. Uses ~10 bits per key.

### Files We Modify

| File | Change | Week |
|---|---|---|
| `include/leveldb/filter_policy.h` | Add `RangeMayMatch()` with default `return true` | 2 |
| `util/surf_filter.cc` | New file: SuRFPolicy implementing all 4 methods | 2 |
| `table/filter_block.cc` | Buffer all keys, call `CreateFilter()` once in `Finish()` | 2 |
| `db/table_cache.cc` | Check `RangeMayMatch` before `FindTable()` in `NewIterator()` | 3 |
| `db/version_set.cc` | Thread `[lo, hi]` from `AddIterators()` down | 3 |
| `table/two_level_iterator.cc` | Pass range bounds to inner iterator | 3 |
| `benchmarks/db_bench.cc` | Change to `NewSuRFFilterPolicy()` at line 523 | 4 |

### The Read Path — Range Scan

```
DB::NewIterator()
  └── Version::AddIterators()             [version_set.cc]
        coarse check: FileMetaData min/max
        └── NewConcatenatingIterator()
              └── TwoLevelIterator
                    outer: LevelFileNumIterator (walks file list)
                    inner: GetFileIterator()
                             └── TableCache::NewIterator()   [table_cache.cc]
                                   ← RangeMayMatch(lo,hi) CHECK HERE
                                   false → return empty iterator
                                   true  → FindTable() → open SSTable
                                             └── Table::NewIterator()  [table.cc]
```

### The Write Path — Filter Build During Compaction

```
DoCompactionWork()
  └── BuildTable()
        └── TableBuilder::Add(key, value)      [table_builder.cc]
              └── FilterBlockBuilder::AddKey()  [filter_block.cc]
                    buffers key (Week 2: buffer ALL keys instead of 2KB chunks)
              when SSTable done:
              └── TableBuilder::Finish()
                    └── FilterBlockBuilder::Finish()
                          └── SuRFPolicy::CreateFilter(ALL keys)  [surf_filter.cc]
                                builds SuRF trie → serializes → appends to result_
```

### The Safety Rule

```
KeyMayMatch / RangeMayMatch:
  false → MUST be correct. Definitely absent. Never lie here.
  true  → CAN be wrong. False positives are acceptable (just slower).

False negative = data loss = catastrophic = never acceptable
False positive = extra disk read = acceptable

Filters are PERFORMANCE ONLY — not correctness.
Remove the filter entirely: LevelDB still works, just slower.
```

---

## Baseline Benchmarks — Before SuRF

Captured: March 26, 2026 — 1 million keys, 16-byte keys, 100-byte values.

```
┌──────────────┬────────────────┬──────────────────────────────────┐
│ Benchmark    │ Result         │ Expected After SuRF              │
├──────────────┼────────────────┼──────────────────────────────────┤
│ seekrandom   │ 4.317 µs/op   │ ~2.0–3.5 µs/op (20–50% faster)  │
│ readrandom   │ 3.691 µs/op   │ ~3.691 µs/op (unchanged)         │
│ readseq      │ 0.213 µs/op   │ ~0.213 µs/op (unchanged)         │
│ fillrandom   │ 3.953 µs/op   │ ~4.2–4.8 µs/op (10–20% slower)  │
└──────────────┴────────────────┴──────────────────────────────────┘
```

**Key insight:** `seekrandom (4.317) > readrandom (3.691)` by 0.626 µs/op.
That gap = wasted SSTable opens during forward scan after seek.
SuRF's `RangeMayMatch()` eliminates those wasted opens.

**Why each number is what it is:**
- `readseq (0.213)` — fastest because keys are read in order, OS prefetch helps, no random jumps
- `readrandom (3.691)` — 17x slower because each key is in a different SSTable, random disk seeks
- `seekrandom (4.317)` — slightly slower than readrandom because after seeking it scans forward, opening multiple SSTables per operation
- `fillrandom (3.953)` — writes go to memory buffer first, then flush to disk during compaction

---

## Project Timeline — Detailed

### Week 1 — Study and Baseline ✅ COMPLETE
- Read all 8 source files — notes in `project/notes/source_reading_notes.md`
- Captured baseline benchmarks — results in `benchmarks/baseline/`
- Hands-on demos D1–D12 (in progress)

### Week 2 — Implement SuRFPolicy
Files to create/modify:
```
NEW:    util/surf_filter.cc
          SuRFPolicy::Name()           → "leveldb.SuRFFilter"
          SuRFPolicy::CreateFilter()   → build SuRF trie, serialize to bytes
          SuRFPolicy::KeyMayMatch()    → lookup exact key in trie
          SuRFPolicy::RangeMayMatch()  → lookup key range in trie

MODIFY: include/leveldb/filter_policy.h
          add: virtual bool RangeMayMatch(lo, hi, filter) const { return true; }

MODIFY: table/filter_block.cc
          stop calling GenerateFilter() at 2KB boundaries
          buffer ALL keys, call CreateFilter() once in Finish()
```
Test: all 210 original tests must still pass.

### Week 3 — Wire Into Range Scan Path
Files to modify:
```
MODIFY: db/table_cache.cc
          add RangeMayMatch check before FindTable() in NewIterator()

MODIFY: db/version_set.cc
          thread [lo, hi] from AddIterators() → GetFileIterator()

MODIFY: table/two_level_iterator.cc
          pass range bounds to inner iterator creation
```
Test: write range scan correctness tests. Run fuzz tests.

### Week 4 — Benchmarking
```
MODIFY: benchmarks/db_bench.cc line 523
          change: NewBloomFilterPolicy(10)
          to:     NewSuRFFilterPolicy()

RUN: seekrandom, YCSB Workload E
     at 1M keys and 10M keys
     Uniform and Zipfian distributions

COLLECT:
  - Range scan latency (p50, p95, p99)
  - SSTables skipped per query
  - Disk I/O bytes read
  - Filter false positive rate
  - Filter memory footprint
  - Write throughput change
```

### Week 5 — Analysis and Report
- Compare before/after numbers
- Draw latency graphs and I/O reduction charts
- Calculate % improvement in seekrandom

### Week 6 — Presentation
- Final report
- Demo: live seekrandom comparison Bloom vs SuRF

---

## Key Concepts Glossary

**LSM-tree** — Log-Structured Merge Tree. Writes go to memory first, then flush to sorted immutable files (SSTables) on disk.

**SSTable** — Sorted String Table. Immutable file on disk. Contains data blocks, index block, and filter block.

**Bloom filter** — Bit array + hash functions. Answers "is key X possibly here?" Cannot answer range queries because hashing destroys key ordering.

**SuRF** — Succinct Range Filter. Compressed trie (FST). Answers "does any key in [lo, hi] exist here?" using ~10 bits per key.

**FST** — Fast Succinct Trie. The compressed bit-array form of a trie that SuRF uses internally.

**Compaction** — Background process that merges and re-sorts SSTables. This is when `CreateFilter()` is called and filters are built.

**FilterPolicy** — LevelDB's plug-in interface. `Name()`, `CreateFilter()`, `KeyMayMatch()`, `RangeMayMatch()` (we add).

**InternalFilterPolicy** — Hidden wrapper that strips internal key bytes (sequence number + type) before calling your filter. Your code always receives clean user keys.

**False positive** — Filter says "might have data" when it doesn't. Acceptable — just extra disk read.

**False negative** — Filter says "definitely no data" when there is data. Catastrophic — silent data loss. Must never happen.

**2KB problem** — FilterBlockBuilder calls `CreateFilter()` every 2KB of data, creating many mini-filters per SSTable. SuRF needs all keys at once. We fix this in Week 2.

**Threading problem** — The query range `[lo, hi]` must be passed through 4 function call layers to reach the `RangeMayMatch()` check. Requires changing function signatures in multiple files.

**micros/op** — Microseconds per operation. 1 microsecond = 0.000001 seconds. Smaller = faster.

---

## Current Status

- [x] SSH key generated and added to GitHub
- [x] Repository created at `github.com/dhrish-s/leveldb-surf`
- [x] Docker image built — 210/211 tests pass (1 skipped: zstd, expected)
- [x] All setup files committed and pushed
- [x] VS Code attached to container
- [x] Part B: All 8 source files read — notes in `project/notes/source_reading_notes.md`
- [x] Part C: Baseline benchmarks captured — seekrandom **4.317 µs/op**
- [ ] Part D: Hands-on demos D1–D12
- [ ] Part E: Combined demo file
- [ ] Week 2: SuRFPolicy implementation
- [ ] Week 3: Range scan integration
- [ ] Week 4: Benchmarking
- [ ] Week 5: Analysis and report
- [ ] Week 6: Presentation