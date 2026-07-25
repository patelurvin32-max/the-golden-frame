/**
 * Live Tables Data Audit Script
 * Queries MongoDB and prints exact records for:
 * - All MenuCategories
 * - isGameTable categories and their MenuItems
 * - Active Tables in the Table collection
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/thegoldenframe';

async function audit() {
  await mongoose.connect(MONGO_URI);

  require('./models/Branch');
  const { MenuCategory, MenuItem } = require('./models/Operations');
  const Table = require('./models/Table');

  console.log('\n' + '='.repeat(60));
  console.log('  LIVE TABLES DATA AUDIT');
  console.log('='.repeat(60));

  // ─── 1. ALL MenuCategories ─────────────────────────────────────
  const allCats = await MenuCategory.find({}).sort('name').lean();
  console.log(`\n📂 ALL MenuCategories (${allCats.length} total):\n`);
  console.log('  Name            | Status   | isGameTable');
  console.log('  ' + '-'.repeat(48));
  for (const c of allCats) {
    const flag = c.isGameTable ? '✅ TRUE' : '❌ false';
    console.log(`  ${c.name.padEnd(16)}| ${(c.status || '').padEnd(9)}| ${flag}`);
  }

  // ─── 2. GAME TABLE Categories ──────────────────────────────────
  const gameCats = allCats.filter(c => c.isGameTable === true && c.status === 'Active');
  console.log(`\n🎮 GAME TABLE Categories (isGameTable=true, Active) → ${gameCats.length} found:`);
  gameCats.forEach(c => console.log(`  ✅ ${c.name} (${c._id})`));

  // ─── 3. MenuItems under game categories ───────────────────────
  const gameCatIds = gameCats.map(c => c._id);
  const gameItems = await MenuItem.find({
    category: { $in: gameCatIds },
    status: 'Active'
  }).populate('category', 'name').populate('branch', 'name').sort({ 'category': 1, name: 1 }).lean();

  console.log(`\n🎱 MenuItems under Game Categories (${gameItems.length} total):\n`);
  console.log('  Name            | Category        | Branch          | Status');
  console.log('  ' + '-'.repeat(64));
  for (const item of gameItems) {
    console.log(
      `  ${item.name.padEnd(16)}| ${(item.category?.name || '').padEnd(16)}| ${(item.branch?.name || '').padEnd(16)}| ${item.status}`
    );
  }

  // ─── 4. NON-game MenuItems (these should NOT appear on Live Tables) ──
  const nonGameCatIds = allCats.filter(c => !c.isGameTable).map(c => c._id);
  const nonGameItems = await MenuItem.find({
    category: { $in: nonGameCatIds },
    status: 'Active'
  }).populate('category', 'name').populate('branch', 'name').lean();
  console.log(`\n🍺 Non-Game MenuItems (should NOT appear on Live Tables) → ${nonGameItems.length} found:`);
  if (nonGameItems.length === 0) {
    console.log('  None (clean ✅)');
  } else {
    nonGameItems.forEach(i => console.log(`  - ${i.name} (category: ${i.category?.name}, branch: ${i.branch?.name})`));
  }

  // ─── 5. Active Tables ──────────────────────────────────────────
  const activeTables = await Table.find({ isActive: true })
    .populate('branch', 'name')
    .sort({ type: 1, name: 1 })
    .lean();
  console.log(`\n🗂️  Active Table Records (isActive=true) → ${activeTables.length} total:\n`);
  console.log('  Name            | Type            | Branch          | Status');
  console.log('  ' + '-'.repeat(64));
  for (const t of activeTables) {
    console.log(
      `  ${t.name.padEnd(16)}| ${(t.type || '').padEnd(16)}| ${(t.branch?.name || '').padEnd(16)}| ${t.status}`
    );
  }

  // ─── 6. Deactivated (legacy) Tables ───────────────────────────
  const inactiveTables = await Table.find({ isActive: false })
    .populate('branch', 'name')
    .sort({ type: 1 })
    .lean();
  console.log(`\n🗑️  Deactivated (Legacy) Table Records (isActive=false) → ${inactiveTables.length} total:`);
  if (inactiveTables.length === 0) {
    console.log('  None');
  } else {
    for (const t of inactiveTables) {
      console.log(`  ❌ ${t.name} | type: ${t.type} | branch: ${t.branch?.name}`);
    }
  }

  // ─── 7. Summary ───────────────────────────────────────────────
  console.log('\n' + '='.repeat(60));
  console.log('  SUMMARY');
  console.log('='.repeat(60));
  console.log(`  Total MenuCategories     : ${allCats.length}`);
  console.log(`  Game Table Categories    : ${gameCats.length} (isGameTable=true)`);
  console.log(`  Non-Game Categories      : ${allCats.length - gameCats.length}`);
  console.log(`  Game MenuItems (active)  : ${gameItems.length}`);
  console.log(`  Non-Game MenuItems       : ${nonGameItems.length}`);
  console.log(`  Active Tables            : ${activeTables.length}`);
  console.log(`  Deactivated Legacy Tables: ${inactiveTables.length}`);
  console.log('\n  Live Tables will display:');
  const uniqueTypes = [...new Set(activeTables.map(t => t.type))].sort();
  console.log(`    Filter tabs: All Types | ${uniqueTypes.join(' | ')}`);
  const tableNames = activeTables.map(t => `${t.name} (${t.type}@${t.branch?.name})`);
  tableNames.forEach(n => console.log(`    Card: ${n}`));
  console.log('='.repeat(60) + '\n');

  await mongoose.disconnect();
}

audit().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
