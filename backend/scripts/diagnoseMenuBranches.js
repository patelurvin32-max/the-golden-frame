require('dotenv').config();
const mongoose = require('mongoose');
const { MenuItem, MenuCategory } = require('../models/Operations');
const Branch = require('../models/Branch');

const diagnoseMenuBranches = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    // Get all branches
    const branches = await Branch.find({});
    console.log(`📊 Total branches: ${branches.length}`);
    branches.forEach(b => console.log(`   - ${b.name} (${b._id})`));

    // Get all menu items
    const menuItems = await MenuItem.find({});
    console.log(`\n📊 Total menu items: ${menuItems.length}`);

    if (menuItems.length === 0) {
      console.log('⚠️  No menu items found in database');
      return;
    }

    // Check branch assignments
    console.log('\n🔍 Menu items by branch:');
    const branchMap = {};
    menuItems.forEach(item => {
      const branchId = item.branch ? item.branch.toString() : 'NULL';
      if (!branchMap[branchId]) {
        branchMap[branchId] = [];
      }
      branchMap[branchId].push(item);
    });

    // Display items by branch
    for (const [branchId, items] of Object.entries(branchMap)) {
      const branch = branches.find(b => b._id.toString() === branchId);
      const branchName = branch ? branch.name : 'Unknown/NULL';
      console.log(`\n   Branch: ${branchName} (${branchId})`);
      console.log(`   Items: ${items.length}`);
      items.slice(0, 5).forEach(item => {
        console.log(`      - ${item.name} (ID: ${item._id})`);
      });
      if (items.length > 5) {
        console.log(`      ... and ${items.length - 5} more`);
      }
    }

    // Check for items with NULL branch
    const nullBranchItems = menuItems.filter(item => !item.branch);
    if (nullBranchItems.length > 0) {
      console.log(`\n⚠️  Found ${nullBranchItems.length} items with NULL branch:`);
      nullBranchItems.forEach(item => {
        console.log(`   - ${item.name} (ID: ${item._id})`);
      });
    }

    // Check for items with invalid branch IDs
    const validBranchIds = branches.map(b => b._id.toString());
    const invalidBranchItems = menuItems.filter(item => 
      item.branch && !validBranchIds.includes(item.branch.toString())
    );
    if (invalidBranchItems.length > 0) {
      console.log(`\n⚠️  Found ${invalidBranchItems.length} items with invalid branch IDs:`);
      invalidBranchItems.forEach(item => {
        console.log(`   - ${item.name} (Branch ID: ${item.branch})`);
      });
    }

    // Get menu categories
    const categories = await MenuCategory.find({});
    console.log(`\n📊 Total menu categories: ${categories.length}`);
    categories.forEach(c => console.log(`   - ${c.name} (ID: ${c._id})`));

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  }
};

diagnoseMenuBranches();
