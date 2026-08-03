/**
 * Migration: Fix Customer phone index — global → branch-scoped
 *
 * PURPOSE:
 *   The old index `{ phone: 1 }` (globally unique) prevented the same phone
 *   number from being registered as a customer in more than one branch.
 *   This migration drops that index and creates a branch-scoped unique index
 *   `{ branch: 1, phone: 1 }` so each branch maintains independent customer records.
 *
 * WHEN TO RUN:
 *   Run ONCE in a maintenance window BEFORE restarting the backend server.
 *   Safe to re-run — it checks whether the old index exists before dropping.
 *
 * HOW TO RUN (from the backend/ directory):
 *   node scripts/migratePhoneIndex.js
 *
 * REQUIRES:
 *   - MONGODB_URI set in backend/.env (or as environment variable)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error('❌  MONGO_URI is not set. Check your backend/.env file.');
  process.exit(1);
}

async function migrate() {
  await mongoose.connect(MONGO_URI);
  console.log('✅  Connected to MongoDB');

  const db = mongoose.connection.db;
  const collection = db.collection('customers');

  // 1. List existing indexes
  const indexes = await collection.indexes();
  const oldIndex = indexes.find(
    (idx) => idx.key && idx.key.phone === 1 && Object.keys(idx.key).length === 1
  );

  if (oldIndex) {
    console.log(`🔍  Found old global phone index: "${oldIndex.name}". Dropping...`);
    await collection.dropIndex(oldIndex.name);
    console.log('✅  Dropped old index:', oldIndex.name);
  } else {
    console.log('ℹ️   Old global phone_1 index not found — possibly already dropped. Continuing...');
  }

  // 2. Create new branch-scoped unique index
  const newIndexName = 'branch_1_phone_1';
  // Re-fetch after potential drop
  const refreshedIndexes = await collection.indexes();
  const existingNew = refreshedIndexes.find((idx) => idx.name === newIndexName);
  if (!existingNew) {
    console.log('🔧  Creating new compound index { branch: 1, phone: 1 } (unique)...');
    await collection.createIndex(
      { branch: 1, phone: 1 },
      { unique: true, name: newIndexName }
    );
    console.log('✅  Created new index:', newIndexName);
  } else {
    console.log('ℹ️   New index already exists:', newIndexName, '— skipping creation.');
  }

  // 3. Verify final state
  const finalIndexes = await collection.indexes();
  console.log('\n📋  Current indexes on "customers" collection:');
  finalIndexes.forEach((idx) => {
    console.log(`   - ${idx.name}:`, JSON.stringify(idx.key), idx.unique ? '(unique)' : '');
  });

  await mongoose.disconnect();
  console.log('\n✅  Migration complete. Safe to restart the backend server.');
}

migrate().catch((err) => {
  console.error('❌  Migration failed:', err);
  process.exit(1);
});
