# D5 - Atomic Batch Writes with WriteBatch
# File: /workspace/project/demos/d05_writebatch.cc

---

## What This Demo Teaches
- How WriteBatch groups multiple operations atomically
- The shopping basket analogy - fill first, submit once
- Why the WAL is smaller with a batch than with individual operations
- The critical C++ bug: always assign Get() return value to s
- Why atomicity matters - all or nothing, never partial

---

## New Header

```cpp
#include "leveldb/write_batch.h"
```
File location: /workspace/leveldb/include/leveldb/write_batch.h
Gives you: leveldb::WriteBatch class
Needed in addition to "leveldb/db.h"

---

## The Code

```cpp
#include <iostream>
#include "leveldb/db.h"
#include "leveldb/write_batch.h"

int main() {
    leveldb::Options options;
    options.create_if_missing = true;
    leveldb::DB* db;
    leveldb::DB::Open(options, "/tmp/mydb", &db);

    leveldb::WriteOptions wo;
    leveldb::ReadOptions ro;
    std::string value;
    leveldb::Status s;        // declare at top - before any use

    s = db->Put(wo, "animal:bear", "Large omnivore");
    std::cout << "Pre-written animal:bear -> " << s.ToString() << "\n\n";

    leveldb::WriteBatch batch;
    batch.Put("animal:cat",   "Domestic feline");
    batch.Put("animal:dog",   "Domestic canine");
    batch.Put("animal:eagle", "Large bird of prey");
    batch.Delete("animal:bear");

    std::cout << "Batch prepared: 3 Puts + 1 Delete\n";
    std::cout << "Nothing in DB yet - basket not submitted\n\n";

    s = db->Write(wo, &batch);
    std::cout << "db->Write(batch) -> " << s.ToString() << "\n\n";

    s = db->Get(ro, "animal:cat", &value);
    std::cout << "animal:cat   -> " << s.ToString()
              << " , value = " << value << "\n";

    s = db->Get(ro, "animal:dog", &value);
    std::cout << "animal:dog   -> " << s.ToString()
              << " , value = " << value << "\n";

    s = db->Get(ro, "animal:eagle", &value);
    std::cout << "animal:eagle -> " << s.ToString()
              << " , value = " << value << "\n";

    s = db->Get(ro, "animal:bear", &value);
    std::cout << "animal:bear  -> ";
    if (s.IsNotFound()) {
        std::cout << "NotFound (deleted in batch)\n";
    } else {
        std::cout << value << "\n";
    }

    std::cout << "\nLog file:\n";
    system("ls -la /tmp/mydb/000003.log");

    delete db;
    return 0;
}
```

---

## New Methods and Parameters

### batch.Put() and batch.Delete()
```cpp
leveldb::WriteBatch batch;
batch.Put("animal:cat", "Domestic feline");
batch.Delete("animal:bear");
```
These are methods on the WriteBatch object - NOT on db.
They just add operations to the internal buffer.
Nothing is written to the database yet.
No disk I/O. No WAL write. Just memory.

### db->Write()
```cpp
s = db->Write(wo, &batch);
```
Parameter 1: wo (WriteOptions) - same sync flag as always
Parameter 2: &batch - address of your WriteBatch basket

This is the moment ALL operations land atomically:
  1. Entire batch serialized into ONE WAL record
  2. WAL record written to disk (or OS buffer if sync=false)
  3. All operations applied to MemTable
  4. Returns OK

Original files this connects to:
  include/leveldb/write_batch.h   class definition
  db/write_batch.cc               how operations stored internally
  db/db_impl.cc DBImpl::Write()   applies batch to WAL and MemTable

---

## C++ Concepts

### Declare Status at Top - Critical Rule
```cpp
leveldb::Status s;    // declare HERE at top of main()
```
Never declare s in the middle of the code.
If you use s before declaring it -> compile error.

WRONG:
```cpp
db->Put(wo, "bear", "value");
std::cout << s.ToString();    // ERROR: s not declared yet
leveldb::Status s = db->Write(...);
```

RIGHT:
```cpp
leveldb::Status s;            // declared first
db->Put(wo, "bear", "value");
s = db->Write(...);           // assigned when needed
std::cout << s.ToString();    // safe - s exists
```

### Always Assign Get() Return Value
The most common bug in LevelDB code:

WRONG:
```cpp
db->Get(ro, "animal:cat", &value);   // return value THROWN AWAY
std::cout << s.ToString();           // s unchanged from previous op
```

RIGHT:
```cpp
s = db->Get(ro, "animal:cat", &value);  // return value STORED
std::cout << s.ToString();              // s reflects THIS Get()
```

Rule: Every LevelDB method that returns Status - assign it. Every time.

### Ternary Operator - Short If/Else
```cpp
std::cout << (s.IsNotFound() ? "NotFound" : value);
```
condition ? value_if_true : value_if_false
Same as:
```cpp
if (s.IsNotFound()) {
    std::cout << "NotFound";
} else {
    std::cout << value;
}
```
Both are correct. Ternary is shorter for simple cases.

---

## The Shopping Basket Analogy

```
WITHOUT WriteBatch:
  db->Put("cat")    -> WAL record 1 written
  db->Put("dog")    -> WAL record 2 written
  db->Put("eagle")  -> WAL record 3 written
  db->Delete("bear")-> WAL record 4 written
  4 separate disk operations
  Between any two: program could crash -> partial state

WITH WriteBatch:
  batch.Put("cat")       -> added to basket (memory only)
  batch.Put("dog")       -> added to basket (memory only)
  batch.Put("eagle")     -> added to basket (memory only)
  batch.Delete("bear")   -> added to basket (memory only)
  db->Write(batch)       -> ONE WAL record, ONE disk operation
  Either all 4 land or none do - no partial state possible
```

---

## Output Explained

```
db->Write(batch) -> OK
```
All 4 operations (3 Put + 1 Delete) written as one atomic unit.

```
animal:cat   -> OK , value = Domestic feline
animal:dog   -> OK , value = Domestic canine
animal:eagle -> OK , value = Large bird of prey
```
All three puts from the batch are readable correctly.

```
animal:bear  -> NotFound (deleted in batch)
```
Bear deleted atomically in the same batch that added cat, dog, eagle.
Never a moment where cat existed but bear was not yet deleted.

```
-rw-r--r-- 1 root root 168 Mar 29 21:26 /tmp/mydb/000003.log
```
Only 168 bytes.
Compare with D4 which had 5 individual operations = 206 bytes.
D5 has MORE total operations (1 Put + 4 in batch = 5) but FEWER bytes.
Because the batch = ONE WAL record with one header instead of five.

WAL contents:
```
Record 1: kTypeValue "animal:bear" -> "Large omnivore"  (pre-write Put)
Record 2: BATCH {
    kTypeValue    "animal:cat"   -> "Domestic feline"
    kTypeValue    "animal:dog"   -> "Domestic canine"
    kTypeValue    "animal:eagle" -> "Large bird of prey"
    kTypeDeletion "animal:bear"
}   ← entire batch = one record
```

---

## Why Atomicity Matters - Real World Example

Imagine transferring money between two bank accounts:
```
db->Put(wo, "account:alice", "900");   // debit alice
// CRASH HERE - alice debited but bob not credited
db->Put(wo, "account:bob", "1100");    // credit bob
```
If process crashes between two Puts: alice lost money, bob never got it.

With WriteBatch:
```
batch.Put("account:alice", "900");
batch.Put("account:bob", "1100");
db->Write(wo, &batch);   // both or neither - no partial state
```
Crash after Write() = both succeed.
Crash before Write() = neither happens.
Never a state where alice is debited but bob is not credited.

---

## Connection to Your Project

During compaction WriteBatch operations are processed together.
FilterBlockBuilder::AddKey() is called for each key in the batch.
SuRFPolicy::CreateFilter() receives all the final live keys.
The atomicity of WriteBatch does not affect the filter directly -
by the time CreateFilter() is called, compaction has already
merged all versions and tombstones into the final live key set.

---

## Run Command

```bash
# Compile
g++ -std=c++17 \
    -I /workspace/leveldb/include \
    -L /workspace/leveldb/build \
    /workspace/project/demos/d05_writebatch.cc \
    -o /workspace/project/demos/d05 \
    -lleveldb -lpthread -lsnappy

# Run
rm -rf /tmp/mydb && /workspace/project/demos/d05
```