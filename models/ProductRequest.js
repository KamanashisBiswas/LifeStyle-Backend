/**
 * ============================================================
 * models/ProductRequest.js — Product Request Model
 * ============================================================
 * Manager, Employee, ও Admin নতুন বা বিদ্যমান পণ্যের রিকোয়েস্ট
 * তৈরি করতে পারে, ফিডব্যাক থ্রেডে আলোচনা করতে পারে, Seen ট্র্যাকিং
 * দেখতে পারে এবং Admin রিকোয়েস্ট End/Close করতে পারে।
 * ============================================================
 */

const mongoose = require("mongoose");

// Feedback / Comment Schema
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
      enum: ["admin", "employee", "manager", "salesman", "user"],
    },
    userAvatar: {
      type: String,
      default: null,
    },
    message: {
      type: String,
      required: [true, "Feedback message is required"],
      trim: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true }
);

// Seen Record Schema (Who viewed the request and when)
const seenBySchema = new mongoose.Schema(
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
      enum: ["admin", "employee", "manager", "salesman", "user"],
    },
    userAvatar: {
      type: String,
      default: null,
    },
    seenAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: true }
);

const productRequestSchema = new mongoose.Schema(
  {
    requestCode: {
      type: String,
      unique: true,
      index: true,
    },
    requestType: {
      type: String,
      enum: ["new_product", "existing_product"],
      required: [true, "Request type is required"],
      default: "new_product",
    },

    // ─── For New Product Request ──────────────────────────
    productName: {
      type: String,
      required: [true, "Product name / title is required"],
      trim: true,
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      default: null,
    },
    categoryName: {
      type: String,
      default: "",
    },
    targetPrice: {
      type: Number,
      default: 0,
      min: 0,
    },
    estimatedQuantity: {
      type: Number,
      default: 0,
      min: 0,
    },
    description: {
      type: String,
      trim: true,
      default: "",
    },
    images: {
      type: [String],
      default: [],
    },

    // ─── For Existing Product Request ─────────────────────
    existingProduct: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      default: null,
    },
    productIdCode: {
      type: String,
      default: "",
    },
    productThumbnail: {
      type: String,
      default: "",
    },
    requestReason: {
      type: String,
      enum: [
        "stock_out",
        "reorder",
        "price_update",
        "defect",
        "new_variation",
        "other",
      ],
      default: "reorder",
    },
    requestedQuantity: {
      type: Number,
      default: 0,
      min: 0,
    },

    // ─── Requester Info ───────────────────────────────────
    requestedBy: {
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
      name: {
        type: String,
        required: true,
      },
      role: {
        type: String,
        required: true,
        enum: ["admin", "employee", "manager", "salesman", "user"],
      },
      email: {
        type: String,
        default: "",
      },
      avatar: {
        type: String,
        default: null,
      },
    },

    // ─── Status & Lifecycle ───────────────────────────────
    status: {
      type: String,
      enum: ["pending", "in_progress", "completed", "rejected"],
      default: "pending",
      index: true,
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high", "urgent"],
      default: "medium",
    },

    // ─── Seen Records & Feedback Thread ───────────────────
    seenBy: [seenBySchema],
    feedbacks: [feedbackSchema],

    // ─── Closure / End by Admin ───────────────────────────
    endedBy: {
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },
      name: {
        type: String,
        default: "",
      },
      role: {
        type: String,
        default: "",
      },
      endedAt: {
        type: Date,
        default: null,
      },
      closingNote: {
        type: String,
        default: "",
      },
    },
  },
  {
    timestamps: true,
  }
);

// Auto-generate request code e.g. REQ-00001
productRequestSchema.pre("save", async function (next) {
  if (this.isNew && !this.requestCode) {
    const { generateCustomId } = require("../utils/customIdGenerator");
    this.requestCode = await generateCustomId(
      "REQ",
      mongoose.model("ProductRequest"),
      "requestCode",
      "ProductRequest"
    );
  }
  next();
});

module.exports = mongoose.model("ProductRequest", productRequestSchema);
