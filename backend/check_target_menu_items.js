/**
 * Query existing MenuItems under PlayStation and Table categories
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/thegoldenframe';

async function check() {
  await mongoose.connect(MONGO_URI);
  require('./models/Branch');
  const { MenuCategory, MenuItem } = require('./models/Operations');

  const targetCats = await MenuCategory.find({
    name: { $in: ['PlayStation', 'Table'] },
    status: 'Active'
  }).lean();

  console.log('\nFound Target Categories:', targetCats.map(c => `${c.name} (${c._id})`));

  const targetCatIds = targetCats.map(c => c._id);
  const items = await MenuItem.find({
    category: { $in: targetCatIds },
    status: 'Active'
  }).populate('category', 'name').populate('branch', 'name').sort({ 'category.name': 1, name: 1 }).lean();

  console.log(`\nFound ${items.length} Menu Items under PlayStation and Table:\n`);
  items.forEach(i => {
    console.log(`  - [${i.category?.name}] ${i.name} (Price: ₹${i.price}) @ ${i.branch?.name}`);
  });

  await mongoose.disconnect();
}

check().catch(err => {
  console.error('Check failed:', err);
  process.exit(1);
});
