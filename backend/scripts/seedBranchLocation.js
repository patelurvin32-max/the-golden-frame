/**
 * One-time script to seed branch location coordinates for attendance geofencing.
 *
 * Usage:
 *   node backend/scripts/seedBranchLocation.js
 *
 * This updates all branches (or a specific one) with the GPS coordinates
 * of The Golden Frame Gaming Lounge and Cafe.
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const Branch = require('../models/Branch');

const BRANCH_LOCATION = {
  latitude: 20.27857816,
  longitude: 73.00845451,
  attendanceRadius: 500, // meters
};

async function seed() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌ MONGO_URI not found in environment. Check your .env file.');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log('✅ Connected to MongoDB');

  // Update all branches with the same location (single-venue setup)
  const result = await Branch.updateMany(
    {},
    { $set: BRANCH_LOCATION }
  );

  console.log(`✅ Updated ${result.modifiedCount} branch(es) with location:`, BRANCH_LOCATION);

  await mongoose.disconnect();
  console.log('✅ Done.');
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
