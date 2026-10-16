/**
 * ============================================================
 * models/InventoryAudit.js — Inventory Physical Audit Model
 * ============================================================
 * দোকানে থাকা ফিজিক্যাল প্রোডাক্ট স্ক্যান করে সিস্টেম স্টকের সাথে
 * তুলনা ও অডিট হিস্ট্রি সংরক্ষণ করার মডেল।
 *
 * দ্রষ্টব্য: এটি শুধুমাত্র অডিট রিপোর্ট ও হিস্ট্রি সংরক্ষণ করে,
 * পণ্যের মূল লাইভ স্টক কোনোভাবেই পরিবর্তন করে না।
 * ============================================================
 */

const mongoose = require("mongoose");
const { generateCustomId } = require("../utils/customIdGenerator");

const auditItemSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: false,
    },
    customId: { type: String, default: "" },
    productName: { type: String, required: true },
    variationId: { type: mongoose.Schema.Types.ObjectId, required: false },
    sku: { type: String, default: "" },
    size: { type: String, default: "" },
    color: { type: String, default: "" },
    image: { type: String, default: "" },
    systemStock: { type: Number, default: 0 },
    scannedCount: { type: Number, default: 0 },
    discrepancy: { type: Number, default: 0 }, // scannedCount - systemStock (<0 means missing, >0 means extra)
    status: {
      type: String,
      enum: ["matched", "missing", "extra"],
      default: "matched",
    },
  },
  { _id: true }
);

const inventoryAuditSchema = new mongoose.Schema(
  {
    auditId: {
      type: String,
      unique: true,
    },
    auditedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    auditorName: {
      type: String,
      required: true,
    },
    auditorRole: {
      type: String,
      default: "staff",
    },
    note: {
      type: String,
      default: "",
    },
    totalSystemStock: {
      type: Number,
      default: 0,
    },
    totalScannedCount: {
      type: Number,
      default: 0,
    },
    totalMissingCount: {
      type: Number,
      default: 0, // Sum of all missing units
    },
    totalExtraCount: {
      type: Number,
      default: 0, // Sum of all extra units
    },
    totalMatchedItems: {
      type: Number,
      default: 0,
    },
    totalStoreStock: {
      type: Number,
      default: 0, // Total product stock across the whole database at snapshot time
    },
    items: [auditItemSchema],
  },
  { timestamps: true }
);

// Pre-save hook to generate sequential auditId (e.g. AUD-00001)
inventoryAuditSchema.pre("save", async function (next) {
  if (this.isNew && !this.auditId) {
    try {
      this.auditId = await generateCustomId(
        "AUD",
        this.constructor,
        "auditId",
        "InventoryAudit"
      );
    } catch (err) {
      // Fallback timestamp ID in case of generator failure
      this.auditId = `AUD-${Date.now().toString().slice(-6)}`;
    }
  }
  next();
});

module.exports = mongoose.model("InventoryAudit", inventoryAuditSchema);
