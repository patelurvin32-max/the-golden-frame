const Table = require('../models/Table');
const { MenuItem, MenuCategory } = require('../models/Operations');
const { generateTableQRCode } = require('../services/qrCodeService');

/**
 * Synchronize Table collection with active MenuItems under
 * 'PlayStation' and 'Table' categories.
 *
 * PlayStation & Table categories in Menu Management are the
 * single source of truth for Live Tables.
 *
 * Throttled: runs at most once every 60 seconds to avoid
 * blocking every table/session API request.
 */
let _lastSyncTime = 0;
let _syncPromise = null;
const SYNC_THROTTLE_MS = 60_000; // 60 seconds

const syncTablesWithMenuItems = async () => {
  const now = Date.now();
  // Skip if sync ran recently
  if (now - _lastSyncTime < SYNC_THROTTLE_MS) return;
  // Deduplicate concurrent calls — return the same promise
  if (_syncPromise) return _syncPromise;

  _syncPromise = _doSync();
  try {
    await _syncPromise;
  } finally {
    _syncPromise = null;
  }
};

const _doSync = async () => {
  try {
    _lastSyncTime = Date.now();
    // 1. Get active PlayStation and Table categories
    const categories = await MenuCategory.find({
      name: { $in: [/playstation/i, /^table$/i] },
      status: 'Active'
    });

    const categoryIds = categories.map(c => c._id);

    // 2. Get active MenuItems under PlayStation and Table categories
    const activeMenuItems = await MenuItem.find({
      category: { $in: categoryIds },
      status: 'Active'
    }).populate('category');

    const activeTableIds = [];

    // 3. Sync each MenuItem to the Table collection
    for (const item of activeMenuItems) {
      let table = await Table.findOne({ menuItemId: item._id });

      if (!table) {
        table = await Table.findOne({ name: item.name, branch: item.branch });
      }

      const tableType = item.category.name.trim();

      if (!table) {
        table = new Table({
          name: item.name,
          branch: item.branch,
          type: tableType,
          hourlyRate: item.price,
          menuItemId: item._id,
          status: 'available',
          isActive: true
        });
        table.qrCode = await generateTableQRCode(table._id);
        await table.save();
      } else {
        let changed = false;
        if (table.name !== item.name) { table.name = item.name; changed = true; }
        if (table.branch.toString() !== item.branch.toString()) { table.branch = item.branch; changed = true; }
        if (table.type !== tableType) { table.type = tableType; changed = true; }
        if (table.hourlyRate !== item.price) { table.hourlyRate = item.price; changed = true; }
        if (!table.menuItemId || table.menuItemId.toString() !== item._id.toString()) { table.menuItemId = item._id; changed = true; }
        if (!table.isActive) { table.isActive = true; changed = true; }
        if (changed) {
          await table.save();
        }
      }
      activeTableIds.push(table._id.toString());
    }

    // 4. Soft-delete tables no longer in PlayStation or Table categories
    await Table.updateMany(
      {
        _id: { $nin: activeTableIds },
        isActive: true
      },
      { isActive: false }
    );

    console.log(`[TableSync] Synced ${activeMenuItems.length} tables from PlayStation and Table categories.`);
  } catch (err) {
    console.error('[TableSync] Error syncing tables with menu items:', err);
  }
};

module.exports = {
  syncTablesWithMenuItems
};
