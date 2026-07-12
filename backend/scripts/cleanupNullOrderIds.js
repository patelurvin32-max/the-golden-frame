/**
 * Script to clean up orders with null orderId and initialize OrderCounter
 * Run this to fix the duplicate orderId error in production
 * Usage: node backend/scripts/cleanupNullOrderIds.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const Order = require('../models/Order');
const OrderCounter = require('../models/OrderCounter');

const { getBusinessDayDateString } = require('../utils/businessDay');

async function cleanupNullOrderIds() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Find and delete orders with null or 'null' orderId
    const nullOrders = await Order.find({
      $or: [
        { orderId: null },
        { orderId: 'null' },
        { orderId: { $exists: false } }
      ]
    });
    
    console.log(`Found ${nullOrders.length} orders with null orderId`);
    
    if (nullOrders.length > 0) {
      const deleted = await Order.deleteMany({
        $or: [
          { orderId: null },
          { orderId: 'null' },
          { orderId: { $exists: false } }
        ]
      });
      console.log(`Deleted ${deleted.deletedCount} orders with null orderId`);
    }

    // Initialize OrderCounter for today if it doesn't exist
    const today = getBusinessDayDateString();
    const existingCounter = await OrderCounter.findOne({ date: today });
    
    if (!existingCounter) {
      // Find the highest sequence number for today's orders
      const todayOrders = await Order.find({ orderId: new RegExp(`^${today}`) });
      let maxSequence = 0;
      
      todayOrders.forEach(order => {
        const match = order.orderId.match(/\/(\d+)$/);
        if (match) {
          const sequence = parseInt(match[1], 10);
          if (sequence > maxSequence) {
            maxSequence = sequence;
          }
        }
      });
      
      await OrderCounter.create({
        date: today,
        sequence: maxSequence
      });
      
      console.log(`Initialized OrderCounter for ${today} with sequence ${maxSequence}`);
    } else {
      console.log(`OrderCounter already exists for ${today} with sequence ${existingCounter.sequence}`);
    }

    console.log('Cleanup completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Error during cleanup:', error);
    process.exit(1);
  }
}

cleanupNullOrderIds();
