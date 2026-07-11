const User = require('../models/User');
const { Notification } = require('../models/System');
const { ROLES } = require('../config/constants');

const createBranchNotification = async ({ branchId, actor, title, message, superAdminOnly = false, targetRoles = null, targetUser = null }) => {
  const notification = {
    branch: branchId,
    type: 'general',
    title,
    message,
    targetRoles: targetRoles || (superAdminOnly ? ['super_admin'] : ['super_admin', ROLES.BRANCH_MANAGER, ROLES.STAFF]),
    meta: {
      actorId: actor._id?.toString(),
      actorRole: actor.role,
    },
  };

  if (targetUser) {
    notification.targetUser = targetUser;
  }

  return Notification.create(notification);
};

module.exports = {
  createBranchNotification,
};
