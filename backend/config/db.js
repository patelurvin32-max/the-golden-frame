const mongoose = require('mongoose');

/**
 * Establishes connection to MongoDB using Mongoose.
 * Exits process on failure since the app cannot function without a DB.
 */
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    // Production safety net: Drop stale orderId index if present
    try {
      const customersCollection = mongoose.connection.db.collection('customers');
      const indexes = await customersCollection.indexes();
      const staleIndex = indexes.find(index => index.name === 'orderId_1');

      if (staleIndex) {
        await customersCollection.dropIndex('orderId_1');
      }
    } catch (indexError) {
      // ignore
    }

    mongoose.connection.on('error', (err) => {
      console.error('MongoDB connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('⚠️  MongoDB disconnected');
    });
  } catch (error) {
    console.error(`❌ MongoDB connection failed: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
