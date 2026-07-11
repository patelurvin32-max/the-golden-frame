/**
 * Performance Index Migration Script
 * 
 * This script creates compound indexes to optimize query performance
 * for the Customers module, specifically for:
 * - Menu items filtering by category, branch, and status
 * - Customer list queries with branch and isActive filters
 * - Customer filtering by category and branch
 * 
 * Run this script after deploying to ensure indexes are created in production.
 */

const mongoose = require('mongoose');
require('dotenv').config();

const Customer = require('../models/Customer');
const { MenuItem } = require('../models/Operations');

async function createIndexes() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/cuemaster';
    await mongoose.connect(mongoUri);
    console.log('✓ Connected to MongoDB');

    // Create MenuItem compound index
    console.log('\nCreating MenuItem compound index (category + branch + status)...');
    await MenuItem.collection.createIndex(
      { category: 1, branch: 1, status: 1 },
      { name: 'category_branch_status_idx' }
    );
    console.log('✓ MenuItem compound index created');

    // Create Customer compound indexes
    console.log('\nCreating Customer compound index (branch + isActive + createdAt)...');
    await Customer.collection.createIndex(
      { branch: 1, isActive: 1, createdAt: -1 },
      { name: 'branch_isActive_createdAt_idx' }
    );
    console.log('✓ Customer compound index (branch + isActive + createdAt) created');

    console.log('\nCreating Customer compound index (menuCategoryId + branch + isActive)...');
    await Customer.collection.createIndex(
      { menuCategoryId: 1, branch: 1, isActive: 1 },
      { name: 'menuCategoryId_branch_isActive_idx' }
    );
    console.log('✓ Customer compound index (menuCategoryId + branch + isActive) created');

    // List all indexes for verification
    console.log('\n--- MenuItem Indexes ---');
    const menuItemIndexes = await MenuItem.collection.getIndexes();
    console.log(Object.keys(menuItemIndexes));

    console.log('\n--- Customer Indexes ---');
    const customerIndexes = await Customer.collection.getIndexes();
    console.log(Object.keys(customerIndexes));

    console.log('\n✓ All performance indexes created successfully!');
  } catch (error) {
    console.error('✗ Error creating indexes:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n✓ Disconnected from MongoDB');
  }
}

// Run the migration
createIndexes();
