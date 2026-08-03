const mongoose = require('mongoose');

const customerCounterSchema = new mongoose.Schema({
  _id: { type: String },
  seq: { type: Number, default: 0 },
});

module.exports = mongoose.model('CustomerCounter', customerCounterSchema);
