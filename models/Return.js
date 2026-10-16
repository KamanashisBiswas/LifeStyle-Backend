/**
 * ============================================================
 * models/Return.js — Product Return Request Model
 * ============================================================
 * Customer পণ্য ফেরত দেওয়ার request সাভ করে।
 *
 * Return process flow:
 *  Customer request → pending → approved → received → refunded
 *  → admin reject করলে: rejected
 *
 * গুরুত্বপূর্ণ fields:
 *  - returnId → auto-generated (RET-00001 format)
 *  - order → কোন order ঊর বিরুদ্ধে return করা হচ্ছে
 *  - product, productName, productSize, productColor → কোন পণ্য ফেরত
 *  - quantity → কতটি ফেরত
 *  - reason → কোন কারণে ফেরত (Defective, Wrong Item, ইত্যাদি)
 *  - refundAmount → কত টাকা ফেরত দেওয়া হবে
 *  - adminComment → admin যদি কিছু যোগ করতে চায়
 *  - processedBy → কোন admin/employee অনুমোদন দিয়েছে
 * ============================================================
 */

const mongoose = require("mongoose");
const { generateCustomId } = require("../utils/customIdGenerator");

const returnSchema = new mongoose.Schema(
  {
    returnId: {
      type: String,
      unique: true,
    },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: false,
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    productName: { type: String }, // redundant but useful for display if product deleted
    productIdCode: { type: String }, // custom product ID string (e.g. PRD-00011)
    productSize: { type: String },
    productColor: { type: String },

    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    reason: {
      type: String,
      required: true,
      enum: [
        "Defective",
        "Wrong Item",
        "Size Doesn't Fit",
        "Wrong Size",
        "Color Mismatch",
        "Changed Mind",
        "Shop Return",
        "Damaged",
        "Customer Request",
        "Not as Described",
        "Other",
      ],
      default: "Shop Return",
    },
    message: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "received", "refunded", "rejected"],
      default: "pending",
    },
    refundAmount: {
      type: Number,
      default: 0,
    },
    returnType: {
      type: String,
      enum: ["online", "shop"],
      default: "online",
    },
    adminComment: {
      type: String,
    },
    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User", // Admin or Employee
    },
  },
  { timestamps: true },
);

// Generate custom ID before saving
returnSchema.pre("save", async function (next) {
  if (this.isNew) {
    try {
      this.returnId = await generateCustomId(
        "RET",
        this.constructor,
        "returnId",
        "returnId",
      );
      next();
    } catch (error) {
      next(error);
    }
  } else {
    next();
  }
});

module.exports = mongoose.model("Return", returnSchema);
