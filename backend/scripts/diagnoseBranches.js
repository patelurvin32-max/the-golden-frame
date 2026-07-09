require('dotenv').config();
const mongoose = require('mongoose');
const Branch = require('../models/Branch');

const diagnoseBranches = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    // Get all branches
    const allBranches = await Branch.find({});
    console.log(`📊 Total branches in database: ${allBranches.length}\n`);

    if (allBranches.length === 0) {
      console.log('⚠️  No branches found in database');
      return;
    }

    // Display each branch with details
    console.log('📋 Branch details:');
    allBranches.forEach((branch, index) => {
      console.log(`\n${index + 1}. Name: "${branch.name}"`);
      console.log(`   Code: "${branch.code}" (length: ${branch.code.length})`);
      console.log(`   ID: ${branch._id}`);
      console.log(`   Active: ${branch.isActive}`);
      console.log(`   Created: ${branch.createdAt}`);
    });

    // Check for code inconsistencies
    const { DEFAULT_BRANCHES } = require('../config/constants');
    const defaultCodes = DEFAULT_BRANCHES.map(name => name.toUpperCase().replace(/\s+/g, ''));
    
    console.log('\n🔍 Expected default codes:', defaultCodes);
    
    const actualCodes = allBranches.map(b => b.code);
    console.log('🔍 Actual codes in database:', actualCodes);

    const missingCodes = defaultCodes.filter(code => !actualCodes.includes(code));
    const extraCodes = actualCodes.filter(code => !defaultCodes.includes(code));

    if (missingCodes.length > 0) {
      console.log('\n❌ Missing default codes:', missingCodes);
    }

    if (extraCodes.length > 0) {
      console.log('\n⚠️  Extra codes (will be deleted by seed):', extraCodes);
    }

    // Check for whitespace issues
    console.log('\n🔍 Checking for whitespace issues in codes:');
    allBranches.forEach(branch => {
      if (branch.code !== branch.code.trim()) {
        console.log(`⚠️  Branch "${branch.name}" has code with whitespace: "${branch.code}"`);
      }
      if (branch.code !== branch.code.toUpperCase()) {
        console.log(`⚠️  Branch "${branch.name}" has code not uppercase: "${branch.code}"`);
      }
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  }
};

diagnoseBranches();
