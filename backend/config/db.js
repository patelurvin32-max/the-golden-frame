const mongoose = require('mongoose');

/**
 * Establishes connection to MongoDB using Mongoose.
 * Exits process on failure since the app cannot function without a DB.
 */
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log(`✅ MongoDB connected: ${conn.connection.host}`);

    // Production safety net:
    // Older deployments created a stale unique index on customers.orderId.
    // That index treats missing orderId values as null, which blocks new
    // customer inserts with "Duplicate value for 'orderId': 'null'".
    // Drop it automatically if it is still present.
    try {
      const customersCollection = mongoose.connection.db.collection('customers');
      const indexes = await customersCollection.indexes();
      const staleIndex = indexes.find(index => index.name === 'orderId_1');

      if (staleIndex) {
        await customersCollection.dropIndex('orderId_1');
        console.log('🧹 Dropped stale customers.orderId index');
      }
    } catch (indexError) {
      console.warn('⚠️  Skipped customer index cleanup:', indexError.message);
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
