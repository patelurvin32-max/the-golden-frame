const mongoose = require('mongoose');

const orderCounterSchema = new mongoose.Schema(
  {
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    date: { type: String, required: true }, // Format: YYYY/MM/DD
    sequence: { type: Number, required: true, default: 0 },
  },
  { timestamps: true }
);

orderCounterSchema.index({ branch: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('OrderCounter', orderCounterSchema);
