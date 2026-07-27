const mongoose = require('mongoose');

const orderCounterSchema = new mongoose.Schema(
  {
    date: { type: String, required: true, unique: true }, // Format: YYYY/MM/DD
    sequence: { type: Number, required: true, default: 0 },
  },
  { timestamps: true }
);


module.exports = mongoose.model('OrderCounter', orderCounterSchema);
