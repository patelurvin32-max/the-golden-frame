/**
 * Script to backfill Order IDs for existing customers
 * Run this once to generate custom Order IDs for all existing customers
 * Usage: node backend/scripts/backfillOrderIds.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const Customer = require('../models/Customer');
const OrderCounter = require('../models/OrderCounter');

// Helper function to generate custom Order ID using OrderCounter
const generateOrderId = async (date) => {
  const today = date || new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  const dateStr = `${year}/${month}/${day}`;

  // Use OrderCounter for atomic increment
  const counter = await OrderCounter.findOneAndUpdate(
    { date: dateStr },
    { $inc: { sequence: 1 } },
    { new: true, upsert: true }
  );

  const sequence = counter.sequence;
  const sequenceStr = String(sequence).padStart(4, '0');
  return `${dateStr}/${sequenceStr}`;
};

async function backfillOrderIds() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Find all customers without orderId
    const customersWithoutOrderId = await Customer.find({ orderId: { $exists: false } });
    console.log(`Found ${customersWithoutOrderId.length} customers without Order ID`);

    // Group customers by creation date
    const customersByDate = {};
    for (const customer of customersWithoutOrderId) {
      const dateKey = customer.createdAt.toISOString().split('T')[0];
      if (!customersByDate[dateKey]) {
        customersByDate[dateKey] = [];
      }
      customersByDate[dateKey].push(customer);
    }

    // Generate Order IDs for each date group
    let updatedCount = 0;
    for (const dateKey in customersByDate) {
      const customers = customersByDate[dateKey];
      const date = new Date(dateKey);
      
      // Sort customers by creation time
      customers.sort((a, b) => a.createdAt - b.createdAt);

      for (const customer of customers) {
        const orderId = await generateOrderId(date);
        await Customer.findByIdAndUpdate(customer._id, { orderId });
        console.log(`Updated customer ${customer.name} (${customer._id}) with Order ID: ${orderId}`);
        updatedCount++;
      }
    }

    console.log(`Successfully updated ${updatedCount} customers with Order IDs`);
    process.exit(0);
  } catch (error) {
    console.error('Error backfilling Order IDs:', error);
    process.exit(1);
  }
}

backfillOrderIds();
