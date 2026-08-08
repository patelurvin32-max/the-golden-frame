const mongoose = require('mongoose');
const { PAYMENT_METHODS } = require('../config/constants');

const paymentHistorySchema = new mongoose.Schema(
  {
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: function() { return !this.expense && !this.reservation && !this.wallet; } },
    orderId: { type: String, required: function() { return !this.expense && !this.reservation && !this.wallet; } },
    reservation: { type: mongoose.Schema.Types.ObjectId, ref: 'Reservation' },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: function() { return !this.expense && !this.reservation && !this.wallet; } },
    customerName: { type: String, required: function() { return !this.expense && !this.wallet; } },
    customerPhone: { type: String, required: function() { return !this.expense && !this.wallet; } },
    expense: { type: mongoose.Schema.Types.ObjectId, ref: 'Expense' },
    wallet: { type: mongoose.Schema.Types.ObjectId, ref: 'Wallet' },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    paymentMethod: { type: String, enum: [...PAYMENT_METHODS, 'n/a', 'N/A', null, ''], default: null, required: false },
    cashAmount: { type: Number, default: 0 },
    onlineAmount: { type: Number, default: 0 },
    walletAmount: { type: Number, default: 0 },
    totalPaid: { type: Number, required: true },
    billAmount: { type: Number, required: true },
    pendingAmount: { type: Number, default: 0 },
    paymentStatus: { type: String, enum: ['paid', 'partial', 'unpaid', 'refunded'], required: true },
    notes: { type: String, trim: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    paymentNumber: { type: Number, required: true }, // Sequence number for payments on the same order
  },
  { timestamps: true }
);

// Indexes for performance
paymentHistorySchema.index({ order: 1, createdAt: -1 });
paymentHistorySchema.index({ orderId: 1, createdAt: -1 });
paymentHistorySchema.index({ customer: 1, createdAt: -1 });
paymentHistorySchema.index({ wallet: 1, createdAt: -1 });
paymentHistorySchema.index({ branch: 1, createdAt: -1 });
paymentHistorySchema.index({ paymentStatus: 1, createdAt: -1 });
paymentHistorySchema.index({ order: 1, paymentNumber: 1 }, { unique: true, partialFilterExpression: { order: { $type: 'objectId' } } }); // Ensure unique payment numbers per order

module.exports = mongoose.model('PaymentHistory', paymentHistorySchema);
