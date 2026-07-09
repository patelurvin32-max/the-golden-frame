require('dotenv').config();
const mongoose = require('mongoose');
const Branch = require('../models/Branch');

const restoreDNHBranch = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    const branchName = 'DNH';
    const expectedCode = 'DNH';
    
    console.log(`🔍 Checking for DNH branch...`);
    
    // Check if DNH branch already exists
    const existingBranch = await Branch.findOne({ code: expectedCode });
    
    if (existingBranch) {
      console.log(`✅ DNH branch already exists: ${existingBranch.name} (${existingBranch.code})`);
      console.log(`   Active: ${existingBranch.isActive}`);
      console.log(`   ID: ${existingBranch._id}`);
      return;
    }
    
    // Check if branch exists with different code (case sensitivity, whitespace)
    const similarBranch = await Branch.findOne({ 
      $or: [
        { name: branchName },
        { code: { $regex: new RegExp(`^${expectedCode}$`, 'i') } }
      ]
    });
    
    if (similarBranch) {
      console.log(`⚠️  Found DNH branch with incorrect code: "${similarBranch.code}"`);
      console.log(`🔄 Fixing code to: ${expectedCode}`);
      similarBranch.code = expectedCode;
      similarBranch.name = branchName;
      similarBranch.isActive = true;
      await similarBranch.save();
      console.log(`✅ DNH branch code fixed`);
    } else {
      // Create the DNH branch
      console.log(`❌ DNH branch not found, creating: ${branchName} (${expectedCode})`);
      try {
        const newBranch = await Branch.create({ 
          name: branchName, 
          code: expectedCode,
          isActive: true,
          openingTime: '10:00',
          closingTime: '23:00'
        });
        console.log(`✅ DNH branch created successfully`);
        console.log(`   ID: ${newBranch._id}`);
        console.log(`   Name: ${newBranch.name}`);
        console.log(`   Code: ${newBranch.code}`);
      } catch (error) {
        if (error.code === 11000) {
          console.log(`❌ Duplicate key error - a branch with this code or name already exists`);
          console.log(`   This suggests the branch exists but with different formatting`);
        } else {
          throw error;
        }
      }
    }

    // Verify final state
    console.log('\n📊 Current branches in database:');
    const allBranches = await Branch.find({});
    allBranches.forEach(branch => {
      console.log(`   - ${branch.name} (${branch.code}) Active: ${branch.isActive}`);
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  }
};

restoreDNHBranch();
