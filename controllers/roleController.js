/**
 * ============================================================
 * controllers/roleController.js — Roles & Permissions Controller
 * ============================================================
 */

const Role = require("../models/Role");
const User = require("../models/User");
const { PERMISSIONS_CATALOG, ALL_PERMISSION_KEYS } = require("../config/permissions");
const seedRoles = require("../utils/seedRoles");

// In-memory cache for fast lookup
let roleCache = new Map();
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 60 * 1000; // 1 minute TTL

const refreshRoleCache = async () => {
  try {
    const roles = await Role.find({});
    const newCache = new Map();
    roles.forEach((r) => {
      newCache.set(r.slug, r.permissions || []);
    });
    roleCache = newCache;
    cacheLoadedAt = Date.now();
  } catch (err) {
    console.error("[RBAC Cache] Error refreshing cache:", err.message);
  }
};

/**
 * @desc Get user permissions array by role slug
 */
const getPermissionsForRole = async (roleSlug) => {
  if (roleSlug === "admin") return ALL_PERMISSION_KEYS;

  if (roleCache.size === 0 || Date.now() - cacheLoadedAt > CACHE_TTL_MS) {
    await refreshRoleCache();
  }

  return roleCache.get(roleSlug) || [];
};

/**
 * @desc Get effective permissions for a user (Role permissions + User-specific permissions)
 */
const getEffectivePermissionsForUser = async (user) => {
  if (!user) return [];
  if (user.role === "admin") return ALL_PERMISSION_KEYS;

  const rolePerms = await getPermissionsForRole(user.role);
  const userPerms = Array.isArray(user.permissions) ? user.permissions : [];

  return Array.from(new Set([...rolePerms, ...userPerms]));
};

/**
 * @desc    Get master permissions catalog, all roles & active staff users
 * @route   GET /api/admin/roles/catalog
 * @access  Private (Admin)
 */
exports.getPermissionsCatalog = async (req, res) => {
  try {
    // Ensure default roles are seeded
    await seedRoles();
    const roles = await Role.find({}).sort({ isSystemRole: -1, createdAt: 1 });
    const users = await User.find({}, "_id name email role permissions avatar phone")
      .sort({ name: 1 })
      .lean();

    const {
      search,
      q,
      module,
      role,
      userId,
      user,
      actionType,
    } = req.query;

    const searchTerm = (search || q || "").trim().toLowerCase();
    const selectedModule = (module || "all").trim();
    const selectedRole = (role || "all").trim();
    const selectedUserId = (userId || user || "all").trim();
    const selectedActionType = (actionType || "all").trim().toLowerCase();

    // Find selected staff user if userId is provided
    let filterUser = null;
    if (selectedUserId && selectedUserId !== "all") {
      filterUser = users.find((u) => u._id.toString() === selectedUserId);
    }

    // Role helper: checks role document permissions OR any staff user with that role having the permission
    const hasRolePerm = (roleSlug, permKey) => {
      if (roleSlug === "admin") return true;
      const targetRole = roles.find((r) => r.slug === roleSlug);
      if (targetRole?.permissions?.includes(permKey)) return true;
      return users.some(
        (u) =>
          u.role === roleSlug &&
          Array.isArray(u.permissions) &&
          u.permissions.includes(permKey)
      );
    };

    // User helper
    const hasUserPerm = (userDoc, permKey) => {
      if (!userDoc) return false;
      if (userDoc.role === "admin") return true;
      if (Array.isArray(userDoc.permissions) && userDoc.permissions.includes(permKey)) return true;
      return hasRolePerm(userDoc.role, permKey);
    };

    let filteredCount = 0;
    const totalCount = ALL_PERMISSION_KEYS.length;

    // Filter catalog based on backend query params
    const filteredCatalog = PERMISSIONS_CATALOG.map((mod) => {
      // 1. Module filter
      if (selectedModule !== "all" && mod.moduleKey !== selectedModule) {
        return null;
      }

      // 2. Filter permissions inside module
      const permissions = (mod.permissions || []).filter((perm) => {
        // A. Search query text filter
        if (searchTerm) {
          const match =
            perm.name.toLowerCase().includes(searchTerm) ||
            perm.key.toLowerCase().includes(searchTerm) ||
            (perm.description && perm.description.toLowerCase().includes(searchTerm)) ||
            mod.module.toLowerCase().includes(searchTerm);
          if (!match) return false;
        }

        // B. Role filter
        if (selectedRole !== "all") {
          if (!hasRolePerm(selectedRole, perm.key)) return false;
        }

        // C. User filter
        if (filterUser) {
          if (!hasUserPerm(filterUser, perm.key)) return false;
        }

        // D. Action Type filter
        if (selectedActionType !== "all") {
          const isView =
            perm.key.endsWith(".view") ||
            perm.key.includes("all_view") ||
            perm.key.includes("shop_view");
          const isCreate =
            perm.key.endsWith(".create") || perm.key.includes(".add");
          const isEdit =
            perm.key.endsWith(".edit") ||
            perm.key.endsWith(".update") ||
            perm.key.includes(".update_status");
          const isDelete =
            perm.key.endsWith(".delete") || perm.key.includes(".destroy");
          const isPos = perm.key.startsWith("pos.");

          if (selectedActionType === "view" && !isView) return false;
          if (selectedActionType === "create" && !isCreate) return false;
          if (selectedActionType === "edit" && !isEdit) return false;
          if (selectedActionType === "delete" && !isDelete) return false;
          if (selectedActionType === "pos" && !isPos) return false;
          if (
            (selectedActionType === "special" || selectedActionType === "other") &&
            (isView || isCreate || isEdit || isDelete || isPos)
          ) {
            return false;
          }
        }

        return true;
      });

      // If no permissions match in this module, omit the module from filtered results
      if (permissions.length === 0) {
        return null;
      }

      filteredCount += permissions.length;
      return {
        ...mod,
        permissions,
      };
    }).filter(Boolean);

    res.status(200).json({
      success: true,
      data: {
        catalog: filteredCatalog,
        masterCatalog: PERMISSIONS_CATALOG,
        allKeys: ALL_PERMISSION_KEYS,
        roles,
        users: users.map((u) => ({
          ...u,
          permissions: Array.isArray(u.permissions) ? u.permissions : [],
        })),
        stats: {
          totalFeatures: totalCount,
          filteredFeatures: filteredCount,
        },
        filters: {
          search: searchTerm,
          module: selectedModule,
          role: selectedRole,
          userId: selectedUserId,
          actionType: selectedActionType,
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch permissions catalog",
      error: error.message,
    });
  }
};

/**
 * @desc    Get all roles with permissions
 * @route   GET /api/admin/roles
 * @access  Private (Admin)
 */
exports.getAllRoles = async (req, res) => {
  try {
    await seedRoles();
    const roles = await Role.find({}).sort({ isSystemRole: -1, createdAt: 1 });

    res.status(200).json({
      success: true,
      data: roles,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch roles",
      error: error.message,
    });
  }
};

/**
 * @desc    Create a new custom role
 * @route   POST /api/admin/roles
 * @access  Private (Admin)
 */
exports.createRole = async (req, res) => {
  try {
    const { name, slug, description, permissions } = req.body;

    if (!name || !slug) {
      return res.status(400).json({
        success: false,
        message: "Role name and slug are required",
      });
    }

    const cleanSlug = slug.trim().toLowerCase().replace(/\s+/g, "_");

    const existing = await Role.findOne({ slug: cleanSlug });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: "A role with this slug already exists",
      });
    }

    const newRole = await Role.create({
      name: name.trim(),
      slug: cleanSlug,
      description: description || "",
      isSystemRole: false,
      permissions: Array.isArray(permissions) ? permissions : [],
    });

    await refreshRoleCache();

    res.status(201).json({
      success: true,
      message: "Role created successfully",
      data: newRole,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to create role",
      error: error.message,
    });
  }
};

/**
 * @desc    Update role (Role-centric matrix save)
 * @route   PUT /api/admin/roles/:id
 * @access  Private (Admin)
 */
exports.updateRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, permissions } = req.body;

    const role = await Role.findById(id);
    if (!role) {
      return res.status(404).json({
        success: false,
        message: "Role not found",
      });
    }

    if (name) role.name = name.trim();
    if (description !== undefined) role.description = description;

    // Super admin role always retains all permissions and system role status
    const SYSTEM_ROLE_SLUGS = ["admin", "manager", "employee", "salesman"];
    if (role.slug === "admin") {
      role.permissions = ALL_PERMISSION_KEYS;
      role.isSystemRole = true;
    } else if (SYSTEM_ROLE_SLUGS.includes(role.slug)) {
      role.isSystemRole = true;
      if (Array.isArray(permissions)) {
        role.permissions = permissions;
      }
    } else if (Array.isArray(permissions)) {
      role.permissions = permissions;
    }

    await role.save();
    await refreshRoleCache();

    res.status(200).json({
      success: true,
      message: `Role '${role.name}' updated successfully`,
      data: role,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to update role",
      error: error.message,
    });
  }
};

/**
 * @desc    Update roles for a specific permission (Feature-centric dropdown save)
 * @route   POST /api/admin/roles/update-permission-roles
 * @access  Private (Admin)
 */
exports.updatePermissionRoles = async (req, res) => {
  try {
    const { permissionKey, roleSlugs } = req.body;

    if (!permissionKey || !Array.isArray(roleSlugs)) {
      return res.status(400).json({
        success: false,
        message: "permissionKey and roleSlugs array are required",
      });
    }

    const roles = await Role.find({});

    const baseKey = permissionKey.split(".")[0];
    const parentManageKey = `${baseKey}.manage`;

    for (const r of roles) {
      // Super admin always retains everything
      if (r.slug === "admin") continue;

      let perms = Array.isArray(r.permissions) ? [...r.permissions] : [];
      const hasPerm = perms.includes(permissionKey);
      const hasManage = perms.includes(parentManageKey);
      const shouldHavePerm = roleSlugs.includes(r.slug);
      let changed = false;

      if (shouldHavePerm && !hasPerm) {
        perms.push(permissionKey);
        changed = true;
      } else if (!shouldHavePerm && (hasPerm || hasManage)) {
        perms = perms.filter((p) => p !== permissionKey && p !== parentManageKey);
        // If the role previously had parent .manage, preserve other sibling permissions
        if (hasManage) {
          const siblingPerms = ALL_PERMISSION_KEYS.filter(
            (k) => k.startsWith(`${baseKey}.`) && k !== parentManageKey && k !== permissionKey
          );
          for (const sib of siblingPerms) {
            if (!perms.includes(sib)) {
              perms.push(sib);
            }
          }
        }
        changed = true;
      }

      if (changed) {
        r.permissions = perms;
        r.markModified("permissions");
        await r.save();
      }
    }

    await refreshRoleCache();

    const updatedRoles = await Role.find({});
    res.status(200).json({
      success: true,
      message: `Access updated for permission '${permissionKey}'`,
      data: updatedRoles,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to update permission roles",
      error: error.message,
    });
  }
};

/**
 * @desc    Delete custom role
 * @route   DELETE /api/admin/roles/:id
 * @access  Private (Admin)
 */
exports.deleteRole = async (req, res) => {
  try {
    const { id } = req.params;
    const role = await Role.findById(id);

    if (!role) {
      return res.status(404).json({
        success: false,
        message: "Role not found",
      });
    }

    const SYSTEM_ROLE_SLUGS = ["admin", "manager", "employee", "salesman"];
    if (role.isSystemRole || SYSTEM_ROLE_SLUGS.includes(role.slug)) {
      return res.status(400).json({
        success: false,
        message: `System role '${role.name}' (${role.slug}) cannot be deleted.`,
      });
    }

    // Check if any users are assigned to this role
    const usersCount = await User.countDocuments({ role: role.slug });
    if (usersCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete role. There are ${usersCount} users assigned to this role. Reassign them first.`,
      });
    }

    await Role.findByIdAndDelete(id);
    await refreshRoleCache();

    res.status(200).json({
      success: true,
      message: "Role deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to delete role",
      error: error.message,
    });
  }
};

/**
 * @desc    Get current user permissions
 * @route   GET /api/user/my-permissions
 * @access  Private
 */
exports.getMyPermissions = async (req, res) => {
  try {
    const roleSlug = req.user?.role || "user";
    const userDoc = req.user?.id ? await User.findById(req.user.id).select("permissions role") : null;
    const permissions = userDoc ? await getEffectivePermissionsForUser(userDoc) : await getPermissionsForRole(roleSlug);

    res.status(200).json({
      success: true,
      data: {
        role: roleSlug,
        permissions,
        isAdmin: roleSlug === "admin",
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch user permissions",
      error: error.message,
    });
  }
};

/**
 * @desc    Toggle or sync user permissions for a specific permission key
 * @route   POST /api/admin/roles/update-user-permission
 * @access  Private (Admin)
 */
exports.updateUserPermission = async (req, res) => {
  try {
    const { permissionKey, permissionKeys, userId, userIds, action } = req.body;

    // Mode C: Multiple keys for a single user (e.g. Module-level toggle)
    if (userId && Array.isArray(permissionKeys) && permissionKeys.length > 0) {
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
      }
      if (user.role === "admin") {
        return res.status(400).json({ success: false, message: "Super Admin permissions are permanently locked." });
      }

      let perms = Array.isArray(user.permissions) ? [...user.permissions] : [];
      if (action === "grant") {
        for (const pk of permissionKeys) {
          if (!perms.includes(pk)) perms.push(pk);
        }
      } else if (action === "revoke") {
        perms = perms.filter((p) => !permissionKeys.includes(p));
      }

      user.permissions = perms;
      user.markModified("permissions");
      await user.save();

      const allUsers = await User.find({}, "_id name email role permissions avatar phone")
        .sort({ name: 1 })
        .lean();

      return res.status(200).json({
        success: true,
        message: `Permissions updated for ${user.name}`,
        data: {
          user: {
            ...user.toObject(),
            permissions: perms,
          },
          users: allUsers,
        },
      });
    }

    if (!permissionKey) {
      return res.status(400).json({
        success: false,
        message: "permissionKey is required",
      });
    }

    // Mode A: Single user toggle or action
    if (userId) {
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
      }

      if (user.role === "admin") {
        return res.status(400).json({
          success: false,
          message: "Super Admin permissions are permanently locked.",
        });
      }

      const baseKey = permissionKey.split(".")[0];
      const parentManageKey = `${baseKey}.manage`;
      let perms = Array.isArray(user.permissions) ? [...user.permissions] : [];
      const hasDirect = perms.includes(permissionKey);
      const hasManage = perms.includes(parentManageKey);
      const hasPerm = hasDirect || hasManage;

      let nextHasPerm;
      if (action === "grant") {
        nextHasPerm = true;
      } else if (action === "revoke") {
        nextHasPerm = false;
      } else {
        // Toggle
        nextHasPerm = !hasPerm;
      }

      if (nextHasPerm) {
        if (!perms.includes(permissionKey)) {
          perms.push(permissionKey);
        }
      } else {
        // Revoke this specific permission and any parent .manage permission
        perms = perms.filter((p) => p !== permissionKey && p !== parentManageKey);

        // If user previously had parent .manage, preserve sibling permissions
        if (hasManage) {
          const siblingPerms = ALL_PERMISSION_KEYS.filter(
            (k) => k.startsWith(`${baseKey}.`) && k !== parentManageKey && k !== permissionKey
          );
          for (const sib of siblingPerms) {
            if (!perms.includes(sib)) {
              perms.push(sib);
            }
          }
        }
      }

      user.permissions = perms;
      user.markModified("permissions");
      await user.save();

      const allUsers = await User.find({}, "_id name email role permissions avatar phone")
        .sort({ name: 1 })
        .lean();

      return res.status(200).json({
        success: true,
        message: nextHasPerm
          ? `Access for '${permissionKey}' granted to ${user.name}`
          : `Access for '${permissionKey}' revoked from ${user.name}`,
        data: {
          user: {
            _id: user._id,
            name: user.name,
            permissions: user.permissions,
          },
          users: allUsers,
        },
      });
    }

    // Mode B: Bulk sync userIds array for a permissionKey
    if (Array.isArray(userIds)) {
      const users = await User.find({});
      for (const u of users) {
        if (u.role === "admin") continue;

        const uIdStr = u._id.toString();
        const shouldHave = userIds.includes(uIdStr);
        const baseKey = permissionKey.split(".")[0];
        const parentManageKey = `${baseKey}.manage`;
        let perms = Array.isArray(u.permissions) ? [...u.permissions] : [];
        const has = perms.includes(permissionKey) || perms.includes(parentManageKey);

        if (shouldHave && !has) {
          perms.push(permissionKey);
          u.permissions = perms;
          u.markModified("permissions");
          await u.save();
        } else if (!shouldHave && has) {
          perms = perms.filter((p) => p !== permissionKey && p !== parentManageKey);
          u.permissions = perms;
          u.markModified("permissions");
          await u.save();
        }
      }

      const allUsers = await User.find({}, "_id name email role permissions avatar phone")
        .sort({ name: 1 })
        .lean();

      return res.status(200).json({
        success: true,
        message: `Updated users for permission '${permissionKey}'`,
        data: {
          users: allUsers,
        },
      });
    }

    return res.status(400).json({
      success: false,
      message: "Please provide either userId or userIds array",
    });
  } catch (error) {
    console.error("Error in updateUserPermission:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update user permission",
      error: error.message,
    });
  }
};

module.exports.getPermissionsForRole = getPermissionsForRole;
module.exports.getEffectivePermissionsForUser = getEffectivePermissionsForUser;
