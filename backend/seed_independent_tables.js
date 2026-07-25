/**
 * Check and Seed Independent Live Tables in Table collection
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/thegoldenframe';

async function seedLiveTables() {
  await mongoose.connect(MONGO_URI);
  require('./models/Branch');
  const Branch = require('./models/Branch');
  const Table = require('./models/Table');

  console.log('\n' + '='.repeat(60));
  console.log('  SEEDING INDEPENDENT LIVE TABLES COLLECTION');
  console.log('='.repeat(60));

  const branches = await Branch.find({});
  console.log(`Found ${branches.length} branches:`, branches.map(b => `${b.name} (${b.code})`));

  if (branches.length === 0) {
    console.log('No branches found!');
    process.exit(1);
  }

  const sampleTables = [
    { name: 'Pool 1', type: 'Pool', hourlyRate: 300 },
    { name: 'Pool 2', type: 'Pool', hourlyRate: 300 },
    { name: 'Snooker 1', type: 'Snooker', hourlyRate: 400 },
    { name: 'Snooker 2', type: 'Snooker', hourlyRate: 400 },
    { name: 'PS5 1', type: 'PS5', hourlyRate: 200 },
    { name: 'PS5 2', type: 'PS5', hourlyRate: 200 },
  ];

  for (const branch of branches) {
    for (const t of sampleTables) {
      await Table.updateOne(
        { branch: branch._id, name: t.name },
        {
          $set: {
            branch: branch._id,
            name: t.name,
            type: t.type,
            hourlyRate: t.hourlyRate,
            status: 'available',
            isActive: true
          }
        },
        { upsert: true }
      );
    }
  }

  const allTables = await Table.find({ isActive: true }).populate('branch', 'name').lean();
  console.log(`\n✅ Independent Live Tables (${allTables.length} total):`);
  allTables.forEach(t => {
    console.log(`  - ${t.name.padEnd(12)} | Type: ${t.type.padEnd(10)} | Rate: ₹${t.hourlyRate}/hr | Branch: ${t.branch?.name}`);
  });

  await mongoose.disconnect();
}

seedLiveTables().catch(err => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
