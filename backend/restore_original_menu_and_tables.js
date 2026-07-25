/**
 * Restore Original Menu Categories & Independent Live Tables
 *
 * Requirements:
 * 1. Menu Categories must contain ONLY: PlayStation, Table, Beverage, Accessories
 * 2. Remove Pool, Snooker, PS5 from Menu Categories & Menu Items
 * 3. Keep Table collection for Live Tables completely independent of Menu
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/thegoldenframe';

async function restore() {
  await mongoose.connect(MONGO_URI);
  require('./models/Branch');
  const { MenuCategory, MenuItem } = require('./models/Operations');
  const Table = require('./models/Table');

  console.log('\n' + '='.repeat(60));
  console.log('  RESTORING ORIGINAL MENU CATEGORIES & INDEPENDENT TABLES');
  console.log('='.repeat(60));

  // 1. Remove added game categories from MenuCategories (Pool, Snooker, PS5)
  const addedCatNames = ['Pool', 'Snooker', 'PS5', 'Table Tennis', 'Air Hockey'];
  const catsToRemove = await MenuCategory.find({ name: { $in: addedCatNames } });
  const catIdsToRemove = catsToRemove.map(c => c._id);

  await MenuItem.deleteMany({ category: { $in: catIdsToRemove } });
  await MenuCategory.deleteMany({ _id: { $in: catIdsToRemove } });
  console.log(`✅ Removed temporary categories (${addedCatNames.join(', ')}) from Menu Categories & Items`);

  // 2. Ensure original 4 categories exist and are Active
  const ORIGINAL_CATS = ['PlayStation', 'Table', 'Beverage', 'Accessories'];
  for (const catName of ORIGINAL_CATS) {
    await MenuCategory.updateOne(
      { name: catName },
      { $set: { status: 'Active' }, $unset: { isGameTable: "" } },
      { upsert: true }
    );
  }

  // Remove any isGameTable field from all MenuCategories
  await MenuCategory.updateMany({}, { $unset: { isGameTable: "" } });

  // Reactivate menu items under original categories
  await MenuItem.updateMany({}, { status: 'Active' });

  // 3. Ensure Table collection has active tables for Live Tables
  // Active tables in Table collection (independent of Menu)
  await Table.updateMany({}, { isActive: true });

  // Audit
  const finalCats = await MenuCategory.find({}).sort('name').lean();
  const finalItems = await MenuItem.find({ status: 'Active' }).lean();
  const finalTables = await Table.find({ isActive: true }).sort('name').lean();

  console.log('\n📂 Menu Categories (' + finalCats.length + ' total):');
  finalCats.forEach(c => console.log(`  - ${c.name} (${c.status})`));

  console.log('\n🍔 Menu Items Active count: ' + finalItems.length);

  console.log('\n🎱 Live Tables (' + finalTables.length + ' total in Table collection):');
  finalTables.forEach(t => console.log(`  - ${t.name} (type: ${t.type}, rate: ₹${t.hourlyRate}/hr)`));

  console.log('\n' + '='.repeat(60));
  console.log('  RESTORATION COMPLETE');
  console.log('='.repeat(60) + '\n');

  await mongoose.disconnect();
}

restore().catch(err => {
  console.error('Restoration failed:', err);
  process.exit(1);
});
