/**
 * ============================================================
 * models/Vendor.js — Vendor/Supplier Model
 * ============================================================
 * Product supplier / vendor ঊর তথ্য সাভ করে।
 * Product create করার সময় ভেন্ডর অবশ্যই select করতে হয়।
 *
 * গুরুত্বপূর্ণ fields:
 *  - vendorId → auto-generated (VDR-00001 format)
 *  - name → unique vendor name
 *  - phone → contact number
 *  - address → vendor ঊর ঠিকানা
 *  - isActive → false হলে product assign করতে দেখাবে না
 * ============================================================
 */

const mongoose = require("mongoose");
const { generateCustomId } = require("../utils/customIdGenerator");

const vendorSchema = new mongoose.Schema(
  {
    vendorId: {
      type: String,
      unique: true,
    },
    name: {
      type: String,
      required: [true, "Vendor name is required"],
      trim: true,
      unique: true,
    },
    phone: {
      type: String,
      required: [true, "Vendor phone number is required"],
      trim: true,
    },
    address: {
      type: String,
      required: [true, "Vendor address is required"],
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: false,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true },
);

// Generate custom vendorId before saving a new document
vendorSchema.pre("save", async function (next) {
  if (this.isNew) {
    const { generateCustomId } = require("../utils/customIdGenerator");
    this.vendorId = await generateCustomId(
      "VDR",
      mongoose.model("Vendor"),
      "vendorId",
      "Vendor",
    );
  }
  next();
});

module.exports = mongoose.model("Vendor", vendorSchema);
