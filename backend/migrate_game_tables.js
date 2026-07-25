/**
 * Migration Script: Mark game categories with isGameTable flag
 * 
 * This script:
 * 1. Marks categories like Pool, Snooker, PS5 as isGameTable: true
 * 2. Marks legacy categories like Table, PlayStation as isGameTable: false
 * 3. Re-syncs the Table collection so only true game categories show on Live Tables
 * 
 * Run with: node migrate_game_tables.js  (from backend directory)
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/thegoldenframe';

async function migrate() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');

  const { MenuCategory, MenuItem } = require('./models/Operations');
  const Table = require('./models/Table');
  require('./models/Branch'); // Register Branch schema for populate
  const { syncTablesWithMenuItems } = require('./utils/tableSync');

  // Step 1: List ALL categories
  const allCats = await MenuCategory.find({}).lean();
  console.log('\n=== All Menu Categories ===');
  allCats.forEach(c => console.log(`  - ${c.name} (${c._id}) isGameTable=${c.isGameTable}`));

  // Step 2: Define which category names ARE game tables
  // Update this list to match your actual game categories in the database
  const GAME_CATEGORY_NAMES = ['Pool', 'Snooker', 'PS5', 'Table Tennis', 'Air Hockey', 'Carrom', 'Foosball'];

  // Mark specified categories as game tables, unmark everything else
  for (const cat of allCats) {
    const shouldBeGame = GAME_CATEGORY_NAMES.some(
      name => name.toLowerCase() === cat.name.toLowerCase()
    );
    if (cat.isGameTable !== shouldBeGame) {
      await MenuCategory.findByIdAndUpdate(cat._id, { isGameTable: shouldBeGame });
      console.log(`  Set "${cat.name}" → isGameTable: ${shouldBeGame}`);
    }
  }

  // Step 3: Re-sync tables — this will deactivate tables from non-game categories
  console.log('\n=== Syncing Tables ===');
  await syncTablesWithMenuItems();

  // Step 4: Show final state
  const activeTables = await Table.find({ isActive: true }).populate('branch', 'name');
  console.log('\n=== Active Tables After Migration ===');
  activeTables.forEach(t => console.log(`  - ${t.name} (type: ${t.type}) @ ${t.branch?.name}`));

  const inactiveTables = await Table.find({ isActive: false });
  if (inactiveTables.length > 0) {
    console.log(`\n  ${inactiveTables.length} tables were deactivated (legacy categories removed from Live Tables)`);
  }

  await mongoose.disconnect();
  console.log('\nMigration complete!');
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
