const { ActivityLog } = require('../models/System');

/**
 * Fire-and-forget audit log writer. Failures here must never break the
 * primary request, so errors are caught and logged rather than thrown.
 */
const logActivity = async ({ userId, branchId, action, entity, entityId, description, ipAddress, meta }) => {
  try {
    await ActivityLog.create({
      user: userId,
      branch: branchId,
      action,
      entity,
      entityId,
      description,
      ipAddress,
      meta,
    });
  } catch (err) {
    console.error('Failed to write activity log:', err.message);
  }
};

module.exports = { logActivity };
