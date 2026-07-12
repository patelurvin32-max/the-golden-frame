const mongoose = require('mongoose');

const walletTransactionSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    customerName: { type: String, required: true },
    customerPhone: { type: String, required: true },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
    orderId: { type: String },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    type: { type: String, enum: ['credit', 'debit'], required: true },
    amount: { type: Number, required: true },
    balance: { type: Number, required: true }, // Balance after transaction
    billAmount: { type: Number },
    amountReceived: { type: Number },
    walletAmountAdded: { type: Number },
    walletAmountUsed: { type: Number },
    paymentMethod: { type: String },
    description: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

// Indexes for performance
walletTransactionSchema.index({ customer: 1 });
walletTransactionSchema.index({ customerPhone: 1 });
walletTransactionSchema.index({ orderId: 1 });
walletTransactionSchema.index({ branch: 1 });
walletTransactionSchema.index({ type: 1 });
walletTransactionSchema.index({ paymentMethod: 1 });
walletTransactionSchema.index({ createdAt: -1 });
walletTransactionSchema.index({ balance: 1 });
// Compound indexes for common queries
walletTransactionSchema.index({ customer: 1, createdAt: -1 });
walletTransactionSchema.index({ branch: 1, createdAt: -1 });
walletTransactionSchema.index({ customerPhone: 1, branch: 1, createdAt: -1 });
walletTransactionSchema.index({ type: 1, branch: 1, createdAt: -1 });
walletTransactionSchema.index({ createdAt: -1, branch: 1 });

module.exports = mongoose.model('WalletTransaction', walletTransactionSchema);
