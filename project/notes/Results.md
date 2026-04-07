# Benchmark Results — LevelDB + SuRF
# CSCI-543 Spring 2026
# Machine: Intel i7-10750H / i5-1135G7, 8-12 cores, Ubuntu 22.04 Docker
# LevelDB version 1.23
# Keys: 16 bytes, Values: 100 bytes (50 bytes after compression)

---

## Baseline — Bloom Filter (1M keys, March 26 2026)

Captured before any SuRF changes. These are the reference numbers.

```
Benchmark    Result          Notes
-----------  --------------  ------------------------------------
fillrandom   3.953 µs/op     27.8 MB/s
seekrandom   4.317 µs/op     the gap vs readrandom = wasted I/O
readrandom   3.691 µs/op
readseq      0.213 µs/op     452 MB/s
```

The 0.626 µs gap between seekrandom and readrandom represents the extra cost
of opening SSTables during range scans that contain no matching keys.
SuRF's job is to eliminate that wasted work.

---

## SuRF Standard Benchmarks (1M keys, with std::string buf copy, no cache)

First SuRF run. Before alignment fix and before thread_local cache.
OOM killed at 1M keys — per-call 42KB allocation too expensive.

Ran at 100K keys only:
```
Benchmark    Bloom          SuRF           Change
-----------  -------------  -------------  --------
fillrandom   ~3.953 µs/op   40.477 µs/op   10x slower (per-call deSerialize)
readrandom   ~3.691 µs/op   62.829 µs/op   17x slower
```

These numbers confirmed the alignment fix was needed and the per-call
deserialization cost was the bottleneck.

---

## After Alignment Fix + thread_local Cache (100K keys)

Added `std::string buf` copy for alignment + `thread_local` SuRF cache.
Pointer comparison instead of per-call copy on cache hits.

```
Benchmark    Bloom          SuRF           Change
-----------  -------------  -------------  --------
fillrandom   1.780 µs/op    1.892 µs/op    +6%
seekrandom   —              11.774 µs/op   —
readrandom   —              10.486 µs/op   —
readseq      —              0.412 µs/op    —
```

`readrandom` dropped from 62 µs to 10 µs — thread_local cache working.

---

## SuRF Standard Benchmarks (1M keys, with thread_local cache) — FINAL

```
Benchmark    Bloom          SuRF           Change        Notes
-----------  -------------  -------------  ------------  --------------------
fillrandom   3.953 µs/op    4.653 µs/op    +18%          trie build cost
seekrandom   4.317 µs/op    10.781 µs/op   +150%         RangeMayMatch not triggered
readrandom   3.691 µs/op    5.606 µs/op    +52%          thread_local helps
readseq      0.213 µs/op    0.245 µs/op    +15%          nearly identical
```

seekrandom does not show SuRF advantage because `db_bench seekrandom` never
sets `options.lo/hi`. `RangeMayMatch` is never called. Point query path only.

---

## surfscan — Dense Ranges (100K keys, ranges of 100 in same key space)

```
Benchmark    Bloom          SuRF           Notes
-----------  -------------  -------------  ------------------------------------
surfscan     7.523 µs/op    7.880 µs/op    63M keys found — ranges NOT empty
```

No advantage because 1M key space with 100K keys and 100-key ranges means
~64 keys found per range. SuRF has nothing to skip.

---

## surfscan — Sparse Ranges 10x (100K keys, 10x larger query space)

```
Benchmark    Bloom          SuRF           Notes
-----------  -------------  -------------  ------------------------------------
surfscan     ~7.5 µs/op     ~7.9 µs/op     6M keys found — still too dense
```

---

## surfscan — Sparse Ranges 100x (100K keys, 100x larger query space)

```
Benchmark    Bloom          SuRF           Notes
-----------  -------------  -------------  ------------------------------------
surfscan     1.560 µs/op    1.552 µs/op    645K keys found — nearly tied
```

Getting closer but block cache absorbs the difference at 100K keys.

---

## surfscan — Dense DB, Dense Query (1M keys, ranges within key space)

```
Benchmark    Bloom          SuRF           Notes
-----------  -------------  -------------  ------------------------------------
surfscan     1.587 µs/op    1.607 µs/op    637K keys found — block cache wins
```

Both nearly identical. At 62MB DB fitting entirely in block cache, SSTable
skipping saves almost nothing since files are read from RAM anyway.

---

## surfscan — Empty Ranges (1M keys, query ABOVE key space) — KEY RESULT

Keys inserted: 0 to 999999
Ranges queried: 1000000 to 1999999 — GUARANTEED EMPTY

```
Benchmark    Bloom          SuRF           Change        Notes
-----------  -------------  -------------  ------------  --------------------
surfscan     2.102 µs/op    1.420 µs/op    -32%          SuRF WINS
                                                          0 keys scanned
                                                          no false negatives
```

**SuRF is 32% faster.**

Bloom cannot answer "is there a key in [X, Y]?" — must open every SSTable,
check data blocks, conclude nothing found.

SuRF calls `lookupRange(lo, hi)` — trie immediately says false — SSTable
skipped entirely. No data block reads at all.

0 keys scanned confirms: correct behavior. SuRF never returned true when
the answer was false (no false negatives). Safety rule preserved.

---

## Summary Table — All Key Results

```
Benchmark               Bloom       SuRF        Winner   Notes
----------------------  ----------  ----------  -------  ----------------------
fillrandom (1M)         3.953 µs    4.653 µs    Bloom    +18% overhead expected
seekrandom (1M)         4.317 µs    10.781 µs   Bloom    RangeMayMatch bypassed
readrandom (1M)         3.691 µs    5.606 µs    Bloom    point query path
readseq (1M)            0.213 µs    0.245 µs    Tie      sequential unaffected
surfscan dense (1M)     1.587 µs    1.607 µs    Tie      block cache absorbs gap
surfscan empty (1M)     2.102 µs    1.420 µs    SuRF     32% faster ← KEY RESULT
```

---

## Analysis

### When SuRF Wins

SuRF wins when range queries have a **high miss rate** — ranges that contain
no keys. In this scenario:

- Bloom cannot answer range queries. It opens every SSTable and reads data
  blocks to verify the range is empty. This is unavoidable.
- SuRF calls `lookupRange(lo, hi)`. The trie traversal returns false
  immediately. The SSTable is skipped. No data blocks are read.

The benefit is proportional to the fraction of SSTables that can be skipped.
With all queries falling outside the key space, every SSTable is skipped.

### When Bloom Wins

Bloom wins on **point queries** and **hit-heavy workloads**:

- Bloom: 2 hash operations, check 2 bits. Nanoseconds per call.
- SuRF: trie traversal + thread_local cache check. Still faster than
  per-call deserialization but heavier than Bloom.

For workloads where most range queries find keys (dense data), SuRF provides
no skipping benefit and its heavier per-call cost makes it slower.

### Why Block Cache Neutralizes the Advantage on Small Datasets

At 1M keys the database is ~62MB. The block cache default is 8MB but scales.
Once SSTables are warm in cache, `FindTable()` is essentially free (RAM read).
SuRF can still skip data block reads within the SSTable, but the SSTable
itself is already open. The advantage is real but smaller than on cold data.

The SIGMOD 2018 paper demonstrated SuRF's full advantage on datasets
**larger than memory** where SSTables must be opened from disk. On a 62MB
database fitting in an 8GB laptop's cache, the cold-read benefit is limited.

### db_bench seekrandom Does Not Test SuRF

`seekrandom` calls `db->NewIterator(options)` without setting `options.lo`
or `options.hi`. The guard `if (!lo.empty() && !hi.empty())` is never true.
`RangeMayMatch` is never called. The slower seekrandom result for SuRF is
entirely due to `KeyMayMatch` being heavier than Bloom — not a range filter
issue. This is a benchmark design issue, not an implementation bug.

### Correctness Verification

All results show 0 false negatives:
- surfscan with empty ranges: 0 keys scanned, 0 keys exist → correct
- 210/210 tests pass after all changes
- seekrandom finds same fraction of keys (63%) with Bloom and SuRF

No data was silently dropped. The safety rule held throughout.

---

## Test Results

```
After Week 2:  210/210 pass (1 skipped: zstd — expected)
After Week 3:  210/210 pass
After Week 4:  210/210 pass
```

All original LevelDB tests pass throughout the entire project.
SuRF integration did not break any existing functionality.