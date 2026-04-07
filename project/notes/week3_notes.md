# Week 3 Notes — Range Scan Integration
# File: project/notes/week3_notes.md


---

## Goal

Wire `RangeMayMatch` into the range scan path so that when a range query
`[lo, hi]` runs, SuRF is consulted for each candidate SSTable. If SuRF says
no key exists in `[lo, hi]`, that SSTable is skipped entirely — no data block
reads.

---

## The Core Architectural Constraint Discovered

**RangeMayMatch cannot run before FindTable().**

This was the most important architectural insight of Week 3.

The filter bytes (serialized SuRF trie) live inside the `.ldb` SSTable file
in the filter block. To read those bytes, the file must be opened. Opening
the file IS `FindTable()`. Therefore there is no way to call `RangeMayMatch`
before `FindTable()` — the filter does not exist in memory yet.

```
WRONG mental model:
  RangeMayMatch(lo, hi)  ← check before opening file
  if false: skip
  FindTable()            ← open file only if needed

CORRECT model:
  FindTable()            ← open file, loads filter block into memory
  filter now in RAM
  RangeMayMatch(lo, hi)  ← NOW we can check (filter bytes available)
  if false: release handle, return empty iterator
  table->NewIterator()   ← only reaches here if RangeMayMatch = true
```

A pre-open range check would require storing filter data in a separate cache
tier independent of the SSTable file. RocksDB implemented this as partitioned
filters in 2017. It is a significant storage layout redesign outside our scope.

---

## Threading Problem

The query range `[lo, hi]` must travel through multiple layers to reach
`table_cache.cc::NewIterator()` where the check happens.

Call chain:
```
DB::NewIterator(options)
  └── DBImpl::NewInternalIterator()              [db_impl.cc]
        └── Version::AddIterators()              [version_set.cc]
              Level 0: TableCache::NewIterator() ← needs lo/hi
              Level 1+: NewConcatenatingIterator()
                └── NewTwoLevelIterator(GetFileIterator, arg)
                      └── GetFileIterator(void* arg)
                            └── TableCache::NewIterator() ← needs lo/hi
```

`GetFileIterator` takes `void* arg`. Originally this carried only
`TableCache*`. We needed to carry `{cache, lo, hi}` — so we introduced
`TableCacheArg` struct.

---

## Files Changed

### `include/leveldb/table.h`
Added one public method declaration:
```cpp
bool RangeMayMatch(const Slice& lo, const Slice& hi) const;
```

**Why public:** `table_cache.cc` needs to call this. `Table::rep_` is private.
We could use `friend class TableCache` but `Rep` is only forward-declared in
`table.h` — its members are only visible in `table.cc`. So we expose the check
as a proper public method.

### `table/table.cc`
Implemented `RangeMayMatch`:
```cpp
bool Table::RangeMayMatch(const Slice& lo, const Slice& hi) const {
  if (rep_->filter == nullptr) return true;
  return rep_->filter->RangeMayMatch(lo, hi);
}
```

**Why `rep_->filter == nullptr` check:** Some SSTables have no filter
(if no `filter_policy` was set in Options). Safe fallback = open everything.

### `db/table_cache.h`
Updated `NewIterator` signature to add `lo` and `hi` with defaults:
```cpp
Iterator* NewIterator(const ReadOptions& options,
                      uint64_t file_number,
                      uint64_t file_size,
                      const Slice& lo = Slice(),
                      const Slice& hi = Slice(),
                      Table** tableptr = nullptr);
```

**Why `Slice()` defaults:** Many callers (compaction, recovery,
`ApproximateOffsetOf`) call `NewIterator` without range bounds. Default empty
`Slice` means "no range filter" — those callers work unchanged.

**Why `lo` and `hi` before `tableptr`:** All three have defaults. C++ requires
that once you have a default parameter, all subsequent parameters must also have
defaults. `tableptr` was already defaulting to `nullptr`, so `lo` and `hi` can
go before it.

### `db/table_cache.cc`
Core change — added `RangeMayMatch` check after `FindTable()`:
```cpp
if (!lo.empty() && !hi.empty()) {
  if (!table->RangeMayMatch(lo, hi)) {
    cache_->Release(handle);
    return NewEmptyIterator();
  }
}
```

**Why `cache_->Release(handle)`:** `FindTable()` incremented the cache
reference count. If we skip the SSTable, we must release the handle or
it leaks — the LRU cache can never evict that entry.

**Why `!lo.empty() && !hi.empty()`:** Empty Slice = default = no range
provided. This guard makes the check a no-op for all existing callers.

Also added `#include "table/filter_block.h"` — needed for `FilterBlockReader`
type. Later removed when we moved to `table->RangeMayMatch()` public method.

### `db/version_set.h`
Updated two signatures:
```cpp
void AddIterators(const ReadOptions&, std::vector<Iterator*>* iters,
                  const Slice& lo = Slice(), const Slice& hi = Slice());

Iterator* NewConcatenatingIterator(const ReadOptions&, int level,
                                   const Slice& lo = Slice(),
                                   const Slice& hi = Slice()) const;
```

### `db/version_set.cc`
Four changes:

**1. Added `TableCacheArg` struct** to carry cache + range through `void*`:
```cpp
struct TableCacheArg {
  TableCache* cache;
  Slice lo;
  Slice hi;
};

static void DeleteTableCacheArg(void* arg, void*) {
  delete reinterpret_cast<TableCacheArg*>(arg);
}
```

**Why a struct:** `NewTwoLevelIterator` takes `void* arg` for its callback.
Previously `arg` was just `TableCache*`. Now we need to carry `{cache, lo, hi}`
so `GetFileIterator` can pass them to `NewIterator`.

**Why `DeleteTableCacheArg`:** The struct is heap-allocated. When the
`TwoLevelIterator` is destroyed, it calls registered cleanups. We register
`DeleteTableCacheArg` to free the struct — otherwise memory leaks.

**2. Updated `GetFileIterator`** to unpack the struct:
```cpp
static Iterator* GetFileIterator(void* arg, const ReadOptions& options,
                                 const Slice& file_value) {
  TableCacheArg* tca = reinterpret_cast<TableCacheArg*>(arg);
  // ...
  return tca->cache->NewIterator(options, num, size, tca->lo, tca->hi);
}
```

**3. Updated `NewConcatenatingIterator`** to create the struct:
```cpp
Iterator* Version::NewConcatenatingIterator(..., const Slice& lo,
                                             const Slice& hi) const {
  TableCacheArg* arg = new TableCacheArg{vset_->table_cache_, lo, hi};
  Iterator* iter = NewTwoLevelIterator(..., &GetFileIterator, arg, options);
  iter->RegisterCleanup(&DeleteTableCacheArg, arg, nullptr);
  return iter;
}
```

**4. Updated `AddIterators`** to accept and pass `lo/hi`:
```cpp
void Version::AddIterators(..., const Slice& lo, const Slice& hi) {
  // Level 0: direct call with lo/hi
  for (...) {
    iters->push_back(table_cache_->NewIterator(..., lo, hi));
  }
  // Level 1+: concatenating iterator with lo/hi
  for (...) {
    iters->push_back(NewConcatenatingIterator(options, level, lo, hi));
  }
}
```

**5. Updated `MakeInputIterator`** (compaction):
Compaction also calls `GetFileIterator` but has no range — must pass empty
struct:
```cpp
TableCacheArg* carg = new TableCacheArg{table_cache_, Slice(), Slice()};
Iterator* citer = NewTwoLevelIterator(..., &GetFileIterator, carg, options);
citer->RegisterCleanup(&DeleteTableCacheArg, carg, nullptr);
list[num++] = citer;
```

**6. Fixed `ApproximateOffsetOf`**:
This function calls `NewIterator` with `tableptr` — had to add explicit
`Slice(), Slice()` before `&tableptr` when signatures changed:
```cpp
Iterator* iter = table_cache_->NewIterator(
    ReadOptions(), files[i]->number, files[i]->file_size,
    Slice(), Slice(), &tableptr);
```

---

## Errors Encountered and Fixed

### Error 1 — `table_cache.h` not copied by `rebuild.sh`
`rebuild.sh` copied `table_cache.cc` but not `table_cache.h`. The container
had the old header. Fixed by adding copy rule to `rebuild.sh`.

### Error 2 — Signature parameter order mismatch
The `.cc` had `(options, num, size, lo, hi, tableptr)` but the `.h` still had
old order. Fixed by aligning both to the same order.

### Error 3 — `table->rep_->filter` incomplete type
`table.h` only has `struct Rep;` as a forward declaration. `Rep` is fully
defined only in `table.cc`. Even with `friend class TableCache`, `table_cache.cc`
cannot access `rep_->filter` because it does not know what `Rep` contains.
Fixed by adding `bool RangeMayMatch(lo, hi)` as a public method on `Table`.

### Error 4 — `KeyMayMatch` vs `RangeMayMatch` typo
A teammate wrote `filter->KeyMayMatch(lo, hi)` instead of
`filter->RangeMayMatch(lo, hi)`. Type error: `KeyMayMatch` takes
`(uint64_t block_offset, const Slice& key)` not two Slices.

### Error 5 — `version_set.h` not in project folder
Had to copy from container: `cp /workspace/leveldb/db/version_set.h /workspace/project/version_set.h`

---

## Test Result

**210/210 tests pass** after all Week 3 changes.

---

## Architecture After Week 3

```
DB::NewIterator(options)
  └── DBImpl::NewInternalIterator(options)        [db_impl.cc]
        └── versions_->current()->AddIterators(options, &list)
              ← lo/hi are empty here (db_impl.cc not yet updated)
              └── Version::AddIterators(options, list, lo, hi)  [version_set.cc]
                    Level 0:
                      TableCache::NewIterator(options, num, size, lo, hi)
                        FindTable()  ← opens SSTable, loads filter
                        if lo/hi non-empty: table->RangeMayMatch(lo, hi)
                          false → cache_->Release(); return NewEmptyIterator()
                          true  → table->NewIterator()
                    Level 1+:
                      NewConcatenatingIterator(options, level, lo, hi)
                        TableCacheArg{cache, lo, hi} → void* arg
                        NewTwoLevelIterator(LevelFileNumIterator,
                                           GetFileIterator, arg)
                          GetFileIterator unpacks arg
                          → TableCache::NewIterator(..., lo, hi)
                             same check as Level 0
```