/**
 * ============================================================
 * models/Leave.js — HRM Employee / Staff Leave Request Model
 * ============================================================
 * Manager, Employee, এবং Salesman তাদের ছুটির দরখাস্ত (Leave Request)
 * সাবমিট করলে এই মডেলে ডাটা জমা হয়। 
 * অ্যাডমিন রিভিউ করে Approve বা Reject করতে পারেন।
 * ============================================================
 */

const mongoose = require("mongoose");
const { generateCustomId } = require("../utils/customIdGenerator");

const leaveSchema = new mongoose.Schema(
  {
    leaveId: {
      type: String,
      unique: true,
    },
    applicant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Applicant user ID is required"],
    },
    applicantName: {
      type: String,
      required: true,
      trim: true,
    },
    applicantEmail: {
      type: String,
      required: true,
      trim: true,
    },
    applicantRole: {
      type: String,
      enum: ["admin", "manager", "employee", "salesman"],
      required: true,
    },
    leaveType: {
      type: String,
      enum: ["first_half", "second_half", "long_leave"],
      required: [true, "Leave type is required"],
    },
    // For first_half and second_half
    date: {
      type: Date,
      default: null,
    },
    // For long_leave (Full Day or Multi-day)
    fromDate: {
      type: Date,
      default: null,
    },
    toDate: {
      type: Date,
      default: null,
    },
    totalDays: {
      type: Number,
      default: 1,
    },
    reason: {
      type: String,
      required: [true, "Reason for leave is required"],
      trim: true,
    },
    comment: {
      type: String,
      trim: true,
      default: "",
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    adminNotes: {
      type: String,
      trim: true,
      default: "",
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewedByName: {
      type: String,
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Indexing for faster lookups
leaveSchema.index({ applicant: 1, createdAt: -1 });
leaveSchema.index({ status: 1, createdAt: -1 });

// Pre-save hook for auto-generating custom Leave ID (LEV-00001)
leaveSchema.pre("save", async function (next) {
  if (this.isNew && !this.leaveId) {
    try {
      this.leaveId = await generateCustomId(
        "LEV",
        this.constructor,
        "leaveId",
        "leaveId"
      );
      next();
    } catch (error) {
      next(error);
    }
  } else {
    next();
  }
});

module.exports = mongoose.model("Leave", leaveSchema);
