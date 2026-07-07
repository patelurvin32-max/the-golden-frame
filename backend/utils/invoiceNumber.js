/**
 * Generates a unique invoice number in the format: INV-YYYYMMDD-XXXX
 * Uses a counter padded to 4 digits based on today's bill count.
 */
const { Bill } = require('../models/Billing');

const generateInvoiceNumber = async () => {
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
  const startOfDay = new Date(today.setHours(0, 0, 0, 0));
  const count = await Bill.countDocuments({ createdAt: { $gte: startOfDay } });
  const seq = String(count + 1).padStart(4, '0');
  return `INV-${dateStr}-${seq}`;
};

module.exports = { generateInvoiceNumber };
