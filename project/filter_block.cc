// Copyright (c) 2012 The LevelDB Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file. See the AUTHORS file for names of contributors.

#include "table/filter_block.h"

#include "leveldb/filter_policy.h"
#include "util/coding.h"

namespace leveldb {

// See doc/table_format.md for an explanation of the filter block format.

// Generate new filter every 2KB of data
static const size_t kFilterBaseLg = 11;
static const size_t kFilterBase = 1 << kFilterBaseLg;

FilterBlockBuilder::FilterBlockBuilder(const FilterPolicy* policy)
    : policy_(policy) {}

void FilterBlockBuilder::StartBlock(uint64_t block_offset) {
  // SuRF: do not generate per-2KB filters
  // All keys accumulate in keys_ until Finish() calls GenerateFilter() once
  // We still track filter_index to satisfy the assert but never flush keys
  uint64_t filter_index = (block_offset / kFilterBase);
  assert(filter_index >= filter_offsets_.size());
  // added for SuRF
  (void)filter_index;  // suppress unused variable warning
}

void FilterBlockBuilder::AddKey(const Slice& key) {
  Slice k = key;
  start_.push_back(keys_.size());
  keys_.append(k.data(), k.size());
}

// added for SuRF
Slice FilterBlockBuilder::Finish() {
  // Build ONE filter from ALL buffered keys across the entire SSTable
  if (!start_.empty()) {
    GenerateFilter();
  }

  // If no keys were ever added, write original format so reader returns true
  // Original format: array_offset=0, base_lg_=11 -> num_=0 -> fallthrough -> true
  if (result_.empty()) {
    PutFixed32(&result_, 0);   // array_offset = 0
    result_.push_back(kFilterBaseLg);  // base_lg_ = 11
    return Slice(result_);
  }

  // Write offset table with ONE entry pointing to the single filter
  // base_lg_ = 32 so block_offset >> 32 = 0 for any block offset
  // FilterBlockReader always uses filter[0] for every block
  const uint32_t array_offset = result_.size();
  PutFixed32(&result_, 0);            // entry[0]: filter starts at byte 0
  PutFixed32(&result_, array_offset); // entry[1]: sentinel, filter ends here
  PutFixed32(&result_, array_offset); // footer: offset table location
  result_.push_back(32);              // base_lg_ = 32
  return Slice(result_);
}
void FilterBlockBuilder::GenerateFilter() {
  const size_t num_keys = start_.size();
  if (num_keys == 0) {
    // Fast path if there are no keys for this filter
    filter_offsets_.push_back(result_.size());
    return;
  }

  // Make list of keys from flattened key structure
  start_.push_back(keys_.size());  // Simplify length computation
  tmp_keys_.resize(num_keys);
  for (size_t i = 0; i < num_keys; i++) {
    const char* base = keys_.data() + start_[i];
    size_t length = start_[i + 1] - start_[i];
    tmp_keys_[i] = Slice(base, length);
  }

  // Generate filter for current set of keys and append to result_.
  filter_offsets_.push_back(result_.size());
  policy_->CreateFilter(&tmp_keys_[0], static_cast<int>(num_keys), &result_);

  tmp_keys_.clear();
  keys_.clear();
  start_.clear();
}

FilterBlockReader::FilterBlockReader(const FilterPolicy* policy,
                                     const Slice& contents)
    : policy_(policy), data_(nullptr), offset_(nullptr), num_(0), base_lg_(0) {
  size_t n = contents.size();
  if (n < 5) return;  // 1 byte for base_lg_ and 4 for start of offset array
  base_lg_ = contents[n - 1];
  uint32_t last_word = DecodeFixed32(contents.data() + n - 5);
  if (last_word > n - 5) return;
  data_ = contents.data();
  offset_ = data_ + last_word;
  num_ = (n - 5 - last_word) / 4;
}

bool FilterBlockReader::KeyMayMatch(uint64_t block_offset, const Slice& key) {
  uint64_t index = block_offset >> base_lg_;
  if (index < num_) {
    uint32_t start = DecodeFixed32(offset_ + index * 4);
    uint32_t limit = DecodeFixed32(offset_ + index * 4 + 4);
    if (start <= limit && limit <= static_cast<size_t>(offset_ - data_)) {
      Slice filter = Slice(data_ + start, limit - start);
      return policy_->KeyMayMatch(key, filter);
    } else if (start == limit) {
      // Empty filters do not match any keys
      return false;
    }
  }
  return true;  // Errors are treated as potential matches
}

// added for SuRF
bool FilterBlockReader::RangeMayMatch(const Slice& lo, const Slice& hi) {
  for (uint32_t i = 0; i < num_; i++) { // loop through all mini-filters
    uint32_t start = DecodeFixed32(offset_ + i * 4); // use offset to find the block related to that mini-filter
    uint32_t limit = DecodeFixed32(offset_ + i * 4 + 4);
    if (start <= limit && limit <= static_cast<size_t>(offset_ - data_)) {
      Slice filter = Slice(data_ + start, limit - start); // bytes that belong to  mini-filter i
      if (policy_-> RangeMayMatch(lo, hi, filter)) {
        return true;
      }
    }
  }
  return false;
}

}  // namespace leveldb
