# Benchmark Results - LevelDB + SuRF
# CSCI-543 Spring 2026
# Machine: Intel i7-10750H / i5-1135G7, 8-12 cores, Ubuntu 22.04 Docker
# LevelDB version 1.23
# Keys: 16 bytes, Values: 100 bytes (50 bytes after compression)

---

## Latest Benchmark Results (April 13, 2026)

Based on the final benchmark run with 1,000,000 keys.

### Standard Benchmarks

| Benchmark   | Bloom (µs/op) | SuRF (µs/op) | Change    | Winner | Notes |
|-------------|---------------|--------------|-----------|--------|-------|
| readrandom  | 2.847        | 8.977       | +215.2%  | Bloom | Point lookups - Bloom's bit-check is cheaper than SuRF's trie deserialization |
| readseq     | 0.212        | 0.447       | +110.8%  | Bloom | Sequential scan - SuRF filter is larger and costlier to load |
| seekrandom  | 8.891        | 6.634       | -25.4%   | SuRF  | Random seeks - SuRF's trie structure aids navigation |
| fillrandom  | 2.638        | 4.078       | +54.6%   | Bloom | Writes - SuRF trie construction is more expensive than Bloom hashing |

### Variable Miss Rate - Range Scans (range_width=10)

| Benchmark    | Bloom (µs/op) | SuRF (µs/op) | Change   | Winner | Keys Scanned |
|--------------|---------------|--------------|----------|--------|--------------|
| surfscan100  | 1.298        | 1.374       | +5.9%   | Bloom | 0 |
| surfscan75   | 3.922        | 5.005       | +27.6%  | Bloom | 1,736,663 |
| surfscan50   | 5.213        | 4.760       | -8.7%   | SuRF  | 3,478,645 |
| surfscan25   | 7.214        | 5.817       | -19.4%  | SuRF  | 5,215,152 |
| surfscan0    | 7.503        | 6.934       | -7.6%   | SuRF  | 6,952,830 |

**Key Findings:**
- SuRF advantage emerges at 50% miss rate and grows through 25% miss rate
- SuRF is fastest relative to Bloom at 25% miss rate (-19.4%)
- At 100% miss, both filters are fast (~1.3 µs) because no data blocks are read
- At 0% miss (all hits), SuRF is still 7.6% faster, indicating SuRF trie aids range iteration even when ranges contain keys

### Wide Range Scan (range_width=100, 100% miss)

| Benchmark     | Bloom (µs/op) | SuRF (µs/op) | Change | Winner |
|---------------|---------------|--------------|--------|--------|
| surfscan_wide | 1.361        | 1.411       | +3.7% | Bloom |

Note: At 100% miss rate with wide ranges, both filters produce nearly identical results because no data blocks are read.

---

## Trade-off Summary

**SuRF wins:**
- Range scans with mixed hit/miss workloads (surfscan50: -8.7%, surfscan25: -19.4%)
- Range scans with all hits (surfscan0: -7.6%)
- Random seeks (seekrandom: -25.4%)

**Bloom wins:**
- Point lookups (readrandom: +215.2%)
- Sequential reads (readseq: +110.8%)
- Write throughput (fillrandom: +54.6%)
- Pure miss range scans (surfscan100: +5.9% - but both are fast)

**Conclusion:**
The right filter depends on workload. Applications dominated by range scans and seeks (time-series databases, analytics, blockchain range queries) benefit from SuRF. Applications dominated by point lookups and writes (caching, exact-key retrieval) are better served by Bloom.

---

## Detailed Analysis

### Why Block Cache Neutralizes the Advantage on Small Datasets

At 1M keys the database is ~62MB. The block cache default scales with available memory. Once SSTables are warm in cache, `FindTable()` is essentially free (RAM read). SuRF can still skip data block reads within the SSTable, but the SSTable itself is already open. The advantage is real but smaller than on cold data.

The SIGMOD 2018 paper demonstrated SuRF's full advantage on datasets **larger than memory** where SSTables must be opened from disk. On a 62MB database fitting in memory, the cold-read benefit is limited.

### Why db_bench seekrandom Shows SuRF Slower

`seekrandom` calls `db->NewIterator(options)` without setting `options.lo` or `options.hi`. The guard `if (!lo.empty() && !hi.empty())` is never true. `RangeMayMatch` is never called. The slower seekrandom result for SuRF is entirely due to `KeyMayMatch` being heavier than Bloom - not a range filter issue. This is a benchmark design issue, not an implementation bug.

### Correctness Verification

All results show 0 false negatives:
- surfscan with empty ranges: 0 keys scanned, 0 keys exist -> correct
- 210/210 tests pass after all changes
- seekrandom finds same fraction of keys (63%) with Bloom and SuRF

No data was silently dropped. The safety rule held throughout.

---

## Test Results

```
After Week 2:  210/210 pass (1 skipped: zstd - expected)
After Week 3:  210/210 pass
After Week 4:  210/210 pass
```

All original LevelDB tests pass throughout the entire project.
SuRF integration did not break any existing functionality.