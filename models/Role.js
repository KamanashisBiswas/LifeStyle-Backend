/**
 * ============================================================
 * models/Role.js — Dynamic Role & Permissions Model
 * ============================================================
 * এই মডেল সিস্টেমে বিভিন্ন ভূমিকা (Role) যেমন: Manager, Salesman,
 * Employee, Accountant এবং তাদের অনুমোদিত permissions তালিকা সংরক্ষণ করে।
 * ============================================================
 */

const mongoose = require("mongoose");

const roleSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Role name is required"],
      trim: true,
    },
    slug: {
      type: String,
      required: [true, "Role slug is required"],
      unique: true,
      lowercase: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
    },
    isSystemRole: {
      type: Boolean,
      default: false, // "admin" রোল ডিলিট বা ব্লক করা যাবে না
    },
    permissions: [
      {
        type: String,
        trim: true,
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Role", roleSchema);
