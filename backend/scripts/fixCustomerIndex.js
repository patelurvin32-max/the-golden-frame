/**
 * Script to drop stale orderId index from customers collection
 * Run with: node scripts/fixCustomerIndex.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

const dropStaleIndex = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/thegoldenframe');
    console.log('Connected to MongoDB');

    const db = mongoose.connection.db;
    const customersCollection = db.collection('customers');

    // Check current indexes
    const indexes = await customersCollection.indexes();
    console.log('\nCurrent indexes on customers collection:');
    indexes.forEach(index => {
      console.log(`- ${index.name}:`, JSON.stringify(index.key));
    });

    // Drop stale indexes that belong to Order model but are on customers collection
    const staleIndexes = [
      'orderId_1',
      'category_1',
      'productId_1',
      'paymentStatus_1',
      'paymentMethod_1',
      'menuCategoryId_1',
      'menuItemId_1',
      'paymentStatus_1_createdAt_-1',
      'paymentStatus_1_branch_1_createdAt_-1',
      'paymentStatus_1_billAmount_-1',
      'branch_1_paymentStatus_1_createdAt_-1',
      'billAmount_-1',
      'createdAt_-1_paymentStatus_1',
      'menuCategoryId_1_branch_1_isActive_1'
    ];

    console.log('\nChecking for stale indexes...');
    let droppedCount = 0;
    
    for (const indexName of staleIndexes) {
      const index = indexes.find(idx => idx.name === indexName);
      if (index) {
        console.log(`Dropping stale index: ${indexName}`);
        await customersCollection.dropIndex(indexName);
        droppedCount++;
      }
    }

    if (droppedCount === 0) {
      console.log('No stale indexes found. No action needed.');
    } else {
      console.log(`✓ Successfully dropped ${droppedCount} stale indexes`);
    }

    // Verify indexes after cleanup
    const updatedIndexes = await customersCollection.indexes();
    console.log('\nUpdated indexes on customers collection:');
    updatedIndexes.forEach(index => {
      console.log(`- ${index.name}:`, JSON.stringify(index.key));
    });

    await mongoose.disconnect();
    console.log('\n✓ Index cleanup completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
};

dropStaleIndex();
