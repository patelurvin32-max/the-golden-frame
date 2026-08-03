const User = require('../models/User');
const Branch = require('../models/Branch');
const { Notification } = require('../models/System');
const { ROLES } = require('../config/constants');

const createBranchNotification = async ({
  branchId,
  actor,
  title,
  message,
  superAdminOnly = false,
  targetRoles = null,
  targetUser = null,
  req = null,
  io = null,
}) => {
  // Resolve branch name if branchId is provided
  let branchName = 'Unknown Branch';
  if (branchId) {
    try {
      const branchDoc = await Branch.findById(branchId).lean();
      if (branchDoc) {
        branchName = branchDoc.name;
      }
    } catch (e) {
      branchName = 'Unknown Branch';
    }
  }

  // Sanitize any raw 24-character hexadecimal ObjectIds in message text
  let cleanedMessage = message || '';
  if (branchId && cleanedMessage.includes(branchId.toString())) {
    cleanedMessage = cleanedMessage.replace(new RegExp(branchId.toString(), 'g'), branchName);
  }
  cleanedMessage = cleanedMessage.replace(/in branch [0-9a-fA-F]{24}/gi, `in ${branchName} branch`);
  cleanedMessage = cleanedMessage.replace(/[0-9a-fA-F]{24}/gi, branchName);

  const notification = {
    branch: branchId,
    type: 'general',
    title,
    message: cleanedMessage,
    targetRoles: targetRoles || (superAdminOnly ? ['super_admin'] : ['super_admin', ROLES.BRANCH_ADMIN, ROLES.BRANCH_MANAGER, ROLES.STAFF]),
    meta: {
      actorId: actor?._id?.toString(),
      actorName: actor?.name || 'User',
      actorRole: actor?.role,
      branchName,
    },
  };

  if (targetUser) {
    notification.targetUser = targetUser;
  }

  const createdNotif = await Notification.create(notification);

  const populatedNotif = {
    ...createdNotif.toObject(),
    branchName,
    actorName: actor?.name || 'User',
    branch: branchId ? { _id: branchId, name: branchName } : null,
  };

  // Real-time Socket.IO emission
  try {
    const socketIo = io || (req && req.app && req.app.get('io'));
    if (socketIo) {
      socketIo.emit('notification:new', populatedNotif);
      if (branchId) {
        socketIo.to(`branch:${branchId.toString()}`).emit('notification:new', populatedNotif);
      }
    }
  } catch (err) {
    console.error('[NotificationService] Socket emission error:', err.message);
  }

  return createdNotif;
};

module.exports = {
  createBranchNotification,
};
