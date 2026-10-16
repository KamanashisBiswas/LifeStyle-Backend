const ActivityLog = require("../models/ActivityLog");

/**
 * Log employee / user activity safely without blocking main transaction
 *
 * @param {Object} options
 * @param {Object} options.req Express request object (optional if user provided)
 * @param {Object} options.user Explicit user object (optional if req.user present)
 * @param {String} options.action Action identifier (e.g. 'CREATE_PRODUCT', 'POS_SALE')
 * @param {String} options.entityType Resource type (e.g. 'Product', 'Order', 'Sale')
 * @param {String} options.entityId Target item ID or code
 * @param {String} options.description Human-readable summary of activity
 * @param {Object} options.metadata Extra payload parameters (optional)
 */
/**
 * Compute field-by-field diff between old and new objects
 */
const computeDiff = (oldObj, newObj) => {
  if (!oldObj || !newObj || typeof oldObj !== "object" || typeof newObj !== "object") {
    return null;
  }

  const diff = {};
  const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);

  for (const key of allKeys) {
    if (["_id", "__v", "createdAt", "updatedAt", "password", "tokens"].includes(key)) continue;
    const oldVal = oldObj[key];
    const newVal = newObj[key];

    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      diff[key] = {
        old: oldVal !== undefined ? oldVal : null,
        new: newVal !== undefined ? newVal : null,
      };
    }
  }

  return Object.keys(diff).length > 0 ? diff : null;
};

/**
 * Log employee / user activity safely without blocking main transaction
 *
 * @param {Object} options
 * @param {Object} options.req Express request object (optional if user provided)
 * @param {Object} options.user Explicit user object (optional if req.user present)
 * @param {String} options.action Action identifier (e.g. 'CREATE_PRODUCT', 'POS_SALE')
 * @param {String} options.entityType Resource type (e.g. 'Product', 'Order', 'Sale')
 * @param {String} options.entityId Target item ID or code
 * @param {String} options.description Human-readable summary of activity
 * @param {Object} options.oldValues State before action/edit
 * @param {Object} options.newValues State after action/edit
 * @param {Object} options.changes Explicit diff object
 * @param {Object} options.metadata Extra payload parameters (optional)
 */
const logActivity = async ({
  req,
  user,
  action,
  entityType = "System",
  entityId = "",
  description,
  oldValues = null,
  newValues = null,
  changes = null,
  metadata = {},
}) => {
  try {
    const activeUser = user || req?.user;
    const userId = activeUser?._id || activeUser?.id;

    if (!activeUser || !userId) {
      return; // Do not log if user is unknown or unauthenticated
    }

    // Record activity logs for employee and staff roles
    if (!["employee", "salesman", "admin", "manager"].includes(activeUser.role)) {
      return;
    }

    const ipAddress =
      req?.headers?.["x-forwarded-for"]?.split(",")?.[0] ||
      req?.socket?.remoteAddress ||
      req?.ip ||
      "";

    const diff = changes || (oldValues && newValues ? computeDiff(oldValues, newValues) : null);

    await ActivityLog.create({
      user: userId,
      userName: activeUser.name || "Unknown User",
      userEmail: activeUser.email || "unknown@example.com",
      userRole: activeUser.role || "employee",
      action: action || "UNKNOWN_ACTION",
      entityType: entityType,
      entityId: String(entityId || ""),
      description: description || `Performed ${action} on ${entityType}`,
      oldValues: oldValues,
      newValues: newValues,
      changes: diff,
      metadata: metadata,
      ipAddress: ipAddress,
    });
  } catch (err) {
    // Log error internally to console without crashing caller
    console.error("Failed to record activity log:", err.message);
  }
};

module.exports = { logActivity };
