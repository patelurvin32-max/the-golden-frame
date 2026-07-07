const mongoose = require('mongoose');
const { INVENTORY_CATEGORIES, EXPENSE_CATEGORIES, MEMBERSHIP_TIERS } = require('../config/constants');

const inventorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryCategory', required: true },
    sku: { type: String, trim: true },
    unit: { type: String, default: 'pcs' },
    stockQuantity: { type: Number, default: 0, min: 0 },
    lowStockThreshold: { type: Number, default: 5 },
    purchasePrice: { type: Number, default: 0 },
    sellingPrice: { type: Number, default: 0 },
    purchaseHistory: [
      {
        quantity: Number,
        cost: Number,
        supplier: String,
        date: { type: Date, default: Date.now },
        addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      },
    ],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Indexes for better query performance
inventorySchema.index({ branch: 1, isActive: 1 });
inventorySchema.index({ category: 1 });
inventorySchema.index({ name: 1 });
inventorySchema.index({ sku: 1 });

const expenseSchema = new mongoose.Schema(
  {
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    category: { type: String, enum: EXPENSE_CATEGORIES, required: true },
    title: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
    date: { type: Date, required: true, default: Date.now },
    notes: { type: String, trim: true },
    receiptUrl: { type: String },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

const membershipPlanSchema = new mongoose.Schema(
  {
    tier: { type: String, enum: MEMBERSHIP_TIERS, required: true, unique: true },
    discountPercent: { type: Number, required: true, min: 0, max: 100 },
    freeHoursPerMonth: { type: Number, default: 0 },
    priorityBooking: { type: Boolean, default: false },
    rewardPointsRate: { type: Number, default: 1 }, // points per currency unit spent
    price: { type: Number, default: 0 }, // membership fee
    durationMonths: { type: Number, default: 12 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Menu Category Schema
const menuCategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
  },
  { timestamps: true }
);

// Indexes for menu categories
menuCategorySchema.index({ name: 1 });
menuCategorySchema.index({ status: 1 });

// Menu Item Schema
const menuItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    branch: { type: mongoose.Schema.Types.ObjectId, ref: 'Branch', required: true },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuCategory', required: true },
    price: { type: Number, required: true, min: 0 },
    halfPrice: { type: Number, min: 0 },
    fullPrice: { type: Number, min: 0 },
    description: { type: String, trim: true },
    availability: { type: String, enum: ['Available', 'Unavailable'], default: 'Available' },
    status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
  },
  { timestamps: true }
);

// Indexes for menu items
menuItemSchema.index({ branch: 1, status: 1 });
menuItemSchema.index({ category: 1 });
menuItemSchema.index({ name: 1 });
menuItemSchema.index({ availability: 1 });
menuItemSchema.index({ status: 1 });
menuItemSchema.index({ createdAt: -1 });

module.exports = {
  Inventory: mongoose.model('Inventory', inventorySchema),
  Expense: mongoose.model('Expense', expenseSchema),
  MembershipPlan: mongoose.model('MembershipPlan', membershipPlanSchema),
  MenuCategory: mongoose.model('MenuCategory', menuCategorySchema),
  MenuItem: mongoose.model('MenuItem', menuItemSchema),
};
