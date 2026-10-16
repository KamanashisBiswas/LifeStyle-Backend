/**
 * ============================================================
 * middleware/permission.js — Dynamic RBAC Permission Middleware
 * ============================================================
 */

const { getPermissionsForRole } = require("../controllers/roleController");

const checkPermission = (requiredPermission) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: "Access denied. Authentication required.",
        });
      }

      // 1. Super admin always has full bypass
      if (req.user.role === "admin") {
        return next();
      }

      // 2. Lookup role permissions (cached in memory)
      const permissions = await getPermissionsForRole(req.user.role);

      if (!permissions.includes(requiredPermission)) {
        return res.status(403).json({
          success: false,
          message: `Access denied. You do not have permission (${requiredPermission}) to perform this action.`,
        });
      }

      next();
    } catch (error) {
      console.error("[Permission Middleware Error]:", error);
      return res.status(500).json({
        success: false,
        message: "Error verifying permissions",
      });
    }
  };
};

module.exports = {
  checkPermission,
};
