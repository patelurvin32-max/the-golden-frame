const mongoose = require('mongoose');

const orderCounterSchema = new mongoose.Schema(
  {
    date: { type: String, required: true, unique: true }, // Format: YYYY/MM/DD
    sequence: { type: Number, required: true, default: 0 },
  },
  { timestamps: true }
);

// Index for quick lookups
orderCounterSchema.index({ date: 1 }, { unique: true });

module.exports = mongoose.model('OrderCounter', orderCounterSchema);
