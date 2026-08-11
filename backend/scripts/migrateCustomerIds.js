require('dotenv').config();
const mongoose = require('mongoose');
const Customer = require('../models/Customer');
const CustomerCounter = require('../models/CustomerCounter');
const { Settings } = require('../models/System');
const { BUSINESS_SHORT_CODE } = require('../config/constants');

async function migrate() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB\n');

  // 1. Load all distinct branches that have customers
  const branchIds = await Customer.distinct('branch');
  console.log(`Found ${branchIds.length} branch(es) with customers\n`);

  let totalMigrated = 0;
  let totalSkipped = 0;

  for (const branchId of branchIds) {
    // 2. Get this branch's configured Short Business Name from Settings
    let prefix = BUSINESS_SHORT_CODE; // fallback
    if (branchId) {
      const branchSettings = await Settings.findOne({ branch: branchId })
        .select('shortBusinessName')
        .lean();
      if (branchSettings?.shortBusinessName?.trim()) {
        prefix = branchSettings.shortBusinessName.trim().toUpperCase();
      }
    }

    const counterKey = branchId
      ? `customer_seq_branch_${branchId}`
      : 'customer_seq_global';

    console.log(`--- Branch: ${branchId} | Prefix: ${prefix} | Counter: ${counterKey}`);

    // 3. Find customers in this branch that don't already have the correct prefix
    // Idempotent: customers whose ID already starts with this prefix + digits are skipped
    const regex = new RegExp(`^${escapeRegex(prefix)}\\d+$`);
    const customersToMigrate = await Customer.find({
      branch: branchId,
      $or: [
        { customerId: { $not: regex } },
        { customerId: { $exists: false } },
        { customerId: null },
      ],
    }).sort({ createdAt: 1 }); // oldest first so they get the lowest numbers

    console.log(`  Found ${customersToMigrate.length} customers to migrate in this branch`);

    let migrated = 0;
    let skipped = 0;

    for (const customer of customersToMigrate) {
      const counter = await CustomerCounter.findByIdAndUpdate(
        counterKey,
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
      );
      const newId = `${prefix}${String(counter.seq).padStart(5, '0')}`;
      const oldId = customer.customerId || '(none)';
      customer.customerId = newId;

      try {
        await customer.save();
        migrated++;
        console.log(`    ${oldId}  ->  ${newId}   (${customer.name})`);
      } catch (err) {
        console.error(`    Skipped ${customer.name} (${customer._id}): ${err.message}`);
        skipped++;
      }
    }

    totalMigrated += migrated;
    totalSkipped += skipped;
    console.log(`  Done: ${migrated} migrated, ${skipped} skipped\n`);
  }

  console.log(`\n=== Migration complete: ${totalMigrated} total migrated, ${totalSkipped} total skipped ===`);
  await mongoose.disconnect();
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
