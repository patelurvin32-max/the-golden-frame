require('dotenv').config();
const mongoose = require('mongoose');
const { MenuItem } = require('../models/Operations');
const Branch = require('../models/Branch');

const testMenuAPI = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    // Get branches
    const branches = await Branch.find({});
    console.log('📊 Branches:', branches.map(b => ({ name: b.name, id: b._id })));

    // Test 1: Query without branch filter (should show all items)
    console.log('\n🔍 Test 1: Query without branch filter (Super Admin - All Branches)');
    const allItems = await MenuItem.find({ status: 'Active' }).populate('category');
    console.log(`   Found ${allItems.length} items`);
    allItems.slice(0, 3).forEach(item => {
      console.log(`   - ${item.name} (Branch: ${item.branch}, Category: ${item.category?.name})`);
    });

    // Test 2: Query with DNH branch filter
    console.log('\n🔍 Test 2: Query with DNH branch filter');
    const dnhBranch = branches.find(b => b.name === 'DNH');
    const dnhItems = await MenuItem.find({ branch: dnhBranch._id, status: 'Active' }).populate('category');
    console.log(`   Found ${dnhItems.length} items`);
    dnhItems.slice(0, 3).forEach(item => {
      console.log(`   - ${item.name} (Category: ${item.category?.name})`);
    });

    // Test 3: Query with Daman branch filter
    console.log('\n🔍 Test 3: Query with Daman branch filter');
    const damanBranch = branches.find(b => b.name === 'Daman');
    const damanItems = await MenuItem.find({ branch: damanBranch._id, status: 'Active' }).populate('category');
    console.log(`   Found ${damanItems.length} items`);
    damanItems.slice(0, 3).forEach(item => {
      console.log(`   - ${item.name} (Category: ${item.category?.name})`);
    });

    // Test 4: Aggregation pipeline (like the API uses)
    console.log('\n🔍 Test 4: Aggregation pipeline (like API)');
    const pipeline = [
      { $match: { status: 'Active' } },
      {
        $lookup: {
          from: 'menucategories',
          localField: 'category',
          foreignField: '_id',
          as: 'categoryInfo'
        }
      },
      { $unwind: '$categoryInfo' },
      {
        $sort: {
          'categoryInfo.name': 1,
          'name': 1
        }
      },
      { $limit: 5 }
    ];
    const aggregatedItems = await MenuItem.aggregate(pipeline);
    console.log(`   Found ${aggregatedItems.length} items via aggregation`);
    aggregatedItems.forEach(item => {
      console.log(`   - ${item.name} (Branch: ${item.branch}, Category: ${item.categoryInfo.name})`);
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  }
};

testMenuAPI();
