/**
 * ============================================================
 * models/SalesTarget.js — Sales Target Model
 * ============================================================
 * Admin & Employee-রা সেলস টার্গেট সেট করতে পারে এবং
 * Manager-রা টার্গেটের লাইভ অগ্রগতি দেখে ফিডব্যাক দিতে পারে।
 * ============================================================
 */

const mongoose = require("mongoose");

const feedbackSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    userName: {
      type: String,
      required: true,
    },
    userRole: {
      type: String,
      required: true,
      enum: ["admin", "employee", "manager"],
    },
    comment: {
      type: String,
      required: true,
      trim: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true }
);

const salesTargetSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Target title is required"],
      trim: true,
    },
    targetType: {
      type: String,
      enum: ["daily", "weekly", "monthly", "yearly", "custom"],
      default: "monthly",
    },
    orderType: {
      type: String,
      enum: ["all", "shop", "online"],
      default: "shop",
    },
    targetAmount: {
      type: Number,
      required: [true, "Target sales amount is required"],
      min: [1, "Target amount must be at least 1"],
    },
    targetOrdersCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    startDate: {
      type: Date,
      required: [true, "Start date is required"],
    },
    endDate: {
      type: Date,
      required: [true, "End date is required"],
    },
    assignedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
    assignedToName: {
      type: String,
      default: "All Managers / General",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    createdByName: {
      type: String,
      required: true,
    },
    createdByRole: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["active", "completed", "cancelled"],
      default: "active",
    },
    notes: {
      type: String,
      default: "",
      trim: true,
    },
    feedbacks: [feedbackSchema],
  },
  { timestamps: true }
);

// Index for fast query by dates and status
salesTargetSchema.index({ status: 1, startDate: 1, endDate: 1 });

const SalesTarget =
  mongoose.models.SalesTarget ||
  mongoose.model("SalesTarget", salesTargetSchema);

module.exports = SalesTarget;
