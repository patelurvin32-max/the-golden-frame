require('dotenv').config();
const mongoose = require('mongoose');
const { MenuItem, MenuCategory } = require('../models/Operations');
const Branch = require('../models/Branch');

const copyMenuToBranch = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    // Get branches
    const branches = await Branch.find({});
    const damanBranch = branches.find(b => b.name === 'Daman');
    const dnhBranch = branches.find(b => b.name === 'DNH');

    if (!damanBranch || !dnhBranch) {
      console.log('❌ Both Daman and DNH branches must exist');
      return;
    }

    console.log(`📋 Source branch: ${dnhBranch.name} (${dnhBranch._id})`);
    console.log(`📋 Target branch: ${damanBranch.name} (${damanBranch._id})`);

    // Get existing menu items from DNH branch
    const dnhMenuItems = await MenuItem.find({ branch: dnhBranch._id });
    console.log(`\n📊 Found ${dnhMenuItems.length} menu items in DNH branch`);

    // Check if Daman branch already has menu items
    const damanMenuItems = await MenuItem.find({ branch: damanBranch._id });
    if (damanMenuItems.length > 0) {
      console.log(`⚠️  Daman branch already has ${damanMenuItems.length} menu items`);
      const overwrite = process.env.OVERWRITE === 'true';
      if (!overwrite) {
        console.log('ℹ️  Set OVERWRITE=true to delete existing items and copy fresh');
        console.log('   Or manually delete existing Daman menu items first');
        return;
      }
      console.log('🗑️  Deleting existing Daman menu items...');
      await MenuItem.deleteMany({ branch: damanBranch._id });
      console.log('✅ Deleted existing Daman menu items');
    }

    // Copy menu items to Daman branch
    console.log(`\n📋 Copying ${dnhMenuItems.length} menu items to Daman branch...`);
    let copied = 0;
    let skipped = 0;

    for (const item of dnhMenuItems) {
      try {
        // Create a copy for Daman branch
        const newItem = await MenuItem.create({
          name: item.name,
          branch: damanBranch._id,
          category: item.category,
          inventoryItem: item.inventoryItem,
          price: item.price,
          halfPrice: item.halfPrice,
          fullPrice: item.fullPrice,
          description: item.description,
          availability: item.availability,
          status: item.status
        });
        copied++;
        console.log(`   ✅ Copied: ${item.name}`);
      } catch (error) {
        if (error.code === 11000) {
          console.log(`   ⚠️  Skipped (duplicate): ${item.name}`);
          skipped++;
        } else {
          console.log(`   ❌ Error copying ${item.name}:`, error.message);
        }
      }
    }

    console.log(`\n✅ Successfully copied ${copied} menu items to Daman branch`);
    if (skipped > 0) {
      console.log(`⚠️  Skipped ${skipped} duplicate items`);
    }

    // Verify final state
    const finalDamanItems = await MenuItem.find({ branch: damanBranch._id });
    const finalDnhItems = await MenuItem.find({ branch: dnhBranch._id });

    console.log(`\n📊 Final menu item counts:`);
    console.log(`   Daman: ${finalDamanItems.length} items`);
    console.log(`   DNH: ${finalDnhItems.length} items`);

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  }
};

copyMenuToBranch();
