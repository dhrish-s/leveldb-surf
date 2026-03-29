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
    leveldb::Status s;

    //pre-write one key , this wil be used to test delete operation in batch
    db->Put(wo,"animal:bear","Large omnivore");

    std::cout << "Before batch operation, animal:bear = " << s.ToString();

    if (s.ok()) {
        std::cout << " , value = " << value;
    }



    // Create a WriteBatch - the shopping basket
    // Nothing written to DB yet - just adding to basket
    // writeBatch is a collection of updates which are done
    // atomically when the batch is written to the DB

  //  1. Writes ONE record to WAL (log file) - this may involve multiple operations to update the log file, but it is atomic - either all or nothing is written to the log file
  //  2. Updates MemTable

    leveldb::WriteBatch batch;
    batch.Put("animal:cat",   "Domestic feline");
    batch.Put("animal:dog",   "Domestic canine");
    batch.Put("animal:eagle", "Large bird of prey");
    batch.Delete("animal:bear");

    std::cout << "Batch prepared: 3 Puts + 1 Delete\n";
    std::cout << "Nothing in DB yet - basket not submitted\n\n";

    // Submit the entire basket atomically
    // One single WAL record for all 4 operations
    // All succeed or none do
    s= db->Write(wo, &batch);
    std::cout << "db->Write(batch) → " << s.ToString() << "\n\n";

    //verify the 4 operations
    s = db -> Get(ro,"animal:cat",&value);
    std::cout << "After batch operation, animal:cat = " << s.ToString();
    if (s.ok()) {
        std::cout << " , value = " << value;
    }

    s = db -> Get(ro,"animal:dog",&value);
    std::cout << "\nAfter batch operation, animal:dog = " << s.ToString();
    if (s.ok()) {
        std::cout << " , value = " << value;
    }

    s = db -> Get(ro,"animal:eagle",&value);
    std::cout << "\nAfter batch operation, animal:eagle = " << s.ToString();
    if (s.ok()) {
        std::cout << " , value = " << value;
    }

    s = db->Get(ro, "animal:bear", &value);
    std::cout << "animal:bear  - ";
    if (s.IsNotFound()) {
        std::cout << "NotFound (deleted in batch)\n";
    } else {
        std::cout << value << "\n";
    }

    // Show log size
    // One batch = one WAL record (smaller than 4 individual records)
    std::cout << "\nLog file (1 batch record = smaller than 4 individual):\n";
    system("ls -la /tmp/mydb/000003.log");

    delete db;
    return 0;

  }



