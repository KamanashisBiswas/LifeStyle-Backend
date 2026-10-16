/**
 * ============================================================
 * models/OwnerPayout.js — Shop Owner Payout Model
 * ============================================================
 * ম্যানেজার বা অ্যাডমিন কর্তৃক শপ ওনারকে (মালিক) ব্যবসার প্রফিট
 * হস্তান্তর/পরিশোধের রেকর্ড রাখার Mongoose Schema।
 *
 * Rules:
 *  - Manager, Employee, Admin: এন্ট্রি তৈরি ও দেখতে পারবেন
 *  - Admin Only: এন্ট্রি এডিট ও ডিলিট করতে পারবেন
 * ============================================================
 */
const mongoose = require("mongoose");

const ownerPayoutSchema = new mongoose.Schema(
  {
    payoutId: {
      type: String,
      unique: true,
      sparse: true,
    },
    amount: {
      type: Number,
      required: [true, "Payout amount is required"],
      min: [1, "Amount must be greater than 0"],
    },
    paymentMethod: {
      type: String,
      enum: ["Cash", "Bkash", "Nagad", "Bank Transfer", "Card", "Cheque", "Other"],
      default: "Cash",
    },
    recipientName: {
      type: String,
      trim: true,
      default: "Shop Owner",
    },
    profitType: {
      type: String,
      enum: ["shop", "online", "total"],
      default: "shop", // 'shop' = Shop Profit, 'online' = Online Profit, 'total' = Combined Total Profit
    },
    date: {
      type: Date,
      default: Date.now,
    },
    handedOverBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    handedOverByName: {
      type: String,
      trim: true,
      default: "",
    },
    handedOverByRole: {
      type: String,
      trim: true,
      default: "",
    },
    bankName: {
      type: String,
      trim: true,
      default: "",
    },
    accountNumber: {
      type: String,
      trim: true,
      default: "",
    },
    transactionId: {
      type: String,
      trim: true,
      default: "",
    },
    note: {
      type: String,
      trim: true,
      default: "",
    },
    // Manager Feedback to Admin
    feedback: {
      type: String,
      trim: true,
      default: "",
    },
    // Admin Reply to Manager Feedback
    adminReply: {
      message: { type: String, trim: true, default: "" },
      repliedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      repliedByName: { type: String, default: "" },
      repliedAt: { type: Date },
    },
    // Interactive Conversation Thread between Manager and Admin
    feedbackThread: [
      {
        sender: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        senderName: { type: String, default: "" },
        senderRole: { type: String, default: "" },
        message: { type: String, required: true },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    status: {
      type: String,
      enum: ["Completed", "Approved", "Pending", "Cancelled", "Rejected"],
      default: "Pending",
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    approvedByName: {
      type: String,
      trim: true,
      default: "",
    },
    approvedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

// Generate custom sequential ID before saving (e.g. PAY-00001)
ownerPayoutSchema.pre("save", async function (next) {
  if (this.isNew && !this.payoutId) {
    try {
      const { generateCustomId } = require("../utils/customIdGenerator");
      this.payoutId = await generateCustomId(
        "PAY",
        mongoose.model("OwnerPayout"),
        "payoutId",
        "OwnerPayout"
      );
    } catch (err) {
      console.warn("Custom ID generation failed, falling back to timestamp ID:", err);
      this.payoutId = "PAY-" + Date.now().toString().slice(-6);
    }
  }
  next();
});

module.exports = mongoose.model("OwnerPayout", ownerPayoutSchema);
