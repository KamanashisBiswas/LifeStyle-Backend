/**
 * ============================================================
 * models/StockMovement.js — Immutable Inventory Movement Audit Log
 * ============================================================
 * Every stock-changing operation creates a StockMovement record.
 * This record is strictly IMMUTABLE (cannot be edited or deleted).
 * ============================================================
 */

const mongoose = require("mongoose");
const Counter = require("./Counter");
const crypto = require("crypto");

const stockMovementSchema = new mongoose.Schema(
  {
    movementId: {
      type: String,
      unique: true,
      index: true,
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },
    productName: {
      type: String,
      required: true,
    },
    variationId: {
      type: mongoose.Schema.Types.ObjectId,
      required: false,
      index: true,
    },
    sku: {
      type: String,
      default: "",
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    fromLocation: {
      type: String,
      enum: [
        "display",
        "shopStock",
        "warehouse",
        "supplier",
        "customer",
        "loss",
        "adjustment",
      ],
      required: true,
    },
    toLocation: {
      type: String,
      enum: [
        "display",
        "shopStock",
        "warehouse",
        "customer",
        "damaged",
        "expired",
        "lost",
        "broken",
        "sample",
        "correction",
        "supplier",
      ],
      required: true,
    },
    transactionType: {
      type: String,
      enum: [
        "shop_sale",
        "online_sale",
        "shop_return",
        "online_return",
        "shop_exchange_return",
        "shop_exchange_issue",
        "online_exchange_return",
        "online_exchange_issue",
        "online_cancel_restore",
        "manual_transfer",
        "stock_adjustment",
        "stock_purchase",
        "vendor_return",
      ],
      required: true,
      index: true,
    },
    referenceId: {
      type: String,
      default: "",
    },
    orderId: {
      type: String,
      default: "",
      index: true,
    },
    exchangeId: {
      type: String,
      default: "",
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    userName: {
      type: String,
      default: "System",
    },
    reason: {
      type: String,
      required: true,
    },
    note: {
      type: String,
      default: "",
    },
    createdAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

// Auto-generate sequential movementId (e.g. MOV-000001) using atomic Counter increment
stockMovementSchema.pre("save", async function (next) {
  if (this.isNew && !this.movementId) {
    try {
      const counter = await Counter.findByIdAndUpdate(
        "StockMovement",
        { $inc: { seq: 1 } },
        { new: true, upsert: true }
      );
      const paddedSeq = String(counter.seq).padStart(6, "0");
      this.movementId = `MOV-${paddedSeq}`;
    } catch (err) {
      const rand = crypto.randomBytes(3).toString("hex").toUpperCase();
      this.movementId = `MOV-${Date.now().toString().slice(-6)}-${rand}`;
    }
  }
  next();
});

// Enforce IMMUTABILITY: Block updates and deletions
const blockMutation = function (next) {
  const err = new Error("StockMovement records are immutable and cannot be modified or deleted.");
  err.statusCode = 403;
  next(err);
};

stockMovementSchema.pre("updateOne", blockMutation);
stockMovementSchema.pre("updateMany", blockMutation);
stockMovementSchema.pre("findOneAndUpdate", blockMutation);
stockMovementSchema.pre("findByIdAndUpdate", blockMutation);
stockMovementSchema.pre("deleteOne", blockMutation);
stockMovementSchema.pre("deleteMany", blockMutation);
stockMovementSchema.pre("findOneAndDelete", blockMutation);
stockMovementSchema.pre("findByIdAndDelete", blockMutation);

module.exports = mongoose.model("StockMovement", stockMovementSchema);
