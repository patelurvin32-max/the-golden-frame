const mongoose = require('mongoose');
const Customer = require('../models/Customer');
const Order = require('../models/Order');
const PaymentHistory = require('../models/PaymentHistory');
const WalletTransaction = require('../models/WalletTransaction');
const Transaction = require('../models/Transaction');

const backfillTransactions = async () => {
  try {


    // 1. Process PaymentHistory records
    const paymentHistories = await PaymentHistory.find({
      $or: [
        { transactionId: { $exists: false } },
        { transactionId: null }
      ]
    }).lean();



    let phCount = 0;
    for (const ph of paymentHistories) {
      // Check if already backfilled using historicalRef
      const exists = await Transaction.findOne({ historicalRef: ph._id });
      if (exists) continue;

      // Lookup customer ID
      let customerIdStr = 'UNKNOWN';
      if (ph.customer) {
        const cust = await Customer.findById(ph.customer).lean();
        if (cust) {
          customerIdStr = cust.customerId || 'UNKNOWN';
        }
      }

      const now = new Date(ph.createdAt);
      const transactionDate = now.toISOString().split('T')[0];
      const transactionTime = now.toTimeString().split(' ')[0];

      // Determine type based on notes/paymentNumber
      let paymentType = 'Old Payment';
      let allocationDetailsUnavailable = false;
      
      const notesLower = (ph.notes || '').toLowerCase();
      if (notesLower.includes('extra') || notesLower.includes('automatic deduction')) {
        paymentType = 'Extra';
        allocationDetailsUnavailable = true; // Old extra details can't be fully grouped/traced to wallet counterparts
      } else if (ph.paymentNumber === 1) {
        paymentType = 'Session Bill';
      }

      const txnId = `TXN/HIST/${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}/${ph._id.toString().slice(-4).toUpperCase()}`;

      await Transaction.create({
        transactionId: txnId,
        customer: ph.customer || new mongoose.Types.ObjectId(),
        customerId: customerIdStr,
        customerName: ph.customerName || 'Unknown Customer',
        customerPhone: ph.customerPhone || '0000000000',
        branch: ph.branch,
        transactionDate,
        transactionTime,
        originalAmount: ph.totalPaid,
        amountDeducted: ph.totalPaid,
        remainingAmount: ph.pendingAmount || 0,
        amountAddedToWallet: 0,
        pendingPaymentRefs: ph.order ? [ph.order] : [],
        pendingPaymentOrderIds: ph.orderId ? [ph.orderId] : [],
        paymentType,
        paymentMethod: ph.paymentMethod || 'cash',
        createdBy: ph.createdBy || new mongoose.Types.ObjectId(),
        status: 'completed',
        historicalRef: ph._id,
        allocationDetailsUnavailable
      });

      phCount++;
    }

    // 2. Process WalletTransaction records (only credits that are not already linked)
    const walletTransactions = await WalletTransaction.find({
      type: 'credit',
      $or: [
        { transactionId: { $exists: false } },
        { transactionId: null }
      ]
    }).lean();



    let wtCount = 0;
    for (const wt of walletTransactions) {
      // Check if already backfilled using historicalRef
      const exists = await Transaction.findOne({ historicalRef: wt._id });
      if (exists) continue;

      // Lookup customer ID
      let customerIdStr = 'UNKNOWN';
      if (wt.customer) {
        const cust = await Customer.findById(wt.customer).lean();
        if (cust) {
          customerIdStr = cust.customerId || 'UNKNOWN';
        }
      }

      const now = new Date(wt.createdAt);
      const transactionDate = now.toISOString().split('T')[0];
      const transactionTime = now.toTimeString().split(' ')[0];

      let paymentType = 'Wallet Topup';
      let allocationDetailsUnavailable = false;
      const descLower = (wt.description || '').toLowerCase();
      if (descLower.includes('extra') || descLower.includes('auto top-up')) {
        paymentType = 'Extra';
        allocationDetailsUnavailable = true; // Old extra details can't be linked to pending payment deductions
      }

      const txnId = `TXN/HIST-WT/${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}/${wt._id.toString().slice(-4).toUpperCase()}`;

      await Transaction.create({
        transactionId: txnId,
        customer: wt.customer,
        customerId: customerIdStr,
        customerName: wt.customerName || 'Unknown Customer',
        customerPhone: wt.customerPhone || '0000000000',
        branch: wt.branch,
        transactionDate,
        transactionTime,
        originalAmount: wt.amount,
        amountDeducted: 0,
        remainingAmount: 0,
        amountAddedToWallet: wt.amount,
        walletTxnRef: wt._id,
        paymentType,
        paymentMethod: wt.paymentMethod || 'cash',
        createdBy: wt.createdBy || new mongoose.Types.ObjectId(),
        status: 'completed',
        historicalRef: wt._id,
        allocationDetailsUnavailable
      });

      wtCount++;
    }


  } catch (err) {
    console.error('❌ Error during Transaction backfill:', err);
  }
};

module.exports = backfillTransactions;
