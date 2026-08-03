const { Bill } = require('../models/Billing');

const { getBusinessDayCompactString, getBusinessDayStart, getBusinessDayNextStart } = require('./businessDay');

const generateInvoiceNumber = async (branchId) => {
  const now = new Date();
  const dateStr = getBusinessDayCompactString(now);  // e.g. "20260730"
  const start = getBusinessDayStart(now);
  const nextStart = getBusinessDayNextStart(now);
  
  let count = await Bill.countDocuments({ branch: branchId, createdAt: { $gte: start, $lt: nextStart } });
  
  let attempts = 0;
  while (attempts < 50) {
    const seq = String(count + 1).padStart(4, '0');
    const invoiceNumber = `INV-${dateStr}-${seq}`;  // e.g. "INV-20260730-0001"
    
    const exists = await Bill.findOne({ branch: branchId, invoiceNumber });
    if (!exists) {
      return invoiceNumber;
    }
    count++;
    attempts++;
  }
  
  return `INV-${dateStr}-${Date.now()}`;
};


module.exports = { generateInvoiceNumber };
