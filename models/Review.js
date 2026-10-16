/**
 * ============================================================
 * models/Review.js — Product Review Model
 * ============================================================
 * এই model পণ্য সম্পর্কে কাস্টমারদের রিভিউ ও রেটিং সংরক্ষণ করে।
 * 
 * গুরুত্বপূর্ণ নিয়মাবলী:
 *  1. শুধুমাত্র পণ্য ক্রয়কারী ও ডেলিভারি সম্পন্ন হওয়া কাস্টমাররাই রিভিউ দিতে পারে।
 *  2. রিভিউ ডিফল্টভাবে "pending" অবস্থায় থাকবে।
 *  3. অ্যাডমিন কর্তৃক "approved" হলে ওয়েবসাইটে সবার জন্য দৃশ্যমান হবে।
 *  4. অ্যাডমিন চাইলে রিভিউ এডিট, ডিলিট বা অফিসিয়াল রিপ্লাই দিতে পারবে।
 * ============================================================
 */

const mongoose = require("mongoose");

const reviewSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: [true, "Product reference is required"],
      index: true,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: [true, "Customer reference is required"],
      index: true,
    },
    customerName: {
      type: String,
      required: [true, "Customer name is required"],
      trim: true,
    },
    customerPhone: {
      type: String,
      trim: true,
    },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: [true, "Delivered order reference is required"],
    },
    rating: {
      type: Number,
      required: [true, "Rating is required"],
      min: [1, "Rating must be at least 1"],
      max: [5, "Rating cannot exceed 5"],
    },
    title: {
      type: String,
      trim: true,
      maxlength: [100, "Title cannot exceed 100 characters"],
      default: "",
    },
    comment: {
      type: String,
      required: [true, "Review comment is required"],
      trim: true,
      maxlength: [1000, "Comment cannot exceed 1000 characters"],
    },
    images: [
      {
        type: String,
        trim: true,
      },
    ],
    isVerifiedPurchase: {
      type: Boolean,
      default: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },
    adminReply: {
      comment: { type: String, trim: true, default: "" },
      repliedAt: { type: Date },
      adminName: { type: String, default: "Lifestyle Team" },
    },
    replies: [
      {
        sender: {
          type: String,
          enum: ["customer", "admin"],
          default: "customer",
        },
        senderName: {
          type: String,
          default: "",
        },
        message: {
          type: String,
          required: true,
          trim: true,
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    helpfulUsers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Customer",
      },
    ],
    helpfulCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// Compound unique index: One review per customer per product
reviewSchema.index({ product: 1, customer: 1 }, { unique: true });

module.exports = mongoose.model("Review", reviewSchema);
