#include <iostream>
#include "leveldb/db.h"

int main(){
  leveldb::Options options;
  options.create_if_missing = true;
  options.write_buffer_size = 4096;
  leveldb::DB* db;
  leveldb::DB::Open(options,"/tmp/mydb",&db);

  leveldb::WriteOptions wo;

  //Step 1 : write keys and check files BEFORE compaction
  // write 200 keys and then we are putting in the leveldb
  std::cout<<"Writing 200 keys,,,,\n";
  for(int i=0;i<200;i++){
    std::string key = "key"+std::to_string(i);
    std::string value = "value"+std::to_string(i);
    db->Put(wo,key,value);
}


// Also write some keys we will then delete
// Their tombstones exist now - compaction will clean them up
// Tombstones are morelike markeres or like tracker of deleted keys
// They are not actual deletions but they are like markers that indicate that a key has been deleted
   db->Put(wo, "temp:a", "will be deleted");
    db->Put(wo, "temp:b", "will be deleted");
    db->Put(wo, "temp:c", "will be deleted");
    db->Delete(wo, "temp:a");
    db->Delete(wo, "temp:b");
    db->Delete(wo, "temp:c");

  std::cout<<"\nFiles BEFORE compaction: \n";

  system("ls -la /tmp/mydb/*.ldb 2>/dev/null || echo '  no .ldb files yet'");
  // the above command lists the .ldb files in the /tmp/mydb directory,
  //which are the files that leveldb creates to store data.
  // The "2>/dev/null" part is used to suppress error messages
  //if there are no .ldb files yet, and the "|| echo '
  // no .ldb files yet'" part is used to print a message
  // if there are no .ldb files.

  std::string stats;
  db->GetProperty("leveldb.stats", &stats);
  std::cout<<"\nStats BEFORE compaction:\n"<<stats<<"\n";

    // Step 2: force compaction
    // nullptr, nullptr = compact entire key range
    // This calls CreateFilter() for every new SSTable built
    // YOUR SuRFPolicy::CreateFilter() will run here in Week 2
    std::cout << "Forcing compaction (CreateFilter() runs here)...\n";
    db->CompactRange(nullptr, nullptr);
    std::cout << "Compaction complete\n\n";
    //Compaction is the process of merging multiple SSTables into a single SSTable, which helps to reduce the number of files and improve read performance.
    //CompactRange() is a method that forces a compaction of the entire key range, which means that all the SSTables will be merged into a single SSTable.

    // Step 3: check files AFTER compaction
    std::cout << "Files AFTER compaction:\n";
    system("ls -la /tmp/mydb/*.ldb 2>/dev/null || echo '  no .ldb files'");

        db->GetProperty("leveldb.stats", &stats);
    std::cout << "\nStats AFTER compaction:\n" << stats << "\n";

    // Step 4: inspect SSTable listing - key ranges per file
    std::string sstables;
    db->GetProperty("leveldb.sstables", &sstables);
    std::cout << "SSTable listing (file:size[smallest..largest]):\n";
    std::cout << sstables << "\n";

    // Step 5: verify deleted keys are gone (tombstones cleaned up)
    leveldb::ReadOptions ro;
    std::string value;
    leveldb::Status s;
    std::cout << "Verifying tombstones cleaned up:\n";
    s = db->Get(ro, "temp:a", &value);
    std::cout << "  temp:a: "
              << (s.IsNotFound() ? "NotFound (cleaned by compaction)" : value)
              << "\n";

    delete db;
    return 0;

}




