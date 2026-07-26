require('dotenv').config();
const mongoose = require('mongoose');

require('../models/User');
require('../models/Session');
require('../models/Table');
require('../models/Customer');
require('../models/Billing');
require('../models/Operations');
require('../models/InventoryCategory');
require('../models/System');

async function createIndexes() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    const modelNames = mongoose.modelNames();
    console.log(`Syncing indexes for ${modelNames.length} models...`);

    for (const name of modelNames) {
      try {
        const Model = mongoose.model(name);
        await Model.createIndexes();
        console.log(`OK ${name}`);
      } catch (err) {
        console.error(`FAIL ${name}: ${err.message}`);
      }
    }

    console.log('All indexes synced.');
  } catch (err) {
    console.error('Fatal:', err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

createIndexes();
