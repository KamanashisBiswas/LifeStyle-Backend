/**
 * ============================================================
 * routes/role.js — Roles & Permissions Routes
 * ============================================================
 */

const express = require("express");
const router = express.Router();
const roleController = require("../controllers/roleController");
const { authenticate, authorize } = require("../middleware/auth");

// Public/User endpoint for fetching own permissions
router.get("/my-permissions", authenticate, roleController.getMyPermissions);

// Admin or roles.manage endpoints
router.get("/catalog", authenticate, authorize("admin", "roles.manage"), roleController.getPermissionsCatalog);
router.get("/", authenticate, authorize("admin", "roles.manage"), roleController.getAllRoles);
router.post("/", authenticate, authorize("admin", "roles.manage"), roleController.createRole);
router.put("/:id", authenticate, authorize("admin", "roles.manage"), roleController.updateRole);
router.delete("/:id", authenticate, authorize("admin", "roles.manage"), roleController.deleteRole);

// Feature-centric dropdown update endpoint
router.post(
  "/update-permission-roles",
  authenticate,
  authorize("admin", "roles.manage"),
  roleController.updatePermissionRoles
);

// User-centric permission update endpoint
router.post(
  "/update-user-permission",
  authenticate,
  authorize("admin", "roles.manage"),
  roleController.updateUserPermission
);

module.exports = router;
