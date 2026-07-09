require('dotenv').config();
const mongoose = require('mongoose');
const Branch = require('../models/Branch');

const fixBranches = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    const { DEFAULT_BRANCHES } = require('../config/constants');
    
    // Ensure both default branches exist with correct codes
    for (const branchName of DEFAULT_BRANCHES) {
      const expectedCode = branchName.toUpperCase().replace(/\s+/g, '');
      
      console.log(`🔍 Checking branch: ${branchName} (expected code: ${expectedCode})`);
      
      // Check if branch exists with exact code
      let branch = await Branch.findOne({ code: expectedCode });
      
      if (branch) {
        console.log(`✅ Branch exists with correct code: ${branch.name} (${branch.code})`);
        // Ensure name matches
        if (branch.name !== branchName) {
          console.log(`🔄 Updating name from "${branch.name}" to "${branchName}"`);
          branch.name = branchName;
          await branch.save();
        }
      } else {
        // Check if branch exists with different code (whitespace, casing, etc.)
        const similarBranch = await Branch.findOne({ 
          $or: [
            { name: branchName },
            { code: { $regex: new RegExp(`^${expectedCode}$`, 'i') } }
          ]
        });
        
        if (similarBranch) {
          console.log(`⚠️  Found branch with incorrect code: ${similarBranch.name} ("${similarBranch.code}")`);
          console.log(`🔄 Fixing code to: ${expectedCode}`);
          similarBranch.code = expectedCode;
          similarBranch.name = branchName;
          await similarBranch.save();
          console.log(`✅ Fixed branch code`);
        } else {
          // Create the branch
          console.log(`❌ Branch not found, creating: ${branchName} (${expectedCode})`);
          try {
            await Branch.create({ name: branchName, code: expectedCode });
            console.log(`✅ Created branch: ${branchName} (${expectedCode})`);
          } catch (error) {
            if (error.code === 11000) {
              console.log(`⚠️  Duplicate key error - branch may already exist with different case/whitespace`);
            } else {
              throw error;
            }
          }
        }
      }
    }

    // Remove any extra branches not in DEFAULT_BRANCHES
    const defaultCodes = DEFAULT_BRANCHES.map(name => name.toUpperCase().replace(/\s+/g, ''));
    const extraBranches = await Branch.find({ code: { $nin: defaultCodes } });
    
    if (extraBranches.length > 0) {
      console.log(`\n🗑️  Found ${extraBranches.length} extra branch(es) to remove:`);
      for (const branch of extraBranches) {
        console.log(`   - ${branch.name} (${branch.code})`);
        await Branch.findByIdAndDelete(branch._id);
        console.log(`   ✅ Removed`);
      }
    }

    // Final verification
    console.log('\n📊 Final branch list:');
    const finalBranches = await Branch.find({});
    finalBranches.forEach(branch => {
      console.log(`   - ${branch.name} (${branch.code}) Active: ${branch.isActive}`);
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  }
};

fixBranches();
