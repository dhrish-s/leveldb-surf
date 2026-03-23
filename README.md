# LevelDB + SuRF: Range Query Filter Extension
**Contributors:** Jahnavi Manoj · Dhrish Kumar Suman ·
**University:** University of Southern California

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
├── Dockerfile                  # Builds the complete dev environment
├── docker-compose.yml          # Container config with volume mounts
├── .gitattributes              # Enforces LF line endings (critical for Windows)
├── .gitignore                  # Excludes compiled files and benchmark databases
├── README.md                   # This file
│
├── .vscode/
│   └── settings.json           # VS Code settings (LF endings, C++ format)
│
├── project/                    # YOUR CODE LIVES HERE
│   └── (empty until Week 2 — code files go here as you write them)
│
└── benchmarks/
    ├── rebuild.sh              # Compile and test after every code change
    ├── baseline_benchmark.sh   # Capture before-SuRF performance numbers
    └── baseline/               # Created after running baseline benchmarks
        ├── seekrandom.txt      # KEY BASELINE NUMBER — save this
        ├── readrandom.txt
        ├── readseq.txt
        └── fillrandom.txt
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

The Dockerfile builds the entire environment from scratch. Here is what each step does and why.

```
FROM ubuntu:22.04
```
We pin to Ubuntu 22.04 (not `latest`) because it ships g++ 11 (C++17 support, required by SuRF) and cmake 3.22 (LevelDB requires 3.9+). Pinning prevents the build from breaking when Ubuntu releases a new version.

```
RUN apt-get update && apt-get install -y build-essential cmake git ...
```
Installs the compiler (g++), build system (cmake), version control (git), and debugging tools (gdb, valgrind) in one layer to keep the image size smaller.

```
RUN git clone --recurse-submodules https://github.com/google/leveldb.git
```
Clones the full LevelDB source. `--recurse-submodules` is critical — without it, `third_party/googletest/` is empty and the test build fails.

```
RUN git clone https://github.com/efficient/SuRF.git
```
Clones the official SuRF C++ implementation from the paper authors (SIGMOD 2018).

```
RUN mkdir -p /workspace/leveldb/include/surf && cp -r /workspace/SuRF/include/* ...
```
Copies SuRF headers into LevelDB's include tree so your code can write `#include "surf/surf.hpp"` without extra compiler flags.

```
RUN cd /workspace/leveldb && \
    sed -i '/"util\/bloom.cc"/a\    "util\/surf_filter.cc"' CMakeLists.txt && \
    printf '// placeholder\n' > util/surf_filter.cc && \
    cmake ... && cmake --build . --parallel 4
```
Three things happen atomically in one RUN command:
1. **sed patches CMakeLists.txt** — adds `surf_filter.cc` to the list of files cmake compiles. Without this, your implementation is silently ignored and you get a linker error.
2. **printf creates a placeholder** — cmake requires the file to physically exist at build time. We create an empty placeholder so cmake succeeds. `rebuild.sh` will overwrite it with your real code.
3. **cmake builds LevelDB** — compiles all source files including the placeholder. Produces `libleveldb.a`, `leveldb_tests`, and `db_bench`.

This was combined into one RUN because having them as separate RUN commands caused Docker to cache an intermediate layer where the placeholder was missing, causing cmake to fail with `Cannot find source file: util/surf_filter.cc`.

```
RUN /workspace/leveldb/build/leveldb_tests
```
Runs all 211 LevelDB tests during image build. If any fail, the image build fails. This guarantees your environment is correct before you write a single line of code.

**Build result: 210 tests passed, 1 skipped (zstd compression — expected, not installed).**

---

## Volume Mounts — How Files Flow

```
Your Windows Laptop                    Docker Container
─────────────────────                  ─────────────────
surf-leveldb-project/
  project/          ←──── live sync ────→  /workspace/project/
  benchmarks/       ←──── live sync ────→  /workspace/benchmarks/
```

You create and edit files in `project/` on your laptop using VS Code. They appear instantly inside the container at `/workspace/project/`. When `rebuild.sh` runs, it copies those files into LevelDB's source tree and recompiles.

Benchmark results written inside the container appear in `benchmarks/` on your laptop, so they survive if the container is stopped or deleted.

---

## Daily Workflow

**Every day when you sit down:**

```powershell
# On Windows — start the container
docker compose up -d
docker exec -it leveldb-surf bash
```

**After any code change (inside the container):**

```bash
bash /workspace/benchmarks/rebuild.sh
```

This copies your files → compiles → runs all tests. Takes 10-30 seconds.

**After work session — commit and push (on Windows):**

```powershell
git add project/your_changed_file.cc
git commit -m "Week 2: implement SuRFPolicy::CreateFilter"
git push origin main
```

---

## What `rebuild.sh` Does

```
Step 1: Copies files from /workspace/project/ into LevelDB source tree
        surf_filter.h      → include/leveldb/
        surf_filter.cc     → util/
        filter_policy.h    → include/leveldb/
        filter_block.cc    → table/
        table.cc           → table/
        two_level_iterator.cc → table/
        table_cache.cc     → db/
        version_set.cc     → db/

Step 2: cmake --build (incremental — only recompiles changed files)

Step 3: ./leveldb_tests (all original tests must keep passing)
```

---

## Project Architecture — What We Are Building

### The Problem in Detail

When a range query `[lo, hi]` runs, LevelDB uses coarse metadata (smallest/largest key per SSTable) to skip obviously irrelevant files. But for files whose key range *overlaps* the query range, LevelDB must open them — even if no actual key falls within `[lo, hi]`. This is wasted disk I/O.

Example: SSTable B has keys `dog → jaguar`. Query is `elk → hippo`. LevelDB opens SSTable B. But if SSTable B only contains `dog, fox, iguana, jaguar` — none of which are between `elk` and `hippo` — opening it was pure waste. A Bloom filter cannot detect this because it only handles point queries.

### The Solution — SuRF

SuRF (Succinct Range Filter) is built on a Fast Succinct Trie (FST). A trie is a tree where each branch represents a character of a key. Given keys `dog, fox, iguana, jaguar`, SuRF builds a compressed bit-array representation of this trie. To answer "any key between `elk` and `hippo`?", it navigates the trie to find the successor of `elk`. If that successor is greater than `hippo`, the answer is no — skip the SSTable. This check uses ~10 bits per key and runs in microseconds.

### Files We Modify

| File | What Changes |
|------|-------------|
| `include/leveldb/filter_policy.h` | Add `RangeMayMatch(lo, hi, filter)` method |
| `util/bloom.cc` → `util/surf_filter.cc` | Replace Bloom with SuRF implementation |
| `table/filter_block.cc` | Buffer ALL keys per SSTable instead of per 2KB chunk |
| `table/table.cc` | Consult filter before scanning data blocks |
| `table/two_level_iterator.cc` | Thread query range down to filter check |
| `db/version_set.cc` | Pass query range into iterator construction |
| `db/table_cache.cc` | Call `RangeMayMatch` before opening SSTable |

### The Call Chain (Read Path)

```
DB::NewIterator()
  └── Version::AddIterators()          [version_set.cc]
        └── TwoLevelIterator           [two_level_iterator.cc]
              └── TableCache::NewIterator()  [table_cache.cc]
                    └── RangeMayMatch(lo, hi)  ← NEW: skip if false
                          └── Table::NewIterator()  [table.cc]
                                └── FilterBlockReader → SuRFPolicy
```

### The Call Chain (Write Path / Compaction)

```
DoCompactionWork()
  └── BuildTable()
        └── TableBuilder::Add(key, value)  [table_builder.cc]
              └── FilterBlockBuilder::AddKey(key)  ← buffer ALL keys
                    └── [at SSTable finish] SuRFPolicy::CreateFilter(all_keys)
                          └── SuRF built and serialized to filter block
```

---

## Project Timeline

| Week | Goal |
|------|------|
| 1 | Study LevelDB source: `filter_policy.h`, `bloom.cc`, `filter_block.cc`, `table.cc`, `two_level_iterator.cc`, `version_set.cc`, `table_cache.cc` |
| 2 | Implement `SuRFPolicy::CreateFilter()` and `KeyMayMatch()`. Modify `FilterBlockBuilder` to buffer all keys |
| 3 | Integrate `RangeMayMatch()` into the iterator stack. Correctness tests and fuzz testing |
| 4 | Run YCSB Workload E and db_bench at 1GB and 10GB. Collect metrics |
| 5 | Analyze results. Write report with latency graphs and I/O reduction numbers |
| 6 | Finalize report. Prepare presentation |

---

## Key Concepts Glossary

**LSM-tree** — Log-Structured Merge Tree. LevelDB's storage engine. Writes go to memory first, then flush to disk as sorted immutable files (SSTables).

**SSTable** — Sorted String Table. An immutable sorted file on disk. Contains a data section, an index, and a filter block.

**Bloom filter** — A probabilistic data structure that answers "is key X possibly here?" using a bit array and hash functions. Cannot answer range queries.

**SuRF** — Succinct Range Filter. Built on a Fast Succinct Trie. Can answer "does any key in [lo, hi] exist here?" in ~10 bits per key.

**FST** — Fast Succinct Trie. The compressed bit-array representation of a trie that SuRF uses internally.

**Compaction** — Background process where LevelDB merges and re-sorts SSTables. This is where filters are built (write path).

**FilterPolicy** — LevelDB's plugin interface for filters. Has methods `Name()`, `CreateFilter()`, `KeyMayMatch()`. We add `RangeMayMatch()`.

**False positive** — Filter says "might have data" when it doesn't. Acceptable (just opens SSTable unnecessarily, finds nothing, moves on).

**False negative** — Filter says "definitely no data" when there is data. **Catastrophic — data loss. Must never happen.**

**Point query** — "Does key X exist?" Bloom filter handles this.

**Range query** — "Do any keys between X and Y exist?" SuRF handles this. Bloom filter cannot.

---

## Benchmark Plan

**Tool 1: db_bench** (built into LevelDB)
- `seekrandom` — seeks to random positions, scans forward. Closest to a range scan.
- `readrandom` — random point reads. Should be unchanged by our modification.
- `fillrandom` — write throughput. We must verify SuRF does not hurt this significantly.

**Tool 2: YCSB Workload E** (set up in Week 4)
- 95% range scans, 5% inserts. Directly stresses what we are improving.

**Dataset:** 1M keys (16-byte keys, 100-byte values) and 10M keys. Uniform and Zipfian distributions.

**Metrics to collect:**
- Range scan latency (p50, p95, p99 microseconds)
- Number of SSTables skipped per query
- Disk I/O bytes read
- Filter false positive rate
- Filter memory footprint
- Write throughput and compaction overhead

---

## Current Status

- [x] SSH key generated and added to GitHub
- [x] Repository created at `github.com/dhrish-s/leveldb-surf`
- [x] All 7 setup files committed and pushed
- [x] Docker image built successfully
- [x] 210/211 LevelDB tests pass (1 skipped — zstd compression, expected)
- [ ] Baseline benchmarks captured (next step)
- [ ] Week 1: Read and understand LevelDB source files
- [ ] Week 2: Implement SuRFPolicy
- [ ] Week 3: Range scan integration
- [ ] Week 4: Benchmarking
- [ ] Week 5: Analysis and report
- [ ] Week 6: Presentation
