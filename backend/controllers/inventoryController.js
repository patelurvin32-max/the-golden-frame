const { Inventory, StockTransaction } = require('../models/Operations');
const InventoryCategory = require('../models/InventoryCategory');
const { Notification } = require('../models/System');
const { createBranchNotification } = require('../services/notificationService');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { ROLES } = require('../config/constants');
const mongoose = require('mongoose');

// GET /api/inventory
exports.getInventory = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const skip = (page - 1) * limit;

  const filter = { isActive: true };
  const userBranchIds = (req.user.branches || []).map(b => (b._id || b).toString());
  
  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.role !== ROLES.ADMIN) {
    if (req.query.branch && userBranchIds.includes(req.query.branch.toString())) {
      filter.branch = new mongoose.Types.ObjectId(req.query.branch);
    } else {
      filter.branch = { $in: userBranchIds.map(id => new mongoose.Types.ObjectId(id)) };
    }
  } else if (req.query.branch) {
    filter.branch = new mongoose.Types.ObjectId(req.query.branch);
  }
  if (req.query.category && req.query.category !== 'all') {
    // If it's a mongoId, filter directly
    filter.category = new mongoose.Types.ObjectId(req.query.category);
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
  const userBranchIds = (req.user.branches || []).map(b => (b._id || b).toString());
  
  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.role !== ROLES.ADMIN) {
    if (req.query.branch && userBranchIds.includes(req.query.branch.toString())) {
      filter.branch = req.query.branch;
    } else {
      filter.branch = { $in: userBranchIds };
    }
  } else if (req.query.branch) {
    filter.branch = req.query.branch;
  }
  const categories = await InventoryCategory.find(filter).sort('name').lean();

  // Single aggregation query to count items for all categories
  const categoryCounts = await Inventory.aggregate([
    { $match: { isActive: true } },
    { $group: { _id: '$category', totalItems: { $sum: 1 } } }
  ]);

  const countMap = new Map(categoryCounts.map(c => [c._id?.toString(), c.totalItems]));

  const categoriesWithCount = categories.map((cat) => ({
    _id: cat._id,
    name: cat.name,
    branch: cat.branch,
    status: cat.status,
    totalItems: countMap.get(cat._id.toString()) || 0,
    createdAt: cat.createdAt,
    updatedAt: cat.updatedAt,
  }));

  res.status(200).json({ success: true, count: categoriesWithCount.length, data: { categories: categoriesWithCount } });
});

// POST /api/inventory/categories
exports.createCategory = asyncHandler(async (req, res, next) => {
  const { name, branch, status } = req.body;
  if (!name) return next(new AppError('Category name is required.', 400));

  // For Branch Manager and Staff, auto-assign branch from their assigned branches
  let finalBranch = branch;
  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.branches && req.user.branches.length > 0) {
    finalBranch = req.user.branches[0]._id || req.user.branches[0];
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

  const updateData = {};

  if (name) {
    const exists = await InventoryCategory.findOne({
      _id: { $ne: req.params.id },
      name: { $regex: new RegExp(`^${name.trim()}$`, 'i') },
      branch: category.branch
    });
    if (exists) {
      return next(new AppError('Category with this name already exists.', 400));
    }
    updateData.name = name.trim();
  }

  if (status) {
    updateData.status = status;
  }

  const updatedCategory = await InventoryCategory.findByIdAndUpdate(
    req.params.id,
    updateData,
    { new: true }
  );

  res.status(200).json({ success: true, data: { category: updatedCategory } });
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
  const item = await Inventory.findById(req.params.id).populate('category').lean();
  if (!item) return next(new AppError('Item not found.', 404));
  res.status(200).json({ success: true, data: { item } });
});

// POST /api/inventory
exports.createInventoryItem = asyncHandler(async (req, res, next) => {
  // For Branch Manager and Staff, auto-assign branch from their assigned branches
  let finalBranch = req.body.branch;
  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.branches && req.user.branches.length > 0) {
    finalBranch = req.user.branches[0]._id || req.user.branches[0];
  }

  const item = await Inventory.create({ ...req.body, branch: finalBranch });

  if (item.currentStock > 0) {
    await StockTransaction.create({
      inventoryItem: item._id,
      quantity: item.currentStock,
      type: 'stock_in',
      previousStock: 0,
      newStock: item.currentStock,
      branch: item.branch,
      notes: 'Opening stock',
      createdBy: req.user._id,
    });
  }

  res.status(201).json({ success: true, data: { item } });
});

// PATCH /api/inventory/:id
exports.updateInventoryItem = asyncHandler(async (req, res, next) => {
  const oldItem = await Inventory.findById(req.params.id);
  if (!oldItem) return next(new AppError('Item not found.', 404));

  const item = await Inventory.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });

  // Check if currentStock changed manually
  if (req.body.currentStock !== undefined && Number(req.body.currentStock) !== oldItem.currentStock) {
    const newStock = Number(req.body.currentStock);
    const diff = newStock - oldItem.currentStock;
    await StockTransaction.create({
      inventoryItem: item._id,
      quantity: Math.abs(diff),
      type: 'adjustment',
      previousStock: oldItem.currentStock,
      newStock: newStock,
      branch: item.branch,
      notes: 'Manual stock adjustment via item update',
      createdBy: req.user._id,
    });
  }

  // Check for low stock alert if stock decreased or minimumStockAlert changed
  if (item.currentStock <= item.minimumStockAlert) {
    if (
      (req.body.currentStock !== undefined && Number(req.body.currentStock) < oldItem.currentStock) ||
      (req.body.minimumStockAlert !== undefined && Number(req.body.minimumStockAlert) !== oldItem.minimumStockAlert)
    ) {
      await exports.checkLowStock(item._id, req);
    }
  } else {
    // Stock is above minimum — clear any existing low-stock notifications
    await Notification.deleteMany({
      type: 'low_inventory',
      'meta.inventoryId': item._id.toString(),
      isRead: false,
    });
  }

  res.status(200).json({ success: true, data: { item } });
});

// POST /api/inventory/:id/restock
exports.restockItem = asyncHandler(async (req, res, next) => {
  const { quantity, cost, supplier } = req.body;
  const item = await Inventory.findById(req.params.id);
  if (!item) return next(new AppError('Item not found.', 404));

  const previousStock = item.currentStock;
  item.currentStock += quantity;
  item.purchaseHistory.push({ quantity, cost, supplier, date: new Date(), addedBy: req.user._id });
  await item.save();

  // Create stock transaction record with cost and supplier
  await StockTransaction.create({
    inventoryItem: item._id,
    quantity,
    type: 'restock',
    previousStock,
    newStock: item.currentStock,
    branch: item.branch,
    cost: cost || 0,
    supplier: supplier || '',
    notes: `Restocked ${quantity} ${item.unit}${supplier ? ` from ${supplier}` : ''}`,
    createdBy: req.user._id,
  });

  if (item.currentStock > item.minimumStockAlert) {
    // Stock is above minimum - clear any existing low-stock notifications
    await Notification.deleteMany({
      type: 'low_inventory',
      'meta.inventoryId': item._id.toString(),
      isRead: false,
    });
  } else {
    // Stock is still at or below minimum after restock - trigger low-stock alert
    await exports.checkLowStock(item._id, req);
  }

  res.status(200).json({ success: true, data: { item } });
});

// Internal helper for triggering low-stock alerts with branch-specific notifications
exports.checkLowStock = async (inventoryId, req = null) => {
  const item = await Inventory.findById(inventoryId).populate('branch', 'name');
  if (!item) return;
  if (item.currentStock <= item.minimumStockAlert) {
    // Avoid duplicate unread notifications for the same item
    const existing = await Notification.findOne({
      type: 'low_inventory',
      'meta.inventoryId': item._id.toString(),
      isRead: false,
    });
    if (existing) return;

    const branchName = item.branch?.name || 'Unknown Branch';
    const branchId = item.branch?._id || item.branch;

    await createBranchNotification({
      branchId,
      actor: req?.user || null,
      title: '⚠️ Low Stock Alert',
      message: `${item.name} — Current Stock: ${item.currentStock} ${item.unit} | Minimum Stock: ${item.minimumStockAlert} ${item.unit} | Branch: ${branchName}`,
      targetRoles: ['super_admin', ROLES.BRANCH_ADMIN, ROLES.BRANCH_MANAGER],
      req,
    }).catch((err) => console.error('Error creating low stock notification:', err));
  }
};

// GET /api/inventory/report
exports.getInventoryReport = asyncHandler(async (req, res) => {
  const filter = { isActive: true };
  const userBranchIds = (req.user.branches || []).map(b => (b._id || b).toString());

  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.role !== ROLES.ADMIN) {
    if (req.query.branch && userBranchIds.includes(req.query.branch.toString())) {
      filter.branch = req.query.branch;
    } else {
      filter.branch = { $in: userBranchIds };
    }
  } else if (req.query.branch) {
    filter.branch = req.query.branch;
  }

  const items = await Inventory.find(filter).populate('category').lean();
  const itemIds = items.map(i => i._id);

  // Single aggregation query for all sold quantities
  const salesStats = await StockTransaction.aggregate([
    { $match: { inventoryItem: { $in: itemIds }, type: 'sale' } },
    { $group: { _id: '$inventoryItem', totalSold: { $sum: '$quantity' } } }
  ]);

  const salesMap = new Map(salesStats.map(s => [s._id.toString(), s.totalSold]));

  const itemsWithStats = items.map((item) => {
    const sold = salesMap.get(item._id.toString()) || 0;
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
  });

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

// GET /api/inventory/:id/history
exports.getInventoryHistory = asyncHandler(async (req, res, next) => {
  const { id } = req.params;
  const { fromDate, toDate, type, staff, page = 1, limit = 50 } = req.query;

  const filter = { inventoryItem: id };
  
  if (fromDate || toDate) {
    filter.createdAt = {};
    if (fromDate) filter.createdAt.$gte = new Date(fromDate);
    if (toDate) {
      const end = new Date(toDate);
      end.setHours(23, 59, 59, 999);
      filter.createdAt.$lte = end;
    }
  }
  
  if (type) filter.type = type;
  if (staff) filter.createdBy = staff;

  const skip = (Number(page) - 1) * Number(limit);
  const transactions = await StockTransaction.find(filter)
    .populate('createdBy', 'name')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(Number(limit))
    .lean();

  const total = await StockTransaction.countDocuments(filter);

  // Compute summaries
  const allTxnsForSummary = await StockTransaction.find(filter).sort({ createdAt: 1 }).lean();
  let openingStock = allTxnsForSummary.length > 0 ? allTxnsForSummary[0].previousStock : 0;
  let closingStock = allTxnsForSummary.length > 0 ? allTxnsForSummary[allTxnsForSummary.length - 1].newStock : 0;
  
  let totalIn = 0;
  let totalOut = 0;
  let totalAdjustments = 0;

  allTxnsForSummary.forEach(txn => {
    if (['restock', 'stock_in', 'refund'].includes(txn.type)) {
      totalIn += txn.quantity;
    } else if (['sale', 'stock_out'].includes(txn.type)) {
      totalOut += txn.quantity;
    } else if (txn.type === 'adjustment') {
      const diff = txn.newStock - txn.previousStock;
      totalAdjustments += diff;
    }
  });

  res.status(200).json({
    success: true,
    data: {
      transactions,
      summary: {
        openingStock,
        closingStock,
        totalIn,
        totalOut,
        totalAdjustments
      },
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    }
  });
});

