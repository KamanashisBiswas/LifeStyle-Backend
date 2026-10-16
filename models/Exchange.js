/**
 * ============================================================
 * models/Exchange.js — Product Replace / Exchange Model
 * ============================================================
 * ম্যানেজার এবং অ্যাডমিন Shop Order-এর কেনা প্রডাক্ট অন্য প্রডাক্টের সাথে Replace/Exchange করার
 * বিবরণ সাভ করার জন্য এই Mongoose মডেল ব্যবহার করা হয়।
 * ============================================================
 */

const mongoose = require("mongoose");
const { generateCustomId } = require("../utils/customIdGenerator");

const exchangeSchema = new mongoose.Schema(
  {
    exchangeId: {
      type: String,
      unique: true,
    },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
    },
    orderIdCode: {
      type: String,
      required: true,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: false,
    },
    customerName: { type: String },
    customerPhone: { type: String },

    // Original Purchased Product Items (Supports 1 or Multiple Returned Products)
    originalItems: [
      {
        originalProduct: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
          required: true,
        },
        originalProductName: { type: String },
        originalProductIdCode: { type: String },
        originalProductSize: { type: String },
        originalProductColor: { type: String },
        originalVariationId: { type: String },
        originalUnitPrice: { type: Number, required: true },
        quantity: { type: Number, required: true, default: 1 },
        originalTotalPrice: { type: Number, required: true },
        originalVat: { type: Number, default: 0 },
        originalVatAmount: { type: Number, default: 0 },
      },
    ],

    // Primary Original Product Details (for backward compatibility)
    originalProduct: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: false,
    },
    originalProductName: { type: String },
    originalProductIdCode: { type: String },
    originalProductSize: { type: String },
    originalProductColor: { type: String },
    originalVariationId: { type: String },
    originalUnitPrice: { type: Number, required: false },
    originalTotalPrice: { type: Number, required: false },

    // Replacement Product Items (Supports 1 or Multiple Replacement Products)
    replacementItems: [
      {
        replacementProduct: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
          required: true,
        },
        replacementProductName: { type: String },
        replacementProductIdCode: { type: String },
        replacementProductSize: { type: String },
        replacementProductColor: { type: String },
        replacementVariationId: { type: String },
        replacementUnitPrice: { type: Number, required: true },
        quantity: { type: Number, required: true, default: 1 },
        replacementTotalPrice: { type: Number, required: true },
        replacementVat: { type: Number, default: 0 },
        replacementVatAmount: { type: Number, default: 0 },
      },
    ],

    // Primary Replacement Item Details (for backward compatibility)
    replacementProduct: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: false,
    },
    replacementProductName: { type: String },
    replacementProductIdCode: { type: String },
    replacementProductSize: { type: String },
    replacementProductColor: { type: String },
    replacementVariationId: { type: String },
    replacementUnitPrice: { type: Number, required: false },
    replacementTotalPrice: { type: Number, required: false },

    // Actual Exchanged Quantity
    exchangeQuantity: {
      type: Number,
      required: true,
      min: 1,
    },

    // Price Difference & Financial Rule Tracking
    priceDifference: {
      type: Number,
      required: true, // Replacement Total - Original Total
    },
    originalTotalVat: {
      type: Number,
      default: 0,
    },
    replacementTotalVat: {
      type: Number,
      default: 0,
    },
    netVatAmount: {
      type: Number,
      default: 0,
    },
    isVatWaived: {
      type: Boolean,
      default: false,
    },
    vatWaivedAmount: {
      type: Number,
      default: 0,
    },
    exchangeType: {
      type: String,
      enum: ["cash_change", "additional_payment", "even_exchange"],
      required: true,
    },
    cashChangeAmount: {
      type: Number,
      default: 0,
    },
    additionalPaymentAmount: {
      type: Number,
      default: 0,
    },
    paymentMethod: {
      type: String,
      enum: ["Cash", "Card", "Bkash", "Bangla QR", "N/A"],
      default: "N/A",
    },

    notes: { type: String },
    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    processedByName: { type: String },
    processedByRole: { type: String },
  },
  { timestamps: true }
);

// Auto-generate EXC-00001 custom ID before saving
exchangeSchema.pre("save", async function (next) {
  if (this.isNew && !this.exchangeId) {
    try {
      this.exchangeId = await generateCustomId(
        "EXC",
        this.constructor,
        "exchangeId",
        "exchangeId"
      );
      next();
    } catch (error) {
      next(error);
    }
  } else {
    next();
  }
});

module.exports = mongoose.model("Exchange", exchangeSchema);
