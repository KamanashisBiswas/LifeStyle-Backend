/**
 * ============================================================
 * models/Expense.js — Shop Expense Schema
 * ============================================================
 * দোকানের বিভিন্ন আনুষঙ্গিক খরচ (চা, নাস্তা, বিদ্যুৎ বিল,
 * ট্রান্সপোর্ট, মেরামত ইত্যাদি) ট্র্যাক করার Mongoose Schema।
 * ============================================================
 */
const mongoose = require("mongoose");

const expenseSchema = new mongoose.Schema(
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
      required: [true, "Spent by (recipient/staff) is required"],
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
      default: "",
    },
    expenseId: {
      type: String,
      unique: true,
      sparse: true,
    },
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      default: null,
    },
    vendorName: {
      type: String,
      default: "",
    },
    vendorId: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

// Generate custom ID before saving a new document
expenseSchema.pre("save", async function (next) {
  if (this.isNew && !this.expenseId) {
    const { generateCustomId } = require("../utils/customIdGenerator");
    this.expenseId = await generateCustomId(
      "EXP",
      mongoose.model("Expense"),
      "expenseId",
      "Expense"
    );
  }
  next();
});

module.exports = mongoose.model("Expense", expenseSchema);
