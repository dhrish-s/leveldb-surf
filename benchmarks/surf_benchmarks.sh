#!/bin/bash
# ============================================================================
# SuRF: Comprehensive Benchmark Script
# CSCI-543 Spring 2026 - USC
#
# Runs all SuRF vs Bloom benchmarks and saves results to files.
# Usage (inside container):
#   bash /workspace/benchmarks/surf_benchmarks.sh
#
# Prerequisites:
#   - rebuild.sh must have been run successfully (210/210 tests passing)
#   - db_bench must be compiled with --filter flag support
#
# Output: /workspace/benchmarks/surf_results/
# ============================================================================

set -e

BUILD_DIR="/workspace/leveldb/build"
RESULTS_DIR="/workspace/benchmarks/surf_results"
DB_BENCH="$BUILD_DIR/db_bench"
NUM_KEYS=1000000

# Colors for terminal output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}============================================${NC}"
echo -e "${CYAN}  SuRF vs Bloom Benchmark Suite${NC}"
echo -e "${CYAN}  Keys: ${NUM_KEYS}, Values: 100 bytes${NC}"
echo -e "${CYAN}============================================${NC}"
echo ""

# Create results directory
mkdir -p "$RESULTS_DIR"

# Record timestamp and environment
echo "Benchmark run: $(date)" > "$RESULTS_DIR/run_info.txt"
echo "Keys: $NUM_KEYS" >> "$RESULTS_DIR/run_info.txt"
echo "Value size: 100 bytes" >> "$RESULTS_DIR/run_info.txt"
echo "" >> "$RESULTS_DIR/run_info.txt"

# ============================================================================
# Helper function: run one benchmark and save output
# Args: $1=filter_type  $2=benchmark_name  $3=output_filename
# ============================================================================
run_bench() {
  local filter=$1
  local bench=$2
  local outfile="$RESULTS_DIR/$3"

  echo -e "${YELLOW}Running: ${filter} / ${bench}${NC}"

  # Clean database before each run for consistent results
  rm -rf /tmp/dbbench

  # fillrandom populates the DB, then the actual benchmark runs on it
  $DB_BENCH \
    --filter="$filter" \
    --benchmarks="fillrandom,$bench" \
    --num="$NUM_KEYS" \
    2>/dev/null | tee "$outfile"

  echo -e "${GREEN}  -> Saved to $outfile${NC}"
  echo ""
}

# ============================================================================
# TEST 1: Standard benchmarks (point queries, sequential reads)
# Shows the cost of SuRF vs Bloom on non-range workloads
# ============================================================================
echo -e "${CYAN}=== TEST 1: Standard Benchmarks ===${NC}"
echo ""

run_bench "bloom" "readrandom"  "bloom_readrandom.txt"
run_bench "surf"  "readrandom"  "surf_readrandom.txt"

run_bench "bloom" "readseq"     "bloom_readseq.txt"
run_bench "surf"  "readseq"     "surf_readseq.txt"

run_bench "bloom" "seekrandom"  "bloom_seekrandom.txt"
run_bench "surf"  "seekrandom"  "surf_seekrandom.txt"

# ============================================================================
# TEST 2: Variable miss rate - the KEY experiment
# Shows SuRF advantage scaling with miss rate
# At 100% miss: SuRF skips all SSTables with empty ranges -> fastest ( assumption )
# At 0% miss:   every range hits keys -> SuRF overhead visible
# ============================================================================
echo -e "${CYAN}=== TEST 2: Variable Miss Rate (SuRF vs Bloom) ===${NC}"
echo ""

for miss in 100 75 50 25 0; do
  run_bench "bloom" "surfscan${miss}" "bloom_surfscan${miss}.txt"
  run_bench "surf"  "surfscan${miss}" "surf_surfscan${miss}.txt"
done

# ============================================================================
# TEST 3: Wide range scan (range_width=100 instead of 10)
# Shows SuRF advantage on broader range queries - expected results
# ============================================================================
echo -e "${CYAN}=== TEST 3: Wide Range Scan ===${NC}"
echo ""

run_bench "bloom" "surfscan_wide" "bloom_surfscan_wide.txt"
run_bench "surf"  "surfscan_wide" "surf_surfscan_wide.txt"

# ============================================================================
# TEST 4: Write performance comparison
# Shows filter build cost (SuRF trie vs Bloom bit array)
# ============================================================================
echo -e "${CYAN}=== TEST 4: Write Performance ===${NC}"
echo ""

# fillrandom alone - just measure write speed
rm -rf /tmp/dbbench
echo -e "${YELLOW}Running: bloom / fillrandom${NC}"
$DB_BENCH --filter=bloom --benchmarks=fillrandom --num=$NUM_KEYS 2>/dev/null \
  | tee "$RESULTS_DIR/bloom_fillrandom.txt"
echo ""

rm -rf /tmp/dbbench
echo -e "${YELLOW}Running: surf / fillrandom${NC}"
$DB_BENCH --filter=surf --benchmarks=fillrandom --num=$NUM_KEYS 2>/dev/null \
  | tee "$RESULTS_DIR/surf_fillrandom.txt"
echo ""

# ============================================================================
# Generate summary report
# ============================================================================
echo -e "${CYAN}=== Generating Summary ===${NC}"
echo ""

SUMMARY="$RESULTS_DIR/SUMMARY.txt"

echo "================================================================" > "$SUMMARY"
echo "  SuRF vs Bloom Benchmark Summary" >> "$SUMMARY"
echo "  Date: $(date)" >> "$SUMMARY"
echo "  Keys: $NUM_KEYS | Value size: 100 bytes" >> "$SUMMARY"
echo "================================================================" >> "$SUMMARY"
echo "" >> "$SUMMARY"

echo "--- Standard Benchmarks ---" >> "$SUMMARY"
echo "Bloom readrandom:  $(grep 'readrandom' $RESULTS_DIR/bloom_readrandom.txt 2>/dev/null | tail -1)" >> "$SUMMARY"
echo "SuRF  readrandom:  $(grep 'readrandom' $RESULTS_DIR/surf_readrandom.txt 2>/dev/null | tail -1)" >> "$SUMMARY"
echo "Bloom readseq:     $(grep 'readseq' $RESULTS_DIR/bloom_readseq.txt 2>/dev/null | tail -1)" >> "$SUMMARY"
echo "SuRF  readseq:     $(grep 'readseq' $RESULTS_DIR/surf_readseq.txt 2>/dev/null | tail -1)" >> "$SUMMARY"
echo "Bloom seekrandom:  $(grep 'seekrandom' $RESULTS_DIR/bloom_seekrandom.txt 2>/dev/null | tail -1)" >> "$SUMMARY"
echo "SuRF  seekrandom:  $(grep 'seekrandom' $RESULTS_DIR/surf_seekrandom.txt 2>/dev/null | tail -1)" >> "$SUMMARY"
echo "" >> "$SUMMARY"

echo "--- Variable Miss Rate (range_width=10) ---" >> "$SUMMARY"
for miss in 100 75 50 25 0; do
  echo "Bloom surfscan${miss}: $(grep "surfscan${miss}" $RESULTS_DIR/bloom_surfscan${miss}.txt 2>/dev/null | tail -1)" >> "$SUMMARY"
  echo "SuRF  surfscan${miss}: $(grep "surfscan${miss}" $RESULTS_DIR/surf_surfscan${miss}.txt 2>/dev/null | tail -1)" >> "$SUMMARY"
done
echo "" >> "$SUMMARY"

echo "--- Wide Range Scan (range_width=100, 100% miss) ---" >> "$SUMMARY"
echo "Bloom surfscan_wide: $(grep 'surfscan_wide' $RESULTS_DIR/bloom_surfscan_wide.txt 2>/dev/null | tail -1)" >> "$SUMMARY"
echo "SuRF  surfscan_wide: $(grep 'surfscan_wide' $RESULTS_DIR/surf_surfscan_wide.txt 2>/dev/null | tail -1)" >> "$SUMMARY"
echo "" >> "$SUMMARY"

echo "--- Write Performance ---" >> "$SUMMARY"
echo "Bloom fillrandom:  $(grep 'fillrandom' $RESULTS_DIR/bloom_fillrandom.txt 2>/dev/null | tail -1)" >> "$SUMMARY"
echo "SuRF  fillrandom:  $(grep 'fillrandom' $RESULTS_DIR/surf_fillrandom.txt 2>/dev/null | tail -1)" >> "$SUMMARY"
echo "" >> "$SUMMARY"

echo "================================================================" >> "$SUMMARY"
echo "" >> "$SUMMARY"

cat "$SUMMARY"

echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  All benchmarks complete!${NC}"
echo -e "${GREEN}  Results: $RESULTS_DIR/${NC}"
echo -e "${GREEN}  Summary: $RESULTS_DIR/SUMMARY.txt${NC}"
echo -e "${GREEN}============================================${NC}"