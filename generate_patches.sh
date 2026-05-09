#!/bin/bash

# Generates one .patch file per modified source file, saved to project/patches/
# Correctly maps project/ paths to their upstream LevelDB locations so only
# your actual changes show as additions/deletions (not the whole file).
# Run from the ROOT of your repo: bash generate_patches.sh

# Format: ["your_file"] = "upstream_path"
# surf_filter.cc has no upstream equivalent — handled separately
declare -A UPSTREAM_PATHS=(
  ["filter_policy.h"]="include/leveldb/filter_policy.h"
  ["filter_block.cc"]="table/filter_block.cc"
  ["filter_block_test.cc"]="table/filter_block_test.cc"
  ["table.h"]="include/leveldb/table.h"
  ["table.cc"]="table/table.cc"
  ["table_cache.h"]="db/table_cache.h"
  ["table_cache.cc"]="db/table_cache.cc"
  ["version_set.h"]="db/version_set.h"
  ["version_set.cc"]="db/version_set.cc"
  ["options.h"]="include/leveldb/options.h"
  ["db_impl.cc"]="db/db_impl.cc"
  ["db_bench.cc"]="benchmarks/db_bench.cc"
  ["two_level_iterator.cc"]="table/two_level_iterator.cc"
)

# New files with no upstream equivalent
NEW_FILES=(
  "surf_filter.cc"
)

PATCH_DIR="project/patches"
mkdir -p "$PATCH_DIR"

# Add upstream remote if not already present
if ! git remote get-url upstream &>/dev/null; then
  echo "Adding upstream remote..."
  git remote add upstream https://github.com/google/leveldb.git
fi

echo "Fetching upstream..."
git fetch upstream

echo ""
echo "Generating patch files into $PATCH_DIR/ ..."
echo ""

# Diff modified files against their correct upstream path
for FILE in "${!UPSTREAM_PATHS[@]}"; do
  UPSTREAM="${UPSTREAM_PATHS[$FILE]}"
  OUTPUT="$PATCH_DIR/${FILE}.patch"

  git diff "upstream/main:${UPSTREAM}" "project/${FILE}" > "$OUTPUT"

  if [ -s "$OUTPUT" ]; then
    echo "  ✓  ${FILE}.patch  (vs upstream/${UPSTREAM})"
  else
    rm "$OUTPUT"
    echo "  -  ${FILE}.patch  (no changes vs upstream)"
  fi
done

# Handle brand-new files (no upstream counterpart)
for FILE in "${NEW_FILES[@]}"; do
  OUTPUT="$PATCH_DIR/${FILE}.patch"
  git diff --no-index /dev/null "project/${FILE}" > "$OUTPUT" || true

  if [ -s "$OUTPUT" ]; then
    echo "  ✓  ${FILE}.patch  (new file, no upstream equivalent)"
  else
    rm "$OUTPUT"
    echo "  -  ${FILE}.patch  (empty or missing)"
  fi
done

echo ""
echo "Done! Patch files saved to: $PATCH_DIR/"
