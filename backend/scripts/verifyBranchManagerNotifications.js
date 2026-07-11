require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Branch = require('../models/Branch');
const { ROLES } = require('../config/constants');

const verify = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    const branches = await Branch.find({});
    console.log(`Found ${branches.length} branches.`);

    for (const branch of branches) {
      const managers = await User.find({ role: ROLES.BRANCH_MANAGER, branches: branch._id, isActive: true }).select('name email');
      console.log(`\nBranch: ${branch.name} (${branch._id})`);
      if (managers.length === 0) {
        console.log('  ⚠️  No active branch manager assigned');
      } else {
        managers.forEach((m) => {
          console.log(`  ✅ Manager: ${m.name} <${m.email}>`);
        });
      }
    }

    const staffWithoutBranch = await User.find({ role: ROLES.STAFF, $or: [{ branches: { $exists: false } }, { branches: { $size: 0 } }], isActive: true }).select('name email');
    console.log(`\nStaff without branches: ${staffWithoutBranch.length}`);
    staffWithoutBranch.forEach((u) => console.log(`  - ${u.name} <${u.email}>`));
  } catch (error) {
    console.error('Error verifying branch manager notification logic:', error);
  } finally {
    await mongoose.disconnect();
    console.log('✅ Disconnected');
  }
};

verify();
