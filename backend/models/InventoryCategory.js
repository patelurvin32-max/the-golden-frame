const mongoose = require('mongoose');

const inventoryCategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
  },
  { timestamps: true }
);

// Indexes
inventoryCategorySchema.index({ name: 1 });

module.exports = mongoose.model('InventoryCategory', inventoryCategorySchema);
