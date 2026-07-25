/**
 * Cleanup Script: Remove legacy Table & PlayStation menu items/categories
 *
 * Safe to run multiple times (idempotent).
 * Run with: node cleanup_legacy_menu.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/thegoldenframe';

async function cleanup() {
  await mongoose.connect(MONGO_URI);
  require('./models/Branch');
  const { MenuCategory, MenuItem } = require('./models/Operations');
  const Table = require('./models/Table');
  const { syncTablesWithMenuItems } = require('./utils/tableSync');

  console.log('\n' + '='.repeat(60));
  console.log('  LEGACY DATA CLEANUP');
  console.log('='.repeat(60));

  // ── 1. Find all NON-game categories (isGameTable: false) ──────
  const legacyCats = await MenuCategory.find({ isGameTable: false }).lean();
  console.log(`\n📂 Non-game categories found: ${legacyCats.length}`);
  legacyCats.forEach(c => console.log(`  - ${c.name} (${c._id})`));

  const legacyCatIds = legacyCats.map(c => c._id);

  // ── 2. Hard-delete all menu items under these categories ──────
  const itemsToDelete = await MenuItem.find({ category: { $in: legacyCatIds } }).lean();
  console.log(`\n🗑️  Menu items under non-game categories: ${itemsToDelete.length}`);
  if (itemsToDelete.length > 0) {
    console.log('   These will NOT be deleted — they belong to Beverage/Accessories which are valid menu items.');
    console.log('   Only Table & PlayStation items will be deactivated.\n');
  }

  // ── 3. Only target explicitly named legacy game categories ─────
  //    (Table, PlayStation — not Beverage/Accessories which are real menu items)
  const LEGACY_GAME_CAT_NAMES = ['Table', 'PlayStation'];
  const legacyGameCats = await MenuCategory.find({
    name: { $in: LEGACY_GAME_CAT_NAMES },
    isGameTable: false
  }).lean();

  console.log(`\n⚠️  Legacy game categories to clean up: ${legacyGameCats.length}`);
  legacyGameCats.forEach(c => console.log(`  - ${c.name} (${c._id})`));

  const legacyGameCatIds = legacyGameCats.map(c => c._id);

  // ── 4. Deactivate (soft-delete) items under legacy game cats ──
  const deactivatedItems = await MenuItem.updateMany(
    { category: { $in: legacyGameCatIds } },
    { status: 'Inactive' }
  );
  console.log(`\n  Deactivated ${deactivatedItems.modifiedCount} legacy game menu items`);

  // ── 5. Hard-delete Table records linked to legacy cats ────────
  const hardDeletedTables = await Table.deleteMany({ isActive: false });
  console.log(`  Permanently removed ${hardDeletedTables.deletedCount} deactivated Table records`);

  // ── 6. Re-sync to confirm state ───────────────────────────────
  console.log('\n=== Re-syncing Tables ===');
  await syncTablesWithMenuItems();

  // ── 7. Final state ────────────────────────────────────────────
  const activeTables = await Table.find({ isActive: true })
    .populate('branch', 'name')
    .sort({ type: 1, name: 1 })
    .lean();

  console.log(`\n✅ FINAL STATE — Active Tables: ${activeTables.length}\n`);
  console.log('  Name            | Type            | Branch');
  console.log('  ' + '-'.repeat(50));
  for (const t of activeTables) {
    console.log(`  ${t.name.padEnd(16)}| ${(t.type || '').padEnd(16)}| ${t.branch?.name}`);
  }

  const activeGameCats = await MenuCategory.find({ isGameTable: true, status: 'Active' }).lean();
  console.log(`\n✅ FINAL STATE — Game Categories: ${activeGameCats.length}`);
  activeGameCats.forEach(c => console.log(`  🎮 ${c.name}`));

  console.log('\n' + '='.repeat(60));
  console.log('  Cleanup complete!');
  console.log('='.repeat(60) + '\n');

  await mongoose.disconnect();
}

cleanup().catch(err => {
  console.error('Cleanup failed:', err);
  process.exit(1);
});
