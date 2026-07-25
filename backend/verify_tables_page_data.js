/**
 * Test tableSync and verify exact Table records created from PlayStation & Table menu categories
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/thegoldenframe';

async function verifyLiveTablesData() {
  await mongoose.connect(MONGO_URI);
  require('./models/Branch');
  const { syncTablesWithMenuItems } = require('./utils/tableSync');
  const Table = require('./models/Table');

  console.log('\n' + '='.repeat(60));
  console.log('  VERIFYING LIVE TABLES DATA SOURCE');
  console.log('='.repeat(60));

  // Run sync
  await syncTablesWithMenuItems();

  const activeTables = await Table.find({ isActive: true })
    .populate('branch', 'name')
    .sort({ type: 1, name: 1 })
    .lean();

  console.log(`\nFound ${activeTables.length} active live tables synced from PlayStation & Table categories:\n`);
  console.log('  Item Name               | Category Type   | Rate     | Branch');
  console.log('  ' + '-'.repeat(64));

  for (const t of activeTables) {
    console.log(
      `  ${t.name.padEnd(24)}| ${(t.type || '').padEnd(16)}| ₹${String(t.hourlyRate).padEnd(6)}| ${t.branch?.name}`
    );
  }

  const categoryTypes = [...new Set(activeTables.map(t => t.type))].sort();
  console.log('\n' + '='.repeat(60));
  console.log('  LIVE TABLES PAGE FILTERS & CARDS');
  console.log('='.repeat(60));
  console.log(`  Category Filter Buttons : All Types | ${categoryTypes.map(c => c.toUpperCase()).join(' | ')}`);
  console.log(`  Total Cards Rendered    : ${activeTables.length}`);
  console.log('='.repeat(60) + '\n');

  await mongoose.disconnect();
}

verifyLiveTablesData().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
