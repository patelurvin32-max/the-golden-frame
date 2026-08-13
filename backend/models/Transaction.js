const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema(
  {
    transactionId: { type: String, required: true, unique: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    customerId: { type: String, required: true },
    customerName: { type: String, required: true },
    customerPhone: { type: String, required: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    transactionDate: { type: String, required: true }, // Format: YYYY-MM-DD
    transactionTime: { type: String, required: true }, // Format: HH:MM:SS
    originalAmount: { type: Number, required: true },
    amountDeducted: { type: Number, default: 0 },
    remainingAmount: { type: Number, default: 0 },
    amountAddedToWallet: { type: Number, default: 0 },
    pendingPaymentRefs: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Order' }],
    pendingPaymentOrderIds: [{ type: String }],
    walletTxnRef: { type: mongoose.Schema.Types.ObjectId, ref: 'WalletTransaction' },
    walletIdRef: { type: String },
    paymentType: { type: String, required: true }, // 'Extra', 'Old Payment', 'Session Bill', 'Wallet Topup', etc.
    paymentMethod: { type: String, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, default: 'completed' },
    historicalRef: { type: mongoose.Schema.Types.ObjectId }, // Maps to original PaymentHistory/WalletTransaction ID if backfilled
    allocationDetailsUnavailable: { type: Boolean, default: false }
  },
  { timestamps: true }
);

// Indexes for performance
transactionSchema.index({ transactionId: 1 });
transactionSchema.index({ customer: 1 });
transactionSchema.index({ branch: 1 });
transactionSchema.index({ transactionDate: -1, transactionTime: -1 });
transactionSchema.index({ transactionDate: -1 });
transactionSchema.index({ paymentType: 1 });
transactionSchema.index({ customerPhone: 1 });
transactionSchema.index({ customerName: 1 });
transactionSchema.index({ customerId: 1 });
transactionSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Transaction', transactionSchema);
