const mongoose = require('mongoose');
const { PAYMENT_METHODS } = require('../config/constants');

const billItemSchema = new mongoose.Schema(
  {
    description: { type: String, required: true },
    quantity: { type: Number, default: 1 },
    unitPrice: { type: Number, required: true },
    total: { type: Number, required: true },
    type: { type: String, enum: ['table_time', 'inventory', 'other'], default: 'other' },
    inventoryItem: { type: mongoose.Schema.Types.ObjectId, ref: 'Inventory' },
  },
  { _id: false }
);

const billSchema = new mongoose.Schema(
  {
    invoiceNumber: { type: String, required: true, unique: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer' },
    session: { type: mongoose.Schema.Types.ObjectId, ref: 'Session' },
    items: [billItemSchema],
    subtotal: { type: Number, required: true, default: 0 },
    discountType: { type: String, enum: ['flat', 'percent', null], default: null },
    discountValue: { type: Number, default: 0 },
    discountAmount: { type: Number, default: 0 },
    couponCode: { type: String, trim: true },
    membershipDiscount: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    total: { type: Number, required: true, default: 0 },
    paymentStatus: { type: String, enum: ['unpaid', 'paid', 'partial'], default: 'unpaid' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    pdfUrl: { type: String },
  },
  { timestamps: true }
);

const paymentSchema = new mongoose.Schema(
  {
    bill: { type: mongoose.Schema.Types.ObjectId, ref: 'Bill', required: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    // For mixed payments, breakdown by sub-method
    breakdown: [
      {
        method: { type: String, enum: ['cash', 'upi'] },
        amount: { type: Number },
      },
    ],
    amount: { type: Number, required: true },
    receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    transactionRef: { type: String, trim: true },
  },
  { timestamps: true }
);

module.exports = {
  Bill: mongoose.model('Bill', billSchema),
  Payment: mongoose.model('Payment', paymentSchema),
};
