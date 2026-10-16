/**
 * ============================================================
 * models/Purchase.js — Stock Purchase Model
 * ============================================================
 * পণ্য ক্রয় ও স্টক সংযোজনের Mongoose Schema।
 * Manager, Employee, এবং Admin পণ্য ক্রয়ের হিসাব এন্ট্রি করতে পারে।
 * নতুন ক্রয়ের ক্ষেত্রে status থাকে 'pending'।
 * একমাত্র Admin যখন 'approved' করবে তখন প্রোডাক্ট স্টক আপডেট হবে।
 * ============================================================
 */
const mongoose = require("mongoose");

const purchaseSchema = new mongoose.Schema(
  {
    purchaseId: {
      type: String,
      unique: true,
      sparse: true,
    },
    batchId: {
      type: String,
      default: "",
      index: true,
      trim: true,
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: [true, "Product selection is required"],
    },
    productName: {
      type: String,
      required: [true, "Product name is required"],
      trim: true,
    },
    productIdCode: {
      type: String,
      default: "",
      trim: true,
    },
    variationId: {
      type: String,
      default: "",
    },
    productSize: {
      type: String,
      default: "",
      trim: true,
    },
    productColor: {
      type: String,
      default: "",
      trim: true,
    },
    quantity: {
      type: Number,
      required: [true, "Purchase quantity is required"],
      min: [1, "Quantity must be at least 1"],
    },
    purchasePrice: {
      type: Number,
      default: 0,
      min: [0, "Purchase price cannot be negative"],
    },
    basePrice: {
      type: Number,
      default: 0,
      min: [0, "Base price cannot be negative"],
    },
    discountPrice: {
      type: Number,
      default: 0,
      min: [0, "Discount price cannot be negative"],
    },
    totalCost: {
      type: Number,
      default: 0,
    },
    targetLocation: {
      type: String,
      enum: ["shopStock", "display", "warehouse"],
      default: "shopStock",
    },
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      default: null,
    },
    vendorName: {
      type: String,
      default: "",
      trim: true,
    },
    invoiceNo: {
      type: String,
      default: "",
      trim: true,
    },
    purchaseDate: {
      type: Date,
      default: Date.now,
    },
    notes: {
      type: String,
      default: "",
      trim: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    rejectionReason: {
      type: String,
      default: "",
      trim: true,
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
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    approvedByName: {
      type: String,
      default: "",
    },
    approvedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Calculate total cost and generate unique purchaseId before saving
purchaseSchema.pre("save", async function (next) {
  this.totalCost = (Number(this.quantity) || 0) * (Number(this.purchasePrice) || 0);

  if (this.isNew && !this.purchaseId) {
    const { generateCustomId } = require("../utils/customIdGenerator");
    const PurchaseModel = mongoose.model("Purchase");

    try {
      let candidateId = await generateCustomId(
        "PUR",
        PurchaseModel,
        "purchaseId",
        "Purchase"
      );

      let attempts = 0;
      while (attempts < 20 && (await PurchaseModel.exists({ purchaseId: candidateId }))) {
        attempts++;
        const docs = await PurchaseModel.find({}, { purchaseId: 1, _id: 0 }).lean();
        const serials = docs
          .map((d) => {
            const parts = d.purchaseId?.split("-");
            return parts && parts[1] ? parseInt(parts[1], 10) : null;
          })
          .filter((n) => n !== null && !isNaN(n))
          .sort((a, b) => a - b);
        const maxSerial = serials.length > 0 ? Math.max(...serials) : 0;
        const nextSeq = maxSerial + attempts;
        candidateId = `PUR-${String(nextSeq).padStart(5, "0")}`;
      }

      this.purchaseId = candidateId;
    } catch (err) {
      this.purchaseId = `PUR-${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 100)}`;
    }
  }
  next();
});

module.exports = mongoose.model("Purchase", purchaseSchema);
