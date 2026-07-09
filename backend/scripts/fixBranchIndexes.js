require('dotenv').config();
const mongoose = require('mongoose');
const Branch = require('../models/Branch');

const fixBranchIndexes = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    // Get the branches collection
    const db = mongoose.connection.db;
    const branchesCollection = db.collection('branches');

    // Check current indexes
    console.log('🔍 Current indexes on branches collection:');
    const indexes = await branchesCollection.indexes();
    indexes.forEach(index => {
      console.log(`   - ${index.name}:`, JSON.stringify(index.key));
    });

    // Look for problematic branchCode index
    const branchCodeIndex = indexes.find(idx => idx.key && idx.key.branchCode);
    
    if (branchCodeIndex) {
      console.log(`\n⚠️  Found problematic 'branchCode' index: ${branchCodeIndex.name}`);
      console.log(`   This index is causing duplicate key errors`);
      
      // Drop the problematic index
      console.log(`\n🗑️  Dropping branchCode index...`);
      await branchesCollection.dropIndex(branchCodeIndex.name);
      console.log(`✅ Dropped branchCode index`);
    } else {
      console.log(`\n✅ No problematic branchCode index found`);
    }

    // Re-check indexes after cleanup
    console.log(`\n🔍 Indexes after cleanup:`);
    const updatedIndexes = await branchesCollection.indexes();
    updatedIndexes.forEach(index => {
      console.log(`   - ${index.name}:`, JSON.stringify(index.key));
    });

    // Check for documents with null/undefined code
    console.log(`\n🔍 Checking for documents with null/undefined code...`);
    const nullCodeDocs = await branchesCollection.find({ 
      $or: [
        { code: null },
        { code: { $exists: false } }
      ]
    }).toArray();

    if (nullCodeDocs.length > 0) {
      console.log(`⚠️  Found ${nullCodeDocs.length} documents with null/undefined code:`);
      nullCodeDocs.forEach(doc => {
        console.log(`   - ID: ${doc._id}, Name: ${doc.name}, Code: ${doc.code}`);
      });
      
      // Delete or fix these documents
      console.log(`\n🗑️  Deleting documents with null/undefined code...`);
      for (const doc of nullCodeDocs) {
        await branchesCollection.deleteOne({ _id: doc._id });
        console.log(`   Deleted: ${doc.name}`);
      }
      console.log(`✅ Cleaned up null code documents`);
    } else {
      console.log(`✅ No documents with null/undefined code found`);
    }

    // Verify final state
    console.log(`\n📊 Final branch count: ${await branchesCollection.countDocuments()}`);
    console.log(`📋 All branches:`);
    const allBranches = await branchesCollection.find({}).toArray();
    allBranches.forEach(branch => {
      console.log(`   - ${branch.name} (${branch.code}) Active: ${branch.isActive}`);
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.message.includes('index not found')) {
      console.log('ℹ️  Index may have already been dropped');
    }
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  }
};

fixBranchIndexes();
