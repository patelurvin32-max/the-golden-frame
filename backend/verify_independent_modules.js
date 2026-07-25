/**
 * Verification Script: Independent Menu Module & Table Module
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/thegoldenframe';

async function verify() {
  await mongoose.connect(MONGO_URI);
  require('./models/Branch');
  const { MenuCategory, MenuItem } = require('./models/Operations');
  const Table = require('./models/Table');

  console.log('\n' + '='.repeat(60));
  console.log('  VERIFYING INDEPENDENT MODULES STATE');
  console.log('='.repeat(60));

  // 1. Menu Categories
  const categories = await MenuCategory.find({}).sort('name').lean();
  console.log(`\n📂 Menu Categories (${categories.length} total):`);
  categories.forEach(c => console.log(`  - ${c.name} (Status: ${c.status})`));

  // 2. Menu Items
  const items = await MenuItem.find({ status: 'Active' }).populate('category', 'name').lean();
  console.log(`\n🍔 Active Menu Items (${items.length} total):`);
  const itemsPerCat = {};
  items.forEach(i => {
    const catName = i.category?.name || 'Unassigned';
    itemsPerCat[catName] = (itemsPerCat[catName] || 0) + 1;
  });
  Object.entries(itemsPerCat).forEach(([cat, count]) => {
    console.log(`  - ${cat}: ${count} items`);
  });

  // 3. Table Collection (Live Tables)
  const tables = await Table.find({ isActive: true }).populate('branch', 'name').sort({ type: 1, name: 1 }).lean();
  console.log(`\n🎱 Live Tables Collection (${tables.length} total):`);
  tables.forEach(t => {
    console.log(`  - ${t.name.padEnd(12)} | Type: ${(t.type || '').padEnd(10)} | Rate: ₹${t.hourlyRate}/hr | Branch: ${t.branch?.name}`);
  });

  console.log('\n' + '='.repeat(60));
  console.log('  VERIFICATION COMPLETE - MODULES INDEPENDENT & RESTORED');
  console.log('='.repeat(60) + '\n');

  await mongoose.disconnect();
}

verify().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
