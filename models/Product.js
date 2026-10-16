/**
 * ============================================================
 * models/Product.js — Product Model
 * ============================================================
 * এই model সব পণ্যের data সাভ করে।
 *
 * গুরুত্বপূর্ণ ধারণা:
 *
 * variation (Sub-document array):
 *  প্রতি product এর একাধিক variation থাকতে পারে
 *  (যেমন: S size সাদা, M size লাল — আলাদা আলাদা price ও stock)
 *  - size: String (S/M/L/XL ইত্যাদি)
 *  - color: String
 *  - purchasePrice: ক্রয় মূল্য (লাভ/লোকসান হিসাব করতে)
 *  - basePrice: মূল বিক্রাষ মূল্য
 *  - discountPrice: discount বাদ দেওয়া মূল্য
 *  - stock: বর্তমান মজুদ
 *
 * productId:
 *  → pre-save hook এ স্বয়ংক্রিয়ভাবে generate হয় (PRD-00001 format)
 *
 * গুরুত্বপূর্ণ reference fields:
 *  - category, subCategory, brand, vendor → ObjectId references
 *  - createdBy → কোন admin/employee তৈরি করেছে
 * ============================================================
 */

const mongoose = require("mongoose");

const variationSchema = new mongoose.Schema({
  size: { type: String, default: null },
  color: { type: String, default: null },
  sku: { type: String, default: null, trim: true },
  images: [{ type: String }],
  purchasePrice: {
    type: Number,
    required: true,
    min: 0,
    validate: {
      validator: function (v) {
        return typeof v === "number" && !isNaN(v) && isFinite(v);
      },
      message: "purchasePrice must be a valid number",
    },
  },
  basePrice: {
    type: Number,
    required: true,
    min: 0,
    validate: {
      validator: function (v) {
        return typeof v === "number" && !isNaN(v) && isFinite(v);
      },
      message: "basePrice must be a valid number",
    },
  },
  discountPrice: {
    type: Number,
    min: 0,
    validate: {
      validator: function (v) {
        if (v === null || v === undefined) return true;
        return typeof v === "number" && !isNaN(v) && isFinite(v);
      },
      message: "discountPrice must be a valid number",
    },
  },
  stock: {
    type: Number,
    required: false,
    default: 0,
    min: 0,
    validate: {
      validator: function (v) {
        if (v === null || v === undefined) return true;
        return typeof v === "number" && !isNaN(v) && isFinite(v);
      },
      message: "stock must be a valid number",
    },
  },
  locations: {
    display: {
      type: Number,
      default: 0,
      min: 0,
    },
    shopStock: {
      type: Number,
      default: 0,
      min: 0,
    },
    warehouse: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
});

/**
 * Variation validation: Sync locations and stock
 * Ensures variation.stock === display + shopStock + warehouse
 * Never allow negative inventory.
 */
variationSchema.pre("validate", function (next) {
  const currentStock = typeof this.stock === "number" ? Math.max(0, this.stock) : 0;

  if (!this.locations) {
    this.locations = {
      display: currentStock,
      shopStock: 0,
      warehouse: 0,
    };
  } else {
    let d = typeof this.locations.display === "number" ? Math.max(0, this.locations.display) : 0;
    let sh = typeof this.locations.shopStock === "number" ? Math.max(0, this.locations.shopStock) : (typeof this.locations.shop === "number" ? Math.max(0, this.locations.shop) : 0);
    let w = typeof this.locations.warehouse === "number" ? Math.max(0, this.locations.warehouse) : (typeof this.locations.storeRoom === "number" ? Math.max(0, this.locations.storeRoom) : 0);

    // If all locations are 0 but variation has stock, default to display
    if (d === 0 && sh === 0 && w === 0 && currentStock > 0) {
      this.locations.display = currentStock;
      this.locations.shopStock = 0;
      this.locations.warehouse = 0;
    } else {
      const sumLocations = d + sh + w;
      if (sumLocations !== currentStock) {
        if (currentStock === 0) {
          this.locations.display = 0;
          this.locations.shopStock = 0;
          this.locations.warehouse = 0;
        } else if (sumLocations === 0) {
          this.locations.display = currentStock;
          this.locations.shopStock = 0;
          this.locations.warehouse = 0;
        } else {
          let diff = sumLocations - currentStock;
          if (diff > 0) {
            // External stock decrease fallback: deduct from display, then shopStock, then warehouse
            const deductDisplay = Math.min(d, diff);
            d -= deductDisplay;
            diff -= deductDisplay;

            if (diff > 0) {
              const deductShop = Math.min(sh, diff);
              sh -= deductShop;
              diff -= deductShop;
            }

            if (diff > 0) {
              const deductWh = Math.min(w, diff);
              w -= deductWh;
              diff -= deductWh;
            }
            this.locations.display = d;
            this.locations.shopStock = sh;
            this.locations.warehouse = w;
          } else if (diff < 0) {
            // External stock increase: add difference to shopStock
            sh += Math.abs(diff);
            this.locations.shopStock = sh;
          }
        }
      } else {
        this.locations.display = d;
        this.locations.shopStock = sh;
        this.locations.warehouse = w;
      }
    }
  }
  next();
});

const productSchema = new mongoose.Schema(
  {
    productId: {
      type: String,
      unique: true,
    },
    sku: {
      type: String,
      trim: true,
    },
    barcode: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      validate: {
        validator: function (v) {
          // Allow null/undefined (sparse index handles this)
          if (!v) return true;
          // Barcode should be a non-empty string
          return typeof v === "string" && v.trim().length > 0;
        },
        message: "barcode must be a non-empty string",
      },
    },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, required: true, trim: true, maxlength: 2000 },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
      required: [true, "Category is required"],
    },
    subCategory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SubCategory",
      required: false,
      default: null
    },
    brand: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Brand",
      required: false,
      default: null
    },
    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Vendor",
      required: false,
      default: null
    },
    // Legacy fallback fields — kept for backward compatibility with existing products.
    // New products store images inside each variation's images[] array.
    bannerImage: { type: String, default: null },
    images: [{ type: String }],
    variation: {
      type: [variationSchema],
      required: true,
      validate: (v) => Array.isArray(v) && v.length > 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    flag: {
      type: String,
      enum: ["just-for-you", "flash-sale", "new-stock", "trendy", "top-selling", null, ""],
      default: null,
    },
    salesChannel: {
      type: String,
      enum: ["OFFLINE", "BOTH"],
      default: "BOTH",
    },
    sizeChart: {
      type: String,
      default: null,
    },
    vat: {
      type: Number,
      default: 0,
      min: 0,
    },
    rating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    reviewCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

const crypto = require("crypto");

// Generate random SKU helper (e.g. 8F3A29)
const generateRandomSKU = () => {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
};

const { ensureUniqueProductSKUs } = require("../utils/skuGenerator");

// Generate custom productId and auto-random SKU before saving
productSchema.pre("save", async function (next) {
  if (this.barcode === null || this.barcode === undefined || String(this.barcode).trim() === "") {
    this.barcode = undefined;
  }

  const ProductModel = mongoose.model("Product");
  await ensureUniqueProductSKUs(this, ProductModel);

  if (this.isNew && !this.productId) {
    const { generateCustomId } = require("../utils/customIdGenerator");
    this.productId = await generateCustomId(
      "PRD",
      ProductModel,
      "productId",
      "Product",
    );
  }
  next();
});

/**
 * Static helper method: Get barcode value with fallback to productId
 *
 * @param {Object} product - Product document
 * @returns {string} - barcode if exists, otherwise productId
 *
 * Usage:
 *  const barcodeValue = Product.getBarcodeValue(product);
 *  await generateBarcodePngBuffer(barcodeValue);
 */
productSchema.statics.getBarcodeValue = function (product) {
  if (!product) {
    throw new Error("Product document is required");
  }

  // Barcode is generated using SKU (variation sku, product sku, or barcode/productId fallback)
  let skuValue = "";
  if (Array.isArray(product.variation) && product.variation.length > 0) {
    skuValue = product.variation[0]?.sku || "";
  }
  const value = skuValue || product.sku || product.barcode || product.productId;

  if (!value || typeof value !== "string") {
    throw new Error(
      `Invalid SKU/barcode/productId for product: ${product.name}.`
    );
  }

  return String(value).trim();
};

/**
 * Instance method: Get barcode value for this product
 *
 * @returns {string} - barcode if exists, otherwise productId
 */
productSchema.methods.getBarcodeValue = function () {
  return mongoose.model("Product").getBarcodeValue(this);
};

module.exports = mongoose.model("Product", productSchema);
