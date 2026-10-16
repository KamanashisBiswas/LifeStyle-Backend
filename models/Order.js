/**
 * ============================================================
 * models/Order.js — Order Model
 * ============================================================
 * এই model সব অর্ডার এর data সাভ করে।
 *
 * Order দুই উপায়ে তৈরি হয়:
 *  1. Online order → Customer website থেকে order দেয়া (orderType: "online")
 *  2. Admin/POS order → Admin/Employee/Salesman কাউন্টার থেকে order (orderType: "pos")
 *
 * Order status flow:
 *  pending → received → shipping → delivered → (cancelled / returned / partial-returned / refunded)
 *
 * গুরুত্বপূর্ণ fields:
 *  - orderId → auto-generated (ORD-00001 format)
 *  - customer → optional (admin-created order ঎ customer ID তাকে না)
 *  - products[] → order ঊর পণ্য সমূহ (name, price, purchasePrice, quantity, size, color)
 *  - shippingArea → "Inside Dhaka" / "Outside Dhaka" — shipping fee নির্ধারণ করে
 *  - couponCode, discountAmount → যদি coupon apply হয়
 *  - pointsEarned → purchase ঊর বিপরীতে customer যা reward points পেয়েছে
 *  - createdBy → admin/employee কর্তৃক create হলে তাদের ID
 *  - payments[] → POS সেলস ঊর payment breakdown (যেমন: bkash, cash)
 * ============================================================
 */

const mongoose = require("mongoose");
const { generateCustomId } = require("../utils/customIdGenerator"); // Import the generator function

// Order schema definition
const orderSchema = new mongoose.Schema(
  {
    orderId: {
      type: String,
      unique: true,
    },
    // Make customer field optional for admin-created orders
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: false, // Changed from true to false
    },
    customerName: { type: String, required: true },
    address: { type: String, required: true },
    phone: { type: String, required: true },
    products: [
      {
        name: { type: String, required: true },
        productIdCode: { type: String },
        price: { type: Number, required: true },
        originalPrice: { type: Number },
        itemDiscount: { type: Number, default: 0 },
        itemDiscountType: { type: String, default: "flat" },
        itemDiscountValue: { type: Number, default: 0 },
        purchasePrice: { type: Number, required: false },
        quantity: { type: Number, required: true },
        size: { type: String },
        color: { type: String },
        productId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
          required: true,
        },
        variationId: { type: mongoose.Schema.Types.ObjectId, required: false },
        exchangedQuantity: { type: Number, default: 0 },
        vat: { type: Number, default: 0 },
        vatAmount: { type: Number, default: 0 },
        deductions: [
          {
            location: {
              type: String,
              enum: ["display", "shopStock", "warehouse"],
              required: true,
            },
            quantity: {
              type: Number,
              required: true,
              min: 1,
            },
          },
        ],
      },
    ],
    subtotal: {
      type: Number,
      required: true,
    },
    vatAmount: {
      type: Number,
      default: 0,
    },
    shippingFee: {
      type: Number,
      required: true,
    },
    shippingArea: {
      type: String,
      enum: ["Inside Dhaka", "Outside Dhaka"],
      required: true,
    },
    totalAmount: { type: Number, required: true },
    couponCode: {
      type: String,
      required: false,
      trim: true,
    },
    discountAmount: {
      type: Number,
      required: false,
      default: 0,
    },
    isVatDiscount: {
      type: Boolean,
      default: false,
    },
    vatDiscountAmount: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: [
        "pending",
        "received",
        "shipping",
        "delivered",
        "cancelled",
        "returned",
        "partial-returned",
        "refunded",
      ],
      default: "pending",
    },
    pointsEarned: {
      type: Number,
      default: 0,
    },
    // Reward points redeemed by customer on website checkout (1 pt = ৳1)
    pointsRedeemed: {
      type: Number,
      default: 0,
    },
    pointsDiscount: {
      type: Number,
      default: 0,
    },
    // Add a field to track which admin/employee created the order
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    // Track selected salesman/sales executive who earned reward points on this sale
    salesman: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    // Store exact name of salesman for fast & guaranteed report rendering
    salesmanName: {
      type: String,
      required: false,
      default: "",
    },
    // Order type to differentiate between online and shop orders
    orderType: {
      type: String,
      enum: ["online", "shop"],
      required: true,
      default: "online",
    },
    // Payment methods used for this order
    payments: [
      {
        method: {
          type: String,
          enum: ["Bkash", "Card", "Cash", "Bangla QR", "Rocket"],
          required: true,
        },
        amount: {
          type: Number,
          required: true,
        },
        posMachine: {
          type: String,
          enum: ["Pubali Bank POS", "City Bank POS", "UCB POS", ""],
          default: "",
          trim: true,
        },
      },
    ],
    // Total amount paid through all payment methods
    totalPaid: {
      type: Number,
      required: false,
      default: 0,
    },
    // Return amount (change) given to customer when paid more than total
    returnAmount: {
      type: Number,
      required: false,
      default: 0,
    },
    // Payment status: default COD, can be switched to Paid (independent display flag)
    paymentStatus: {
      type: String,
      enum: ["COD", "Paid"],
      default: "COD",
      trim: true,
    },
    // Optional Manager / Internal note for the order
    note: {
      type: String,
      required: false,
      default: "",
    },
    // Advanced delivery charge status (e.g., customer paid delivery fee in advance)
    isDeliveryChargePaid: {
      type: Boolean,
      default: false,
    },
    // Track which staff/admin/manager marked advanced delivery charge as paid
    deliveryChargePaidBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    deliveryChargePaidByName: {
      type: String,
      required: false,
      default: "",
    },
    deliveryChargePaidAt: {
      type: Date,
      required: false,
    },
    // Cached courier fraud/delivery check result from BDCourier
    courierSummary: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    // Pathao Courier dispatch details & tracking
    pathaoOrder: {
      consignmentId: { type: String, default: null },
      trackingCode: { type: String, default: null },
      orderStatus: { type: String, default: null },
      deliveryFee: { type: Number, default: 0 },
      storeId: { type: Number, default: null },
      storeName: { type: String, default: null },
      cityId: { type: Number, default: null },
      zoneId: { type: Number, default: null },
      areaId: { type: Number, default: null },
      cityName: { type: String, default: null },
      zoneName: { type: String, default: null },
      areaName: { type: String, default: null },
      itemWeight: { type: Number, default: 0.5 },
      collectAmount: { type: Number, default: 0 },
      dispatchedAt: { type: Date, default: null },
      rawResponse: { type: mongoose.Schema.Types.Mixed, default: null },
    },
  },
  { timestamps: true },
);

// Pre-save hook to generate custom orderId, consistent with other models
orderSchema.pre("save", async function (next) {
  if (this.isNew && !this.orderId) {
    const { generateCustomId } = require("../utils/customIdGenerator");
    this.orderId = await generateCustomId(
      "ORD",
      mongoose.model("Order"),
      "orderId",
      "Order",
    );
  }
  next();
});

// Order model
const Order = mongoose.models.Order || mongoose.model("Order", orderSchema);

module.exports = Order;
