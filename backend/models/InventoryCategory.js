const mongoose = require('mongoose');

const inventoryCategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
  },
  { timestamps: true }
);

// Indexes
inventoryCategorySchema.index({ name: 1, branch: 1 }, { unique: true });
inventoryCategorySchema.index({ branch: 1 });

module.exports = mongoose.model('InventoryCategory', inventoryCategorySchema);
