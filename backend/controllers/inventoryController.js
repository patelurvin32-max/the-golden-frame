const { Inventory, StockTransaction } = require('../models/Operations');
const InventoryCategory = require('../models/InventoryCategory');
const { Notification } = require('../models/System');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { ROLES } = require('../config/constants');

// GET /api/inventory
exports.getInventory = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const skip = (page - 1) * limit;

  const filter = { isActive: true };
  if (req.user.role !== ROLES.SUPER_ADMIN) {
    filter.branch = { $in: req.user.branches };
  }
  if (req.query.branch) filter.branch = req.query.branch;
  if (req.query.category && req.query.category !== 'all') {
    // If it's a mongoId, filter directly
    filter.category = req.query.category;
  }
  if (req.query.lowStock === 'true') {
    filter.$expr = { $lte: ['$currentStock', '$minimumStockAlert'] };
  }
  if (req.query.search) {
    const searchRegex = new RegExp(req.query.search, 'i');
    filter.$or = [
      { name: searchRegex },
      { sku: searchRegex }
    ];
  }

  // To sort by category name and then item name, we use an aggregation pipeline.
  // This allows sorting by the category's resolved name string.
  const pipeline = [
    { $match: filter },
    {
      $lookup: {
        from: 'inventorycategories',
        localField: 'category',
        foreignField: '_id',
        as: 'categoryInfo'
      }
    },
    { $unwind: '$categoryInfo' },
    {
      $sort: {
        'categoryInfo.name': 1,
        'name': 1
      }
    }
  ];

  // Count total records matching filter
  const countPipeline = [...pipeline, { $count: 'total' }];
  const countResult = await Inventory.aggregate(countPipeline);
  const total = countResult[0]?.total || 0;

  // Add pagination stages
  const paginatedPipeline = [
    ...pipeline,
    { $skip: skip },
    { $limit: limit },
    {
      $project: {
        _id: 1,
        name: 1,
        branch: 1,
        category: '$categoryInfo', // Populate full category info
        unit: 1,
        openingStock: 1,
        currentStock: 1,
        minimumStockAlert: 1,
        purchasePrice: 1,
        sellingPrice: 1,
        sku: 1,
        isActive: 1,
        createdAt: 1,
        updatedAt: 1
      }
    }
  ];

  const items = await Inventory.aggregate(paginatedPipeline);

  res.status(200).json({
    success: true,
    data: {
      items,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    }
  });
});

// GET /api/inventory/categories
exports.getCategories = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.activeOnly === 'true') {
    filter.status = 'Active';
  }
  if (req.user.role !== ROLES.SUPER_ADMIN) {
    filter.branch = { $in: req.user.branches };
  }
  const categories = await InventoryCategory.find(filter).sort('name');

  // Compute Total Items for each category
  const categoriesWithCount = await Promise.all(
    categories.map(async (cat) => {
      const totalItems = await Inventory.countDocuments({ category: cat._id, isActive: true });
      return {
        _id: cat._id,
        name: cat.name,
        branch: cat.branch,
        status: cat.status,
        totalItems,
        createdAt: cat.createdAt,
        updatedAt: cat.updatedAt,
      };
    })
  );

  res.status(200).json({ success: true, count: categoriesWithCount.length, data: { categories: categoriesWithCount } });
});

// POST /api/inventory/categories
exports.createCategory = asyncHandler(async (req, res, next) => {
  const { name, branch, status } = req.body;
  if (!name) return next(new AppError('Category name is required.', 400));

  // For Branch Manager and Staff, auto-assign branch from their assigned branches
  let finalBranch = branch;
  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.branches && req.user.branches.length > 0) {
    finalBranch = req.user.branches[0];
  }

  const exists = await InventoryCategory.findOne({ 
    name: { $regex: new RegExp(`^${name.trim()}$`, 'i') },
    branch: finalBranch
  });
  if (exists) {
    return next(new AppError('Category with this name already exists in this branch.', 400));
  }

  const category = await InventoryCategory.create({ name: name.trim(), branch: finalBranch, status: status || 'Active' });
  res.status(201).json({ success: true, data: { category } });
});

// PATCH /api/inventory/categories/:id
exports.updateCategory = asyncHandler(async (req, res, next) => {
  const { name, status } = req.body;

  const category = await InventoryCategory.findById(req.params.id);
  if (!category) return next(new AppError('Category not found.', 404));

  if (name) {
    const exists = await InventoryCategory.findOne({
      _id: { $ne: req.params.id },
      name: { $regex: new RegExp(`^${name.trim()}$`, 'i') }
    });
    if (exists) {
      return next(new AppError('Category with this name already exists.', 400));
    }
    category.name = name.trim();
  }

  if (status) {
    category.status = status;
  }

  await category.save();
  res.status(200).json({ success: true, data: { category } });
});

// DELETE /api/inventory/categories/:id
exports.deleteCategory = asyncHandler(async (req, res, next) => {
  const categoryId = req.params.id;

  const itemsCount = await Inventory.countDocuments({ category: categoryId, isActive: true });
  if (itemsCount > 0) {
    return next(new AppError('Cannot delete category because it contains inventory items.', 400));
  }

  const category = await InventoryCategory.findByIdAndDelete(categoryId);
  if (!category) return next(new AppError('Category not found.', 404));

  res.status(200).json({ success: true, message: 'Category deleted successfully.' });
});

// GET /api/inventory/:id
exports.getInventoryItem = asyncHandler(async (req, res, next) => {
  const item = await Inventory.findById(req.params.id).populate('category');
  if (!item) return next(new AppError('Item not found.', 404));
  res.status(200).json({ success: true, data: { item } });
});

// POST /api/inventory
exports.createInventoryItem = asyncHandler(async (req, res, next) => {
  // For Branch Manager and Staff, auto-assign branch from their assigned branches
  let finalBranch = req.body.branch;
  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.branches && req.user.branches.length > 0) {
    finalBranch = req.user.branches[0];
  }

  const item = await Inventory.create({ ...req.body, branch: finalBranch });
  res.status(201).json({ success: true, data: { item } });
});

// PATCH /api/inventory/:id
exports.updateInventoryItem = asyncHandler(async (req, res, next) => {
  const item = await Inventory.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!item) return next(new AppError('Item not found.', 404));
  res.status(200).json({ success: true, data: { item } });
});

// POST /api/inventory/:id/restock
exports.restockItem = asyncHandler(async (req, res, next) => {
  const { quantity, cost, supplier } = req.body;
  const item = await Inventory.findById(req.params.id);
  if (!item) return next(new AppError('Item not found.', 404));

  const previousStock = item.currentStock;
  item.currentStock += quantity;
  item.purchaseHistory.push({ quantity, cost, supplier, addedBy: req.user._id });
  await item.save();

  // Create stock transaction record
  await StockTransaction.create({
    inventoryItem: item._id,
    quantity,
    type: 'restock',
    previousStock,
    newStock: item.currentStock,
    branch: item.branch,
    notes: `Restocked ${quantity} ${item.unit}`,
    createdBy: req.user._id,
  });

  if (item.currentStock > item.minimumStockAlert) {
    await Notification.deleteMany({
      type: 'low_inventory',
      'meta.inventoryId': item._id.toString(),
      isRead: false,
    });
  }

  res.status(200).json({ success: true, data: { item } });
});

// Internal helper for triggering low-stock alerts (unchanged)
exports.checkLowStock = async (inventoryId) => {
  const item = await Inventory.findById(inventoryId);
  if (!item) return;
  if (item.currentStock <= item.minimumStockAlert) {
    await Notification.create({
      branch: item.branch,
      type: 'low_inventory',
      title: 'Low Stock Alert',
      message: `${item.name} is running low (${item.currentStock} ${item.unit} remaining).`,
      targetRoles: ['super_admin', 'branch_manager'],
      meta: { inventoryId: item._id.toString() },
    });
  }
};

// GET /api/inventory/report
exports.getInventoryReport = asyncHandler(async (req, res) => {
  const filter = { isActive: true };
  if (req.user.role !== ROLES.SUPER_ADMIN) {
    filter.branch = { $in: req.user.branches };
  }
  if (req.query.branch) filter.branch = req.query.branch;

  const items = await Inventory.find(filter).populate('category');

  // Calculate sold quantities from stock transactions
  const itemsWithStats = await Promise.all(
    items.map(async (item) => {
      const soldQuantity = await StockTransaction.aggregate([
        { $match: { inventoryItem: item._id, type: 'sale' } },
        { $group: { _id: null, total: { $sum: '$quantity' } } }
      ]);

      const sold = soldQuantity[0]?.total || 0;
      const remainingStock = item.currentStock;
      const stockStatus = remainingStock === 0 ? 'out_of_stock' : 
                          remainingStock <= item.minimumStockAlert ? 'low_stock' : 'normal';

      return {
        _id: item._id,
        name: item.name,
        category: item.category,
        openingStock: item.openingStock,
        soldQuantity: sold,
        remainingStock: remainingStock,
        status: stockStatus,
        unit: item.unit,
        purchasePrice: item.purchasePrice,
        sellingPrice: item.sellingPrice,
      };
    })
  );

  const summary = {
    totalItems: itemsWithStats.length,
    lowStockItems: itemsWithStats.filter(i => i.status === 'low_stock').length,
    outOfStockItems: itemsWithStats.filter(i => i.status === 'out_of_stock').length,
    totalValue: itemsWithStats.reduce((sum, i) => sum + (i.remainingStock * i.purchasePrice), 0),
  };

  res.status(200).json({
    success: true,
    data: {
      summary,
      items: itemsWithStats
    }
  });
});

// DELETE /api/inventory/:id
exports.deleteInventoryItem = asyncHandler(async (req, res, next) => {
  const item = await Inventory.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
  if (!item) return next(new AppError('Item not found.', 404));
  res.status(200).json({ success: true, message: 'Item removed.' });
});
