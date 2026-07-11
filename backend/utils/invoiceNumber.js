/**
 * Generates a unique invoice number in the format: INV-YYYYMMDD-XXXX
 * Uses a counter padded to 4 digits based on today's bill count.
 */
const { Bill } = require('../models/Billing');

const { getBusinessDayCompactString, getBusinessDayStart } = require('./businessDay');

const generateInvoiceNumber = async () => {
  const today = new Date();
  const dateStr = getBusinessDayCompactString(today);
  const businessDayStart = getBusinessDayStart(today);
  const count = await Bill.countDocuments({ createdAt: { $gte: businessDayStart } });
  const seq = String(count + 1).padStart(4, '0');
  return `INV-${dateStr}-${seq}`;
};

module.exports = { generateInvoiceNumber };
