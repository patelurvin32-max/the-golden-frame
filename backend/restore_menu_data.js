/**
 * Restore Menu Data Script
 * Restores all MenuItems and MenuCategories to Active status.
 * Sets isGameTable: true on game categories (Pool, Snooker, PS5).
 * Sets isGameTable: false on other categories (PlayStation, Table, Beverage, Accessories).
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/thegoldenframe';

async function restore() {
  await mongoose.connect(MONGO_URI);
  require('./models/Branch');
  const { MenuCategory, MenuItem } = require('./models/Operations');
  const Table = require('./models/Table');
  const { syncTablesWithMenuItems } = require('./utils/tableSync');

  console.log('\n' + '='.repeat(60));
  console.log('  RESTORING MENU DATA');
  console.log('='.repeat(60));

  // 1. Reactivate ALL MenuCategories
  await MenuCategory.updateMany({}, { status: 'Active' });
  console.log('✅ All MenuCategories set to Active');

  // 2. Reactivate ALL MenuItems
  await MenuItem.updateMany({}, { status: 'Active' });
  console.log('✅ All MenuItems set to Active');

  // 3. Set isGameTable flags appropriately
  const GAME_CAT_NAMES = ['pool', 'snooker', 'ps5', 'table tennis', 'air hockey'];

  const categories = await MenuCategory.find({});
  for (const cat of categories) {
    const isGame = GAME_CAT_NAMES.includes(cat.name.trim().toLowerCase());
    await MenuCategory.findByIdAndUpdate(cat._id, { isGameTable: isGame });
    console.log(`  - ${cat.name.padEnd(16)} | isGameTable: ${isGame}`);
  }

  // 4. Re-sync tables so only isGameTable categories generate active tables
  console.log('\n=== Syncing Tables ===');
  await syncTablesWithMenuItems();

  // 5. Audit final state
  const allCats = await MenuCategory.find({}).lean();
  const allItems = await MenuItem.find({ status: 'Active' }).lean();
  const activeTables = await Table.find({ isActive: true }).lean();

  console.log('\n' + '='.repeat(60));
  console.log('  RESTORATION COMPLETE');
  console.log('='.repeat(60));
  console.log(`  Total MenuCategories restored : ${allCats.length}`);
  console.log(`  Total MenuItems restored      : ${allItems.length}`);
  console.log(`  Active Live Tables            : ${activeTables.length}`);
  console.log('='.repeat(60) + '\n');

  await mongoose.disconnect();
}

restore().catch(err => {
  console.error('Restoration failed:', err);
  process.exit(1);
});
