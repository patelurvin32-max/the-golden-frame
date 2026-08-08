const mongoose = require('mongoose');

/**
 * Establishes connection to MongoDB using Mongoose.
 * Exits process on failure since the app cannot function without a DB.
 */
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      // Keep connections warm in a pool
      maxPoolSize: 10,               // up to 10 simultaneous connections
      minPoolSize: 2,                // always keep 2 connections ready
      
      // Fail fast instead of hanging
      serverSelectionTimeoutMS: 5000,  // give up finding server in 5s
      socketTimeoutMS: 45000,          // close idle sockets after 45s
      connectTimeoutMS: 10000,         // give up initial connect in 10s
      
      // Detect broken connections quickly
      heartbeatFrequencyMS: 10000,     // heartbeat every 10s
    });

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
