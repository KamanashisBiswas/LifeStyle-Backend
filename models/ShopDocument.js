/**
 * ============================================================
 * models/ShopDocument.js — Shop Legal & Business Document Model
 * ============================================================
 * দোকানের বিভিন্ন অফিসিয়াল ও আইনি ডকুমেন্টস (ট্রেড লাইসেন্স, টিন,
 * ভ্যাট/বিন, ভাড়ার চুক্তিপত্র, ব্যাংক ডকুমেন্ট ইত্যাদি) সংরক্ষণ করার মডেল।
 * ============================================================
 */

const mongoose = require("mongoose");

const shopDocumentSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, "Document title is required"],
      trim: true,
      maxlength: [200, "Title cannot exceed 200 characters"],
    },
    documentType: {
      type: String,
      required: [true, "Document type is required"],
      enum: [
        "Trade License",
        "TIN Certificate",
        "BIN / VAT Certificate",
        "Rent Agreement",
        "Utility Bill",
        "Bank Document",
        "National ID / Passport",
        "Partnership / Incorporation Deed",
        "Fire Safety License",
        "Insurance Policy",
        "Other",
      ],
      default: "Other",
    },
    documentNumber: {
      type: String,
      trim: true,
      default: "",
    },
    issueDate: {
      type: Date,
      default: null,
    },
    expiryDate: {
      type: Date,
      default: null,
    },
    fileUrl: {
      type: String,
      required: [true, "Document file URL is required"],
    },
    publicId: {
      type: String,
      default: "",
    },
    fileType: {
      type: String, // 'image', 'pdf', or mime type
      default: "image",
    },
    fileName: {
      type: String,
      default: "",
    },
    fileSize: {
      type: Number, // in bytes
      default: 0,
    },
    notes: {
      type: String,
      trim: true,
      default: "",
    },
    status: {
      type: String,
      enum: ["active", "expired", "archived"],
      default: "active",
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes for fast searching and sorting
shopDocumentSchema.index({ title: "text", documentNumber: "text", notes: "text" });
shopDocumentSchema.index({ documentType: 1, status: 1 });
shopDocumentSchema.index({ expiryDate: 1 });
shopDocumentSchema.index({ createdAt: -1 });

module.exports = mongoose.model("ShopDocument", shopDocumentSchema);
