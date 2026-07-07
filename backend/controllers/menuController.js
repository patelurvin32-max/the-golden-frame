const { MenuItem, MenuCategory } = require('../models/Operations');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { ROLES } = require('../config/constants');

// GET /api/menu
exports.getMenuItems = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 10;
  const skip = (page - 1) * limit;

  const filter = { status: 'Active' };
  
  // Only apply branch filter if explicitly requested (for menu management page)
  // For customer form, we want to show all menu items
  if (req.query.applyBranchFilter === 'true' && req.user.role !== ROLES.SUPER_ADMIN) {
    filter.branch = { $in: req.user.branches };
  }
  if (req.query.branch) filter.branch = req.query.branch;
  if (req.query.category && req.query.category !== 'all') {
    filter.category = req.query.category;
  }
  if (req.query.search) {
    const searchRegex = new RegExp(req.query.search, 'i');
    filter.$or = [
      { name: searchRegex }
    ];
  }

  // Use aggregation to join with category for sorting and filtering
  const pipeline = [
    { $match: filter },
    {
      $lookup: {
        from: 'menucategories',
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
  const countResult = await MenuItem.aggregate(countPipeline);
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
        category: '$categoryInfo',
        price: 1,
        halfPrice: 1,
        fullPrice: 1,
        description: 1,
        imageUrl: 1,
        availability: 1,
        status: 1,
        createdAt: 1,
        updatedAt: 1
      }
    }
  ];

  const items = await MenuItem.aggregate(paginatedPipeline);

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

// GET /api/menu/categories
exports.getMenuCategories = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.activeOnly === 'true') {
    filter.status = 'Active';
  }
  const categories = await MenuCategory.find(filter).sort('name');

  // Compute Total Items for each category
  const categoriesWithCount = await Promise.all(
    categories.map(async (cat) => {
      const totalItems = await MenuItem.countDocuments({ category: cat._id, status: 'Active' });
      return {
        _id: cat._id,
        name: cat.name,
        status: cat.status,
        totalItems,
        createdAt: cat.createdAt,
        updatedAt: cat.updatedAt,
      };
    })
  );

  res.status(200).json({ success: true, count: categoriesWithCount.length, data: { categories: categoriesWithCount } });
});

// POST /api/menu/categories
exports.createMenuCategory = asyncHandler(async (req, res, next) => {
  const { name, status } = req.body;
  if (!name) return next(new AppError('Category name is required.', 400));

  const exists = await MenuCategory.findOne({ name: { $regex: new RegExp(`^${name.trim()}$`, 'i') } });
  if (exists) {
    return next(new AppError('Category with this name already exists.', 400));
  }

  const category = await MenuCategory.create({ name: name.trim(), status: status || 'Active' });
  res.status(201).json({ success: true, data: { category } });
});

// PATCH /api/menu/categories/:id
exports.updateMenuCategory = asyncHandler(async (req, res, next) => {
  const { name, status } = req.body;

  const category = await MenuCategory.findById(req.params.id);
  if (!category) return next(new AppError('Category not found.', 404));

  if (name) {
    const exists = await MenuCategory.findOne({
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

// DELETE /api/menu/categories/:id
exports.deleteMenuCategory = asyncHandler(async (req, res, next) => {
  const categoryId = req.params.id;

  const itemsCount = await MenuItem.countDocuments({ category: categoryId, status: 'Active' });
  if (itemsCount > 0) {
    return next(new AppError('This category contains menu items. Please move or delete them before deleting this category.', 400));
  }

  const category = await MenuCategory.findByIdAndDelete(categoryId);
  if (!category) return next(new AppError('Category not found.', 404));

  res.status(200).json({ success: true, message: 'Category deleted successfully.' });
});

// GET /api/menu/:id
exports.getMenuItem = asyncHandler(async (req, res, next) => {
  const item = await MenuItem.findById(req.params.id).populate('category');
  if (!item) return next(new AppError('Item not found.', 404));
  res.status(200).json({ success: true, data: { item } });
});

// POST /api/menu
exports.createMenuItem = asyncHandler(async (req, res, next) => {
  const { name, category, price, halfPrice, fullPrice, description, availability, status, branch } = req.body;

  // Validate required fields
  if (!name || !name.trim()) return next(new AppError('Item name is required.', 400));
  if (!category) return next(new AppError('Category is required.', 400));
  if (price === undefined || price === null || price === '') return next(new AppError('Price is required.', 400));
  if (isNaN(price) || Number(price) < 0) return next(new AppError('Price must be a valid number.', 400));

  // Check if category is active
  const categoryDoc = await MenuCategory.findById(category);
  if (!categoryDoc) return next(new AppError('Category not found.', 400));
  if (categoryDoc.status !== 'Active') return next(new AppError('Cannot add items to inactive categories.', 400));

  // For Branch Manager and Admin, auto-assign branch from their assigned branches
  let finalBranch = branch;
  if (req.user.role !== ROLES.SUPER_ADMIN && req.user.branches && req.user.branches.length > 0) {
    finalBranch = req.user.branches[0];
  }

  if (!finalBranch) return next(new AppError('Branch is required.', 400));

  const item = await MenuItem.create({
    name: name.trim(),
    category,
    price: Number(price),
    halfPrice: halfPrice ? Number(halfPrice) : undefined,
    fullPrice: fullPrice ? Number(fullPrice) : undefined,
    description: description ? description.trim() : undefined,
    availability: availability || 'Available',
    status: status || 'Active',
    branch: finalBranch
  });

  res.status(201).json({ success: true, data: { item } });
});

// PATCH /api/menu/:id
exports.updateMenuItem = asyncHandler(async (req, res, next) => {
  const { name, category, price, halfPrice, fullPrice, description, availability, status } = req.body;

  const item = await MenuItem.findById(req.params.id);
  if (!item) return next(new AppError('Item not found.', 404));

  // If category is being changed, validate it's active
  if (category && category !== item.category.toString()) {
    const categoryDoc = await MenuCategory.findById(category);
    if (!categoryDoc) return next(new AppError('Category not found.', 400));
    if (categoryDoc.status !== 'Active') return next(new AppError('Cannot assign items to inactive categories.', 400));
  }

  // Validate price if provided
  if (price !== undefined && price !== null && price !== '') {
    if (isNaN(price) || Number(price) < 0) return next(new AppError('Price must be a valid number.', 400));
  }

  // Validate halfPrice if provided
  if (halfPrice !== undefined && halfPrice !== null && halfPrice !== '') {
    if (isNaN(halfPrice) || Number(halfPrice) < 0) return next(new AppError('Half price must be a valid number.', 400));
  }

  // Validate fullPrice if provided
  if (fullPrice !== undefined && fullPrice !== null && fullPrice !== '') {
    if (isNaN(fullPrice) || Number(fullPrice) < 0) return next(new AppError('Full price must be a valid number.', 400));
  }

  const updateData = {};
  if (name) updateData.name = name.trim();
  if (category) updateData.category = category;
  if (price !== undefined && price !== null && price !== '') updateData.price = Number(price);
  if (halfPrice !== undefined && halfPrice !== null && halfPrice !== '') updateData.halfPrice = Number(halfPrice);
  if (fullPrice !== undefined && fullPrice !== null && fullPrice !== '') updateData.fullPrice = Number(fullPrice);
  if (description !== undefined) updateData.description = description.trim();
  if (availability) updateData.availability = availability;
  if (status) updateData.status = status;

  const updatedItem = await MenuItem.findByIdAndUpdate(req.params.id, updateData, { new: true, runValidators: true }).populate('category');
  res.status(200).json({ success: true, data: { item: updatedItem } });
});

// DELETE /api/menu/:id
exports.deleteMenuItem = asyncHandler(async (req, res, next) => {
  const item = await MenuItem.findByIdAndUpdate(req.params.id, { status: 'Inactive' }, { new: true });
  if (!item) return next(new AppError('Item not found.', 404));
  res.status(200).json({ success: true, message: 'Item deleted successfully.' });
});
