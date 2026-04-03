# Week 2 Notes: SuRF Filter Implementation


---

## What Week 2 Did

Replaced LevelDB's Bloom filter interface with SuRF (Succinct Range Filter).
Two files were changed. One planned change was deliberately skipped.

---

## File 1: project/filter_policy.h

### What Changed
Two additions to the original LevelDB file:

**Addition 1: RangeMayMatch method inside FilterPolicy class**
```cpp
virtual bool RangeMayMatch(const Slice& lo, const Slice& hi,
                           const Slice& filter) const {
  return true;
}
```

Why not pure virtual (= 0):
  BloomFilterPolicy inherits FilterPolicy and never implements RangeMayMatch.
  If it were pure virtual, Bloom would fail to compile.
  A regular virtual with default return true means Bloom works unchanged.

Why return true as default:
  The safety rule: false = NO key in range (must be correct, never lie).
  Returning true always means "maybe has keys" -- the safest possible answer.
  LevelDB opens every SSTable it normally would. No data is ever missed.
  Performance is unchanged from before. Existing behavior preserved.

Why no LEVELDB_EXPORT on the method:
  The class already has LEVELDB_EXPORT. Virtual methods inside an exported
  class are exported automatically. Adding it to each method is redundant.

**Addition 2: Factory function declaration**
```cpp
LEVELDB_EXPORT const FilterPolicy* NewSuRFFilterPolicy();
```

Why LEVELDB_EXPORT here:
  This is a free function, not a class method. Free functions are NOT
  automatically exported. They need LEVELDB_EXPORT explicitly.
  Same pattern as NewBloomFilterPolicy above it.

Why just a declaration here:
  Header = declaration (what exists). .cc file = definition (what it does).
  Definition lives in surf_filter.cc. Same pattern as bloom.cc.

---

## File 2: project/surf_filter.cc

### Structure
```
namespace leveldb {
    anonymous namespace {
        class SuRFPolicy : public FilterPolicy
    }
    NewSuRFFilterPolicy()   <- factory, visible outside file
}
```

Anonymous namespace makes SuRFPolicy invisible outside this file.
Only NewSuRFFilterPolicy() is the public entry point.
Same pattern as BloomFilterPolicy in bloom.cc.

### Name()
```cpp
return "leveldb.SuRFFilter";
```
Stored in every SSTable as "filter.leveldb.SuRFFilter".
On read, LevelDB looks for this exact string.
Mismatch = filter silently ignored. NEVER change this string.

### CreateFilter()
```cpp
void CreateFilter(const Slice* keys, int n, std::string* dst) const override {
    if (n == 0) return;
    std::vector<std::string> key_strs;
    key_strs.reserve(n);
    for (int i = 0; i < n; i++) {
        key_strs.push_back(keys[i].ToString());
    }
    surf::SuRF leveldb_surf(key_strs);
    char* key_bytes = leveldb_surf.serialize();
    uint64_t key_len = leveldb_surf.serializedSize();
    dst->append(key_bytes, key_len);
    delete[] key_bytes;
}
```

Keys arrive sorted (LevelDB guarantee). SuRF requires sorted input.
InternalFilterPolicy strips internal key bytes before calling here.
You receive clean user keys: "animal:cat" not "animal:cat\x01\x00...".
serialize() returns char* allocated with new char[]. Must delete[].
append() not assign() -- never overwrite existing dst contents.

### KeyMayMatch()
```cpp
bool KeyMayMatch(const Slice& key, const Slice& filter) const override {
    if (filter.empty()) return true;
    char* src = const_cast<char*>(filter.data());
    surf::SuRF* surf = surf::SuRF::deSerialize(src);
    bool result = surf->lookupKey(key.ToString());
    surf->destroy();
    delete surf;
    return result;
}
```

const_cast: filter.data() is const char*, deSerialize needs char*.
Cast is safe because deSerialize only reads bytes, never writes.
destroy() then delete: deSerialize creates LoudsDense and LoudsSparse
internally. destroy() frees those. delete frees the outer SuRF shell.
Skipping destroy() leaks the internal objects.

### RangeMayMatch()
```cpp
bool RangeMayMatch(const Slice& lo, const Slice& hi,
                   const Slice& filter) const override {
    if (filter.empty()) return true;
    char* src = const_cast<char*>(filter.data());
    surf::SuRF* surf_obj = surf::SuRF::deSerialize(src);
    bool result = surf_obj->lookupRange(
        lo.ToString(), true,
        hi.ToString(), true
    );
    surf_obj->destroy();
    delete surf_obj;
    return result;
}
```

surf_obj not surf: avoids name collision with surf:: namespace.
lookupRange is NOT const in surf.hpp (modifies iter_ internally).
RangeMayMatch IS const. Using a local pointer (not a member) is fine
because local variables are never const even in const methods.
true, true = inclusive bounds [lo, hi] matching D7 range scan pattern.

---

## File 3: filter_block.cc -- WHY WE DID NOT CHANGE IT

### What the original plan said
Buffer all keys, call CreateFilter() once in Finish() instead of every 2KB.
Goal: SuRF needs all keys together to build a meaningful trie.

### Why we did not do it
The FilterBlockTest.MultiChunk test requires per-block isolation:
```
KeyMayMatch(0, "hello") must return FALSE
because "hello" was only added at block offset 3100, not block 0.
```

If we buffer all keys into one filter, "hello" appears in the combined
filter. KeyMayMatch(0, "hello") would return TRUE. Test fails.

The existing FilterBlockReader is designed around per-2KB mini-filters.
Its KeyMayMatch uses block_offset >> 11 as an index into the offset table.
Changing the writer without changing the reader and tests breaks everything.

### What this means for the project
The filter_block.cc change was an optimization for SuRF quality -- not
a requirement for correctness. The project still works without it because:

RangeMayMatch() operates at the SSTable level in table_cache.cc.
It checks whether the WHOLE SSTable has any keys in [lo, hi].
This check happens BEFORE the SSTable is opened.
The per-block filter inside the SSTable is irrelevant for range pruning.

SuRF per 2KB chunk is less accurate than SuRF over all keys.
But it still provides range filtering. A 2KB chunk that has no keys
in [lo, hi] will correctly return false for RangeMayMatch.
False positive rate is higher but correctness is maintained.

### Future improvement (not required for this project)
The clean way to do this is to build a SEPARATE per-SSTable SuRF filter
in TableBuilder alongside the existing per-block Bloom filter.
Store it in a new metadata block in the SSTable.
Use it for RangeMayMatch. Keep Bloom for KeyMayMatch.
This requires changes to table_builder.cc, table.cc, and table_cache.cc.

---

## Test Results After Week 2

210 tests pass, 1 skipped (zstd compression -- expected).
All original LevelDB tests pass with SuRF integrated.
filter_block.cc reverted to original to maintain test compatibility.

---

## What Week 3 Does

Wire RangeMayMatch into the range scan path:

File 1: db/table_cache.cc
  Add RangeMayMatch check before FindTable() in NewIterator()
  If false: return empty iterator, skip SSTable entirely

File 2: db/version_set.cc
  Thread [lo, hi] range from AddIterators() down to GetFileIterator()

File 3: table/two_level_iterator.cc
  Pass range bounds to inner iterator creation

The threading: lo and hi must travel through:
  AddIterators() -> NewConcatenatingIterator() -> GetFileIterator()
  -> TableCache::NewIterator() -> RangeMayMatch check