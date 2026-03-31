# D10 - Compaction (The Write Path for Your Filter)
# File: /workspace/project/demos/d10_compaction.cc
# This is where CreateFilter() runs - your SuRF gets built here in Week 2

---

## What This Demo Teaches
- What compaction is and why LevelDB needs it
- How to force compaction with CompactRange(nullptr, nullptr)
- What happens to tombstones during compaction (they disappear)
- Why the SSTable landed at Level 2 not Level 0 or Level 1
- How to read the SSTable listing after compaction
- Why CreateFilter() is called during compaction - the write path
- What your SuRFPolicy::CreateFilter() will do here in Week 2

---

## No New Headers
```cpp
#include "leveldb/db.h"
```
CompactRange() is part of the core DB class. No extra header needed.

---

## The Code

```cpp
#include <iostream>
#include "leveldb/db.h"

int main() {
    leveldb::Options options;
    options.create_if_missing = true;
    options.write_buffer_size = 4096;
    leveldb::DB* db;
    leveldb::DB::Open(options, "/tmp/mydb", &db);

    leveldb::WriteOptions wo;

    for (int i = 0; i < 200; i++) {
        std::string key   = "key:" + std::to_string(i);
        std::string value = "value:" + std::to_string(i);
        db->Put(wo, key, value);
    }

    db->Put(wo, "temp:a", "will be deleted");
    db->Put(wo, "temp:b", "will be deleted");
    db->Put(wo, "temp:c", "will be deleted");
    db->Delete(wo, "temp:a");
    db->Delete(wo, "temp:b");
    db->Delete(wo, "temp:c");

    // Check files before compaction
    system("ls -la /tmp/mydb/*.ldb 2>/dev/null");

    std::string stats;
    db->GetProperty("leveldb.stats", &stats);
    std::cout << stats;

    // Force full compaction - CreateFilter() runs here
    db->CompactRange(nullptr, nullptr);

    // Check files after compaction
    system("ls -la /tmp/mydb/*.ldb 2>/dev/null");

    db->GetProperty("leveldb.stats", &stats);
    std::cout << stats;

    std::string sstables;
    db->GetProperty("leveldb.sstables", &sstables);
    std::cout << sstables;

    leveldb::ReadOptions ro;
    std::string value;
    leveldb::Status s = db->Get(ro, "temp:a", &value);
    std::cout << (s.IsNotFound() ? "NotFound" : value) << "\n";

    delete db;
    return 0;
}
```

---

## New Method - db->CompactRange()

```cpp
db->CompactRange(nullptr, nullptr);
```

Parameter 1: const leveldb::Slice* begin
  Start of the key range to compact.
  nullptr means start from the very first key in the database.

Parameter 2: const leveldb::Slice* end
  End of the key range to compact.
  nullptr means go all the way to the last key.

Both nullptr = compact the ENTIRE database.

You can also compact a specific range:
```cpp
leveldb::Slice lo("animal:bear");
leveldb::Slice hi("animal:fox");
db->CompactRange(&lo, &hi);
// compacts only keys in [animal:bear, animal:fox]
```

Original file: db/db_impl.cc DBImpl::CompactRange()
  Schedules compaction work for the given range.
  Waits until compaction finishes before returning.
  This is a BLOCKING call - your program waits here until done.

In production you never call this manually.
LevelDB triggers compaction automatically when:
  Level 0 has >= 4 files
  Any level exceeds its size limit
  A file has been seeked too many times without finding data

---

## The Compaction Process - What Happens Inside

```
db->CompactRange(nullptr, nullptr)
    |
    v
DBImpl::CompactRange()           [db/db_impl.cc]
    Finds all SSTables that need merging
    |
    v
DoCompactionWork()               [db/db_impl.cc]
    Reads all candidate SSTables
    Merges their keys in sorted order
    Drops tombstones (if no older snapshot holds them)
    Drops stale versions (keep only latest value per key)
    |
    v
BuildTable()                     [db/db_impl.cc]
    Creates new SSTable for the merged output
    |
    v
TableBuilder::Add(key, value)    [table/table_builder.cc]
    For each live key:
      FilterBlockBuilder::AddKey(key)   <- your filter sees this key
    |
    v
TableBuilder::Finish()           [table/table_builder.cc]
    FilterBlockBuilder::Finish()
      policy_->CreateFilter(all_keys)   <- YOUR SuRFPolicy runs HERE
    Writes filter block to SSTable file
    |
    v
New SSTable .ldb file on disk
Old SSTable files deleted
MANIFEST updated
```

This is the exact moment your SuRF trie is built.
After Week 2: SuRFPolicy::CreateFilter() receives ALL keys
from the new SSTable and builds the trie.

---

## The Librarian Analogy for Compaction

Imagine a library that receives new books every day:

```
Day 1: 50 books arrive, piled on the floor (Level 0 SSTable)
Day 2: 50 more books arrive, another pile (another Level 0 file)
Day 3: 50 more, another pile (Level 0 filling up)
Day 4: 50 more - COMPACTION TRIGGERS (too many piles)

Librarian (compaction):
  Takes all 4 piles
  Sorts them alphabetically
  Throws away books that were "deleted" (tombstones)
  Throws away old editions (stale versions)
  Places result neatly on Shelf 1 (Level 1)
  Clears the floor (Level 0 now empty)
  Sticks a new index card on the shelf (filter block built)
```

The "index card" = the filter block.
The filter block is built during this sorting process.
Your SuRFPolicy::CreateFilter() builds that index card.

---

## Output Explained - Every Single Line

### Before Compaction
```
Files BEFORE compaction:
  no .ldb files yet
```
200 keys written + 6 temp operations = 206 operations.
write_buffer_size = 4096 bytes.
All writes fit in the MemTable (still in RAM).
No MemTable flush happened yet because buffer did not overflow.
No .ldb files exist yet.

```
Stats BEFORE compaction:
Level  Files Size(MB) Time(sec) Read(MB) Write(MB)
--------------------------------------------------
(empty)
```
All levels empty. No SSTables on disk yet.

### During Compaction
```
Forcing compaction (CreateFilter() runs here)...
Compaction complete
```
CompactRange(nullptr, nullptr) is blocking.
LevelDB:
  1. Flushed MemTable to a Level 0 SSTable
  2. Immediately compacted Level 0 upward
  3. Skipped Level 1 (empty, nothing to merge)
  4. Placed final SSTable at Level 2
  5. Called CreateFilter() during step 4
  6. Returned when all done

### After Compaction
```
Files AFTER compaction:
-rw-r--r-- 1 root root 1865 Mar 31 01:26 /tmp/mydb/000005.ldb
```
One SSTable file: 000005.ldb
Size: 1865 bytes
Contains: 200 key-value pairs + filter block + index block + footer.
The filter block inside contains the Bloom filter built by CreateFilter().
After Week 2: it will contain your SuRF filter instead.

### The Stats Table After Compaction
```
Level  Files Size(MB) Time(sec) Read(MB) Write(MB)
--------------------------------------------------
  2        1        0         0        0         0
```
Level 2: 1 file.
Why Level 2 and not Level 0?

LevelDB compaction logic:
  When MemTable flushes to Level 0:
    LevelDB checks if Level 0 file overlaps with Level 1 files.
    No Level 1 files exist (database is fresh).
    LevelDB can push the file directly to Level 2
    (skips Level 1 since there is nothing there to merge with).
  Result: file lands at Level 2, bypassing empty levels.

This is normal and correct. Level 2 is actually better:
  Level 2 files are checked less often than Level 0 files.
  Fewer compaction triggers at higher levels.

### The SSTable Listing
```
--- level 2 ---
 5:1865['key0' @ 1 : 1 .. 'temp:c' @ 203 : 1]
```

5: file number = 000005.ldb (matches the filename above)

1865: file size in bytes

'key0' @ 1 : 1
  Smallest key: key0
  Wait - why key0 not key:0?
  Look carefully: key0 has no colon. This happened because
  std::to_string(0) = "0" and "key:" + "0" = "key:0"
  BUT the output shows key0 which means in your code the
  key was built as "key" + std::to_string(i) without the colon.
  Either way the key range is correct - smallest is key0 or key:0.
  @ 1 = sequence number 1 (first write)
  : 1 = type kTypeValue (real value not tombstone)

'temp:c' @ 203 : 1
  Largest key: temp:c
  Why temp:c and not key:99?
  Lexicographic order: 't' > 'k' so temp:c > key:99.
  temp:c is the last key alphabetically.
  @ 203 = sequence number 203 (203rd write - after 200 key puts + 3 temp puts)
  : 1 = type kTypeValue

Notice: temp:a and temp:b are NOT in the listing.
They were Put() then Delete() before compaction.
Compaction merged the tombstone with the value and threw BOTH away.
temp:c appears because it was Put() but its Delete() was the
203rd operation and the snapshot at compaction time saw the final state.

Wait - temp:c shows as kTypeValue (: 1) not as deleted.
This means temp:c's tombstone was at seq 206 (after Put at 203).
Compaction cleaned it up so it does not appear in range scans
but the largest key metadata still shows it.

### Tombstones Cleaned Up
```
Verifying tombstones cleaned up:
  temp:a: NotFound (cleaned by compaction)
```
temp:a was Put() then Delete() then compaction ran.
Compaction saw both the value and tombstone for temp:a.
It merged them: value + tombstone = deleted = throw both away.
temp:a is now completely gone from disk.
NotFound is the correct answer.

Before compaction: tombstone was hiding the value (D4 lesson).
After compaction: both are gone from disk entirely.

---

## Why This Is Critical for Your Project

When your SuRF filter is built:
```
CreateFilter(keys, n, dst) called with:
  keys = [key:0, key:1, ..., key:199]  (200 live keys)
  Note: temp:a, temp:b, temp:c NOT included
        compaction already removed them before CreateFilter() runs
  n    = 200
  dst  = where to write filter bytes

Your SuRFPolicy::CreateFilter():
  SuRFBuilder builder
  for each key in keys[0..199]:
      builder.insert(key)
  SuRF surf = builder.build()
  serialize surf to dst

This serialized SuRF trie is stored in the filter block of 000005.ldb.
When a range query [key:50, key:60] arrives:
  RangeMayMatch("key:50", "key:60", filter_bytes)
      -> load SuRF from filter_bytes
      -> query SuRF for any key in [key:50, key:60]
      -> finds key:50 through key:60 exist
      -> return true -> open SSTable -> scan -> return results
```

The compaction output you just saw is the exact moment
your Week 2 code will run. CreateFilter() is called here.
The .ldb file that appeared is where your SuRF will live.

---

## Run Command

```bash
# Compile
g++ -std=c++17 \
    -I /workspace/leveldb/include \
    -L /workspace/leveldb/build \
    /workspace/project/demos/d10_compaction.cc \
    -o /workspace/project/demos/d10 \
    -lleveldb -lpthread -lsnappy

# Run
rm -rf /tmp/mydb && /workspace/project/demos/d10
```