/**
 * ============================================================
 * utils/seedRoles.js — Auto-Seed Default Roles & Permissions
 * ============================================================
 * সার্ভার চালু হলে বা রোলস এপিআই কল হলে স্বয়ংক্রিয়ভাবে
 * admin, manager, employee, salesman রোল তৈরি ও সিঙ্ক করে।
 * ============================================================
 */

const Role = require("../models/Role");
const User = require("../models/User");
const { PERMISSIONS_CATALOG, ALL_PERMISSION_KEYS } = require("../config/permissions");

const seedRoles = async () => {
  try {
    const rolesConfig = [
      {
        name: "Super Admin",
        slug: "admin",
        description: "Full system administrative access to all features.",
        isSystemRole: true,
        permissions: ALL_PERMISSION_KEYS,
      },
      {
        name: "Store Manager",
        slug: "manager",
        description: "Manages shop counter sales, orders, stock, and staff.",
        isSystemRole: true,
        permissions: PERMISSIONS_CATALOG.flatMap((m) =>
          m.permissions
            .filter((p) => p.defaultRoles.includes("manager"))
            .map((p) => p.key)
        ),
      },
      {
        name: "General Employee",
        slug: "employee",
        description: "Manages products, catalog, online orders, and customer support.",
        isSystemRole: true,
        permissions: PERMISSIONS_CATALOG.flatMap((m) =>
          m.permissions
            .filter((p) => p.defaultRoles.includes("employee"))
            .map((p) => p.key)
        ),
      },
      {
        name: "Salesman",
        slug: "salesman",
        description: "POS counter selling, billing, and own sales history.",
        isSystemRole: true,
        permissions: PERMISSIONS_CATALOG.flatMap((m) =>
          m.permissions
            .filter((p) => p.defaultRoles.includes("salesman"))
            .map((p) => p.key)
        ),
      },
    ];

    const SYSTEM_SLUGS = ["admin", "manager", "employee", "salesman"];

    for (const r of rolesConfig) {
      const existing = await Role.findOne({ slug: r.slug });
      if (!existing) {
        await Role.create(r);
        console.log(`[RBAC] Seeded default role: ${r.name} (${r.slug})`);
      } else {
        let changed = false;
        if (SYSTEM_SLUGS.includes(r.slug) && !existing.isSystemRole) {
          existing.isSystemRole = true;
          changed = true;
        }
        // Always ensure admin has all permissions
        if (r.slug === "admin") {
          existing.permissions = ALL_PERMISSION_KEYS;
          existing.isSystemRole = true;
          changed = true;
        } else {
          // Remove any legacy non-catalog permissions (ghost permissions)
          const validPerms = (existing.permissions || []).filter((p) =>
            ALL_PERMISSION_KEYS.includes(p)
          );
          if (validPerms.length !== (existing.permissions || []).length) {
            existing.permissions = validPerms;
            changed = true;
          }
          if (r.slug === "manager" && existing.permissions.includes("daily_overview.view")) {
            existing.permissions = existing.permissions.filter((p) => p !== "daily_overview.view");
            changed = true;
          }
        }
        if (changed) {
          existing.markModified("permissions");
          await existing.save();
        }
      }
    }

    // Sanitize user-specific direct permissions against ALL_PERMISSION_KEYS
    const allUsers = await User.find({});
    for (const u of allUsers) {
      if (Array.isArray(u.permissions) && u.permissions.length > 0) {
        const validUserPerms = u.permissions.filter((p) =>
          ALL_PERMISSION_KEYS.includes(p)
        );
        if (validUserPerms.length !== u.permissions.length) {
          u.permissions = validUserPerms;
          u.markModified("permissions");
          await u.save();
          console.log(`[RBAC] Cleaned ghost permissions from user: ${u.email}`);
        }
      }
    }
  } catch (error) {
    console.error("[RBAC] Error seeding roles:", error.message);
  }
};

module.exports = seedRoles;
