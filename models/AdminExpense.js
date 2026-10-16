/**
 * ============================================================
 * models/AdminExpense.js — Admin Personal/Official Expense Schema
 * ============================================================
 * শুধুমাত্র অ্যাডমিনের নিজস্ব খরচের হিসাব রাখার আলাদা Mongoose Schema।
 * এটি সম্পূর্ণ আলাদা ও আইসোলেটেড, শপ এক্সপেন্স বা অন্যান্য
 * পেজের ক্যালকুলেশনের সাথে কোনোভাবেই যুক্ত নয়।
 * ============================================================
 */
const mongoose = require("mongoose");

const adminExpenseSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Expense title is required"],
      trim: true,
    },
    category: {
      type: String,
      default: "Other",
    },
    otherCategoryDetail: {
      type: String,
      trim: true,
      default: "",
    },
    amount: {
      type: Number,
      required: [true, "Expense amount is required"],
      min: [0, "Amount cannot be negative"],
    },
    spentBy: {
      type: String,
      required: [true, "Spent by is required"],
      trim: true,
    },
    purpose: {
      type: String,
      trim: true,
      default: "",
    },
    note: {
      type: String,
      trim: true,
      default: "",
    },
    date: {
      type: Date,
      default: Date.now,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    createdByName: {
      type: String,
      default: "",
    },
    createdByRole: {
      type: String,
      default: "admin",
    },
    expenseId: {
      type: String,
      unique: true,
      sparse: true,
    },
  },
  {
    timestamps: true,
  }
);

// Generate custom ID before saving a new document
adminExpenseSchema.pre("save", async function (next) {
  if (this.isNew && !this.expenseId) {
    const { generateCustomId } = require("../utils/customIdGenerator");
    this.expenseId = await generateCustomId(
      "AEXP",
      mongoose.model("AdminExpense"),
      "expenseId",
      "AdminExpense"
    );
  }
  next();
});

module.exports = mongoose.model("AdminExpense", adminExpenseSchema);
