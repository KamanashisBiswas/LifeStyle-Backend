/**
 * ============================================================
 * models/VendorReturn.js — Vendor Product Return / Stock Out Model
 * ============================================================
 * ডেট এক্সপায়ার্ড, ড্যামেজড বা অতিরিক্ত স্টক ভেন্ডরে ফেরত দেওয়ার মডেল।
 * Employee, Manager, এবং Admin রিটার্ন রিকোয়েস্ট তৈরি করতে পারে।
 * রিকোয়েস্টের শুরুতে status থাকে 'pending'।
 * একমাত্র Admin যখন 'approved' করবে তখন প্রোডাক্ট ভ্যারিয়েন্টের স্টক কমবে।
 * ============================================================
 */
const mongoose = require("mongoose");
const { generateCustomId } = require("../utils/customIdGenerator");

const vendorReturnItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Product",
    required: [true, "Product reference is required"],
  },
  productIdCode: {
    type: String,
    default: "",
    trim: true,
  },
  productName: {
    type: String,
    required: [true, "Product name snapshot is required"],
    trim: true,
  },
  variationId: {
    type: String,
    required: [true, "Variation ID is required"],
  },
  size: {
    type: String,
    default: null,
    trim: true,
  },
  color: {
    type: String,
    default: null,
    trim: true,
  },
  sku: {
    type: String,
    default: null,
    trim: true,
  },
  returnQuantity: {
    type: Number,
    required: [true, "Return quantity is required"],
    min: [1, "Return quantity must be at least 1"],
  },
  stockAtRequestTime: {
    type: Number,
    default: 0,
  },
  stockAtApprovalTime: {
    type: Number,
    default: 0,
  },
  newStockAfterApproval: {
    type: Number,
    default: 0,
  },
  purchasePrice: {
    type: Number,
    default: 0,
    min: 0,
  },
  basePrice: {
    type: Number,
    default: 0,
    min: 0,
  },
  discountPrice: {
    type: Number,
    default: null,
  },
  totalReturnCost: {
    type: Number,
    default: 0,
  },
});

const vendorReturnSchema = new mongoose.Schema(
  {
    returnId: {
      type: String,
      unique: true,
      sparse: true,
    },
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      required: false,
      default: null,
    },
    vendorName: {
      type: String,
      required: [true, "Vendor name is required"],
      trim: true,
    },
    vendorPhone: {
      type: String,
      default: "",
      trim: true,
    },
    items: {
      type: [vendorReturnItemSchema],
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: "Vendor return must contain at least one product item",
      },
    },
    totalReturnItems: {
      type: Number,
      required: true,
      default: 0,
    },
    totalReturnCost: {
      type: Number,
      required: true,
      default: 0,
    },
    reason: {
      type: String,
      required: [true, "Return reason is required"],
      enum: [
        "Date Expired",
        "Damaged Item",
        "Quality Defect",
        "Vendor Overstock",
        "Wrong Item Delivered",
        "Warehouse Return",
        "Other",
      ],
    },
    comment: {
      type: String,
      default: "",
      trim: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    requestedByName: {
      type: String,
      required: true,
      trim: true,
    },
    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    processedByName: {
      type: String,
      default: "",
      trim: true,
    },
    adminComment: {
      type: String,
      default: "",
      trim: true,
    },
    processedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// Pre-save hook to auto-generate VRET-00001 returnId
vendorReturnSchema.pre("save", async function (next) {
  if (this.isNew && !this.returnId) {
    try {
      this.returnId = await generateCustomId(
        "VRET",
        this.constructor,
        "returnId",
        "returnId"
      );
      next();
    } catch (error) {
      next(error);
    }
  } else {
    next();
  }
});

module.exports = mongoose.model("VendorReturn", vendorReturnSchema);
