/**
 * ============================================================
 * controllers/productController.js — Product Management
 * ============================================================
 * পণ্য তৈরি, দেখা, সার্চ, filter, update, delete handle করে।
 * সবত্থেকে বড় ও জটিল controller।
 *
 * API Endpoints:
 *  POST   /api/product                → createProduct()         — নতুন product (image upload সহ)
 *  GET    /api/product                → getAllProducts()         — Public: active products (filter/search/pagination)
 *  GET    /api/product/admin          → getAllProductsAdmin()    — Admin: সব products
 *  GET    /api/product/:id            → getProductByCustomId()  — productId দিয়ে একটি product
 *  PUT    /api/product/:id            → updateProduct()         — product update
 *  DELETE /api/product/:id            → deleteProduct()         — delete (admin only)
 *  POST   /api/product/bulk-delete    → bulkDeleteProducts()    — একসাথে অনেক product delete
 *  GET    /api/product/search         → searchProducts()        — সার্চ query
 *
 * Product variation:
 *  প্রতি product ঊর একাধিক variation থাকতে পারে (size, color, price, stock)
 *  Order বা POS sale হলে সেই variation ঊর stock কমানো হয়
 *
 * Image handling:
 *  - bannerImage: একটি main পণ্যের banner ছবি
 *  - images[]: বাড়তি gallery ছবি
 *  - Error হলে Cloudinary থেকে uploaded ছবি মুছে ফেলা হয়
 * ============================================================
 */

const Product = require("../models/Product");
const Counter = require("../models/Counter");
const Order = require("../models/Order");
const Purchase = require("../models/Purchase");
const asyncHandler = require("../utils/asyncHandler");
const {
  extractPublicIdFromUrl,
  deleteImageFromCloudinary,
} = require("../config/cloudinary");
const mongoose = require("mongoose");
const { logActivity } = require("../utils/activityLogger");
const inventoryService = require("../services/inventoryService");
const StockMovement = require("../models/StockMovement");

/**
 * Helper function to filter sensitive price fields based on user role
 * purchasePrice - visible ONLY to admin users
 * basePrice, discountPrice - visible to all users (needed for public website pricing)
 */
const filterSensitivePrices = (products, userRole) => {
  if (!Array.isArray(products)) {
    products = [products];
  }

  return products.map((product) => {
    const productObj = product.toObject ? product.toObject() : product;

    if (productObj.variation && Array.isArray(productObj.variation)) {
      productObj.variation = productObj.variation.map((v) => {
        const variationObj = v.toObject ? v.toObject() : v;

        // Hide purchasePrice and profit from ALL non-admin users (only visible to admin)
        if (userRole !== "admin") {
          delete variationObj.purchasePrice;
          delete variationObj.profit;
          delete variationObj.profitMargin;
        }

        // NOTE: basePrice and discountPrice are now visible to ALL users
        // This is necessary for the public website to display product prices to customers
        // Only purchasePrice is hidden from non-admin users

        return variationObj;
      });
    }

    return productObj;
  });
};

/**
 * Helper to dynamically attach active campaign offers (Flash Sale, Just For You)
 * to public product responses without modifying database records.
 */
const attachActiveOffersToProducts = async (products) => {
  if (!Array.isArray(products) || products.length === 0) return products;

  try {
    const Offer = require("../models/Offer");
    const OfferProduct = require("../models/OfferProduct");

    const productIds = products.map((p) => p._id || p.id).filter(Boolean);
    if (productIds.length === 0) return products;

    const now = new Date();

    const offerProducts = await OfferProduct.find({ productId: { $in: productIds } })
      .populate({
        path: "offerId",
        match: {
          isActive: true,
          deletedAt: null,
          startDate: { $lte: now },
          endDate: { $gte: now },
        },
      })
      .lean();

    const productOffersMap = {};
    offerProducts.forEach((op) => {
      if (op.offerId) {
        const pid = op.productId.toString();
        if (!productOffersMap[pid]) productOffersMap[pid] = [];
        productOffersMap[pid].push(op.offerId);
      }
    });

    return products.map((p) => {
      const pid = (p._id || p.id || "").toString();
      const activeOffers = productOffersMap[pid] || [];

      if (activeOffers.length === 0) return p;

      // Sort by priority (desc) then createdAt (desc)
      activeOffers.sort((a, b) => {
        if ((b.priority || 0) !== (a.priority || 0)) {
          return (b.priority || 0) - (a.priority || 0);
        }
        return new Date(b.createdAt) - new Date(a.createdAt);
      });

      const winningOffer = activeOffers[0];
      const offerType = winningOffer.offerType;

      let updatedVariation = p.variation;
      if (Array.isArray(p.variation)) {
        updatedVariation = p.variation.map((v) => {
          const base = Number(v.basePrice || 0);
          let discPrice = v.discountPrice;

          if (winningOffer.discountType === "percentage") {
            discPrice = Math.max(0, Math.round(base - (base * winningOffer.discountValue) / 100));
          } else if (winningOffer.discountType === "fixed") {
            discPrice = Math.max(0, Math.round(base - winningOffer.discountValue));
          }

          return {
            ...v,
            discountPrice: discPrice,
          };
        });
      }

      return {
        ...p,
        flag: offerType, // Dynamic flag for website rendering (flash-sale / just-for-you)
        discountType: winningOffer.discountType,
        discountValue: winningOffer.discountValue,
        variation: updatedVariation,
        activeOffer: {
          offerId: winningOffer.offerId,
          title: winningOffer.title,
          offerType: winningOffer.offerType,
          discountType: winningOffer.discountType,
          discountValue: winningOffer.discountValue,
        },
      };
    });
  } catch (err) {
    console.error("Error attaching active offers to products:", err);
    return products;
  }
};

// ─── Helper: extract all uploaded per-variation images from req.files (array format)
// When productUpload.any() is used, req.files is an array of {fieldname, path, ...}
// Field names are variation_0_images, variation_1_images, etc.
const extractVariationImages = (files) => {
  const variationImagesMap = {}; // { 0: [url1, url2], 1: [url3], ... }
  const allUploadedUrls = [];
  if (!Array.isArray(files)) return { variationImagesMap, allUploadedUrls };
  for (const file of files) {
    const match = file.fieldname.match(/^variation_(\d+)_images$/);
    if (match) {
      const idx = parseInt(match[1], 10);
      if (!variationImagesMap[idx]) variationImagesMap[idx] = [];
      variationImagesMap[idx].push(file.path);
      allUploadedUrls.push(file.path);
    }
  }
  return { variationImagesMap, allUploadedUrls };
};

// Create Product
const createProduct = asyncHandler(async (req, res) => {
  // Extract per-variation images from uploaded files
  const { variationImagesMap, allUploadedUrls } = extractVariationImages(req.files);

  try {
    const {
      name,
      description,
      category,
      subCategory,
      brand,
      vendor,
      vat,
      variation,
      isActive,
      flag,
      salesChannel,
    } = req.body;

    let parsedVariation = variation;
    if (typeof variation === "string") {
      parsedVariation = JSON.parse(variation);
    }

    // Extract requested stocks for purchase requests & initialize all variations with stock: 0
    const pendingPurchasesToCreate = [];
    if (Array.isArray(parsedVariation)) {
      parsedVariation = parsedVariation.map((v, idx) => {
        const requestedStock = (v.stock === "" || v.stock === null || v.stock === undefined || isNaN(Number(v.stock))) ? 0 : Math.max(0, Number(v.stock));
        const unitPurchasePrice = Number(v.purchasePrice || 0);

        if (requestedStock > 0) {
          pendingPurchasesToCreate.push({
            productSize: (v.size || "").trim(),
            productColor: (v.color || "").trim(),
            quantity: requestedStock,
            purchasePrice: unitPurchasePrice,
            totalCost: requestedStock * unitPurchasePrice,
            variationIdx: idx,
          });
        }

        return {
          ...v,
          sku: "", // Server-side SKU generation strictly enforces unique collision-free SKUs
          stock: 0, // Product stock strictly starts at 0 until approved by Admin in Stock Purchases!
          images: [
            ...(Array.isArray(v.images) ? v.images : []), // preserve any existing URLs sent in body
            ...(variationImagesMap[idx] || []),            // add newly uploaded files
          ],
        };
      });
    }

    // Legacy bannerImage fallback: use first image of first variation
    const legacyBannerImage =
      parsedVariation?.[0]?.images?.[0] || null;

    // Legacy images fallback: aggregate all variation images
    const legacyImages = (parsedVariation || []).flatMap(
      (v) => v.images || []
    );

    const cleanCategory = (category && category.trim() && category !== "none" && category !== "null") ? category : null;
    if (!cleanCategory) {
      return res.status(400).json({
        success: false,
        message: "Category is required",
      });
    }
    const cleanSubCategory = (subCategory && subCategory.trim() && subCategory !== "none" && subCategory !== "null") ? subCategory : null;
    const cleanBrand = (brand && brand.trim() && brand !== "none" && brand !== "null") ? brand : null;
    const cleanVendor = (vendor && vendor.trim() && vendor !== "none" && vendor !== "null") ? vendor : null;

    let sizeChartUrl = req.body.sizeChart || null;
    if (Array.isArray(req.files)) {
      const sizeChartFile = req.files.find((f) => f.fieldname === "sizeChart" || f.fieldname === "sizeChartImage");
      if (sizeChartFile) {
        sizeChartUrl = sizeChartFile.path;
      }
    }

    const createdProduct = await Product.create({
      name,
      description,
      category: cleanCategory,
      subCategory: cleanSubCategory,
      brand: cleanBrand,
      vendor: cleanVendor,
      vat: (vat !== undefined && vat !== null && !isNaN(Number(vat))) ? Math.max(0, Number(vat)) : 0,
      bannerImage: legacyBannerImage,
      images: legacyImages,
      sizeChart: sizeChartUrl,
      variation: parsedVariation,
      isActive: isActive === "true" || isActive === true,
      flag: (flag === "" || flag === "none") ? null : flag,
      salesChannel: salesChannel === "OFFLINE" ? "OFFLINE" : "BOTH",
      createdBy: req.user.id,
    });

    // Create pending Purchase requests for all variations with stock > 0
    if (pendingPurchasesToCreate.length > 0) {
      const batchId = `batch_${req.user.id || req.user._id}_${Date.now()}`;
      for (const pItem of pendingPurchasesToCreate) {
        const matchedVar = createdProduct.variation[pItem.variationIdx] || createdProduct.variation[0];
        const newPurchase = new Purchase({
          product: createdProduct._id,
          productName: createdProduct.name,
          productIdCode: createdProduct.productId || "",
          variationId: matchedVar?._id ? matchedVar._id.toString() : "",
          productSize: pItem.productSize,
          productColor: pItem.productColor,
          quantity: pItem.quantity,
          purchasePrice: pItem.purchasePrice,
          totalCost: pItem.totalCost,
          batchId,
          notes: `Initial stock purchase request (+${pItem.quantity} units) submitted via Product Creation by ${req.user.role?.toUpperCase() || "User"} "${req.user.name || "Staff"}"`,
          status: "pending",
          createdBy: req.user.id || req.user._id,
          createdByName: req.user.name || "Staff",
          createdByRole: req.user.role,
        });
        await newPurchase.save();
      }
    }

    const populatedProduct = await Product.findById(createdProduct._id)
      .populate("category", "name categoryId description image isActive")
      .populate("subCategory", "name subCategoryId description image isActive")
      .populate("brand", "name brandId description image isActive")
      .populate("vendor", "name vendorId phone isActive")
      .populate("createdBy", "name email");

    logActivity({
      req,
      action: "CREATE_PRODUCT",
      entityType: "Product",
      entityId: populatedProduct.productId || populatedProduct._id,
      description: `Created new product: ${populatedProduct.name} (${populatedProduct.productId || ""})${pendingPurchasesToCreate.length > 0 ? " (Stock pending Admin approval)" : ""}`,
      metadata: { productId: populatedProduct.productId, name: populatedProduct.name, pendingPurchases: pendingPurchasesToCreate.length }
    });

    res.status(201).json({
      success: true,
      message: pendingPurchasesToCreate.length > 0
        ? `Product created with 0 initial stock. Stock purchase request for ${pendingPurchasesToCreate.length} variation(s) sent to Stock Purchases page for Admin approval.`
        : "Product created successfully",
      data: populatedProduct,
    });
  } catch (error) {
    // If an error occurs, delete ALL uploaded variation images from Cloudinary
    for (const imageUrl of allUploadedUrls) {
      const publicId = extractPublicIdFromUrl(imageUrl);
      if (publicId) await deleteImageFromCloudinary(publicId);
    }
    // Re-throw the error to be handled by the global error handler
    throw error;
  }
});

// Get All Products (active only)
// Get All Products (active only) - with Pagination, Filtering, Sorting
const getAllProducts = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 12,
    pagination,
    category,
    subCategory,
    brand,
    vendor,
    size,
    color,
    minPrice,
    maxPrice,
    sort,
    search,
    flag,
  } = req.query;

  // Build Filter
  const filter = { isActive: true };

  // Vendor Filter (Supports custom vendorId like VDR-00001, Vendor Name, or Mongo ObjectId)
  if (vendor && vendor !== "All") {
    const VendorModel = require("../models/Vendor");
    let matchedVendor = null;

    if (vendor.match(/^[0-9a-fA-F]{24}$/)) {
      filter.vendor = new mongoose.Types.ObjectId(vendor);
    } else {
      matchedVendor = await VendorModel.findOne({
        $or: [
          { vendorId: new RegExp(`^${vendor}$`, "i") },
          { name: new RegExp(`^${vendor}$`, "i") },
        ],
      }).select("_id").lean();

      if (matchedVendor) {
        filter.vendor = matchedVendor._id;
      }
    }
  }

  // Exclude OFFLINE-only products for website customers (only show BOTH)
  if (!req.user || !["admin", "manager", "employee"].includes(req.user?.role)) {
    filter.salesChannel = { $ne: "OFFLINE" };
  }

  if (flag) {
    try {
      const Offer = require("../models/Offer");
      const OfferProduct = require("../models/OfferProduct");
      const now = new Date();

      const activeOffers = await Offer.find({
        offerType: flag,
        isActive: true,
        deletedAt: null,
        startDate: { $lte: now },
        endDate: { $gte: now },
      }).select("_id").lean();

      const activeOfferIds = activeOffers.map((o) => o._id);
      const offerProductDocs = await OfferProduct.find({
        offerId: { $in: activeOfferIds },
      }).select("productId").lean();

      const offerProductIds = offerProductDocs.map((op) => op.productId);

      filter.$or = [
        { flag: flag },
        { _id: { $in: offerProductIds } },
      ];
    } catch (err) {
      console.error("Error building offer flag filter:", err);
      filter.flag = flag;
    }
  }

  // Search (by Name, Description, Product ID, SKU, Barcode, Variation SKU)
  if (search) {
    const searchConditions = [
      { name: { $regex: search, $options: "i" } },
      { description: { $regex: search, $options: "i" } },
      { productId: { $regex: search, $options: "i" } },
      { sku: { $regex: search, $options: "i" } },
      { barcode: { $regex: search, $options: "i" } },
      { "variation.sku": { $regex: search, $options: "i" } },
    ];
    if (filter.$or) {
      const existingOr = filter.$or;
      delete filter.$or;
      filter.$and = [{ $or: existingOr }, { $or: searchConditions }];
    } else {
      filter.$or = searchConditions;
    }
  }

  // Category Filter (Supports single or comma-separated names/IDs)
  if (category && category !== "All") {
    const catList = (Array.isArray(category) ? category : category.split(",")).map((c) => c.trim()).filter(Boolean);
    const catObjectIds = [];
    const catNames = [];
    catList.forEach((c) => {
      if (c.match(/^[0-9a-fA-F]{24}$/)) catObjectIds.push(new mongoose.Types.ObjectId(c));
      else catNames.push(c);
    });
    if (catNames.length > 0) {
      const CategoryModel = require("../models/Category");
      const matchedCats = await CategoryModel.find({ name: { $in: catNames.map((n) => new RegExp(`^${n}$`, "i")) } }).select("_id").lean();
      matchedCats.forEach((mc) => catObjectIds.push(mc._id));
    }
    if (catObjectIds.length > 0) {
      filter.category = { $in: catObjectIds };
    }
  }

  // SubCategory Filter (Supports single or comma-separated names/IDs)
  if (subCategory && subCategory !== "All") {
    const subCatList = (Array.isArray(subCategory) ? subCategory : subCategory.split(",")).map((sc) => sc.trim()).filter(Boolean);
    const subCatObjectIds = [];
    const subCatNames = [];
    subCatList.forEach((sc) => {
      if (sc.match(/^[0-9a-fA-F]{24}$/)) subCatObjectIds.push(new mongoose.Types.ObjectId(sc));
      else subCatNames.push(sc);
    });
    if (subCatNames.length > 0) {
      const SubCategoryModel = require("../models/SubCategory");
      const matchedSubCats = await SubCategoryModel.find({ name: { $in: subCatNames.map((n) => new RegExp(`^${n}$`, "i")) } }).select("_id").lean();
      matchedSubCats.forEach((msc) => subCatObjectIds.push(msc._id));
    }
    if (subCatObjectIds.length > 0) {
      filter.subCategory = { $in: subCatObjectIds };
    }
  }

  // Brand Filter (Supports single or comma-separated names/IDs)
  if (brand && brand !== "All") {
    const brandList = (Array.isArray(brand) ? brand : brand.split(",")).map((b) => b.trim()).filter(Boolean);
    const brandObjectIds = [];
    const brandNames = [];
    brandList.forEach((b) => {
      if (b.match(/^[0-9a-fA-F]{24}$/)) brandObjectIds.push(new mongoose.Types.ObjectId(b));
      else brandNames.push(b);
    });
    if (brandNames.length > 0) {
      const BrandModel = require("../models/Brand");
      const matchedBrands = await BrandModel.find({ name: { $in: brandNames.map((n) => new RegExp(`^${n}$`, "i")) } }).select("_id").lean();
      matchedBrands.forEach((mb) => brandObjectIds.push(mb._id));
    }
    if (brandObjectIds.length > 0) {
      filter.brand = { $in: brandObjectIds };
    }
  }

  // Size Filter
  if (size) {
    const sizeItems = (Array.isArray(size) ? size : size.split(",")).map((s) => s.trim()).filter(Boolean);
    if (sizeItems.length > 0) {
      filter["variation.size"] = { $in: sizeItems.map((s) => new RegExp(`^${s}$`, "i")) };
    }
  }

  // Color Filter
  if (color) {
    const colorItems = (Array.isArray(color) ? color : color.split(",")).map((c) => c.trim()).filter(Boolean);
    if (colorItems.length > 0) {
      filter["variation.color"] = { $in: colorItems.map((c) => new RegExp(`^${c}$`, "i")) };
    }
  }

  // Price Filter (check variation prices)
  if (minPrice || maxPrice) {
    const pMin = minPrice ? Number(minPrice) : 0;
    const pMax = maxPrice ? Number(maxPrice) : Infinity;
    filter.$and = filter.$and || [];
    const priceCondition = { $gte: pMin };
    if (pMax < Infinity) priceCondition.$lte = pMax;
    filter.$and.push({ "variation.basePrice": priceCondition });
  }

  // Sort Logic
  let sortOption = {};
  switch (sort) {
    case "price-low":
      sortOption = { "variation.0.basePrice": 1 };
      break;
    case "price-high":
      sortOption = { "variation.0.basePrice": -1 };
      break;
    case "newest":
      sortOption = { createdAt: -1 };
      break;
    case "rating":
      sortOption = { rating: -1 };
      break;
    default:
      sortOption = { updatedAt: -1, createdAt: -1 }; // Default: Recently updated/created first
  }

  // If pagination is explicitly disabled, return all matching products
  if (pagination === "false") {
    const products = await Product.find(filter)
      .populate("category", "name categoryId description image isActive")
      .populate("subCategory", "name subCategoryId description image isActive")
      .populate("brand", "name brandId description image isActive")
      .populate("vendor", "name vendorId phone isActive")
      .populate("createdBy", "name")
      .sort(sortOption);

    const total = products.length;
    let filteredProducts = filterSensitivePrices(products, req.user?.role);
    filteredProducts = await attachActiveOffersToProducts(filteredProducts);

    return res.status(200).json({
      success: true,
      data: filteredProducts,
      pagination: {
        currentPage: 1,
        totalPages: 1,
        totalItems: total,
        limit: total,
        hasNextPage: false,
        hasPrevPage: false,
      },
    });
  }

  // Execute Query with Pagination
  const skip = (parseInt(page) - 1) * parseInt(limit);

  const products = await Product.find(filter)
    .populate("category", "name categoryId description image isActive")
    .populate("subCategory", "name subCategoryId description image isActive")
    .populate("brand", "name brandId description image isActive")
    .populate("vendor", "name vendorId phone isActive")
    .populate("createdBy", "name")
    .sort(sortOption)
    .skip(skip)
    .limit(parseInt(limit));

  const total = await Product.countDocuments(filter);
  let filteredProducts = filterSensitivePrices(products, req.user?.role);
  filteredProducts = await attachActiveOffersToProducts(filteredProducts);

  res.status(200).json({
    success: true,
    data: filteredProducts,
    pagination: {
      currentPage: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
      totalItems: total,
      limit: parseInt(limit),
      hasNextPage: parseInt(page) < Math.ceil(total / parseInt(limit)),
      hasPrevPage: parseInt(page) > 1,
    },
  });
});

// Get All Products for Admin (including inactive)
const getAllProductsAdmin = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, pagination, isActive, vendor, brand, q, specificDate, startDate, endDate, period } = req.query;

  // Build filter
  const filter = {};
  if (isActive === "true") filter.isActive = true;
  else if (isActive === "false") filter.isActive = false;

  // Category Filter
  if (req.query.category && req.query.category !== "all" && req.query.category !== "All") {
    if (req.query.category.match(/^[0-9a-fA-F]{24}$/)) {
      filter.category = new mongoose.Types.ObjectId(req.query.category);
    } else {
      filter.category = req.query.category;
    }
  }

  // SubCategory Filter
  if (req.query.subCategory && req.query.subCategory !== "all" && req.query.subCategory !== "All") {
    if (req.query.subCategory.match(/^[0-9a-fA-F]{24}$/)) {
      filter.subCategory = new mongoose.Types.ObjectId(req.query.subCategory);
    } else {
      filter.subCategory = req.query.subCategory;
    }
  }

  // Vendor Filter (Supports custom vendorId like VDR-00001, Vendor Name, or Mongo ObjectId)
  if (vendor && vendor !== "All" && vendor !== "all") {
    if (vendor.match(/^[0-9a-fA-F]{24}$/)) {
      filter.vendor = new mongoose.Types.ObjectId(vendor);
    } else {
      const VendorModel = require("../models/Vendor");
      const matchedVendor = await VendorModel.findOne({
        $or: [
          { vendorId: new RegExp(`^${vendor}$`, "i") },
          { name: new RegExp(`^${vendor}$`, "i") },
        ],
      }).select("_id").lean();

      if (matchedVendor) {
        filter.vendor = matchedVendor._id;
      } else {
        filter._id = null; // Return empty list safely if vendor not found without crashing
      }
    }
  }
  if (brand && brand !== "all" && brand !== "All") filter.brand = brand;
  if (q && q.trim()) {
    const regex = new RegExp(q.trim(), "i");
    filter.$and = (filter.$and || []).concat([
      { $or: [{ name: regex }, { productId: regex }] }
    ]);
  }

  // Date Filtering (checks updatedAt or createdAt)
  if (specificDate) {
    const dateObj = new Date(specificDate);
    const nextDate = new Date(dateObj);
    nextDate.setDate(nextDate.getDate() + 1);
    const dateFilterCond = { $gte: dateObj, $lt: nextDate };
    filter.$and = (filter.$and || []).concat([
      {
        $or: [
          { updatedAt: dateFilterCond },
          { createdAt: dateFilterCond }
        ]
      }
    ]);
  } else if (startDate || endDate) {
    const dateRangeCond = {};
    if (startDate) dateRangeCond.$gte = new Date(startDate);
    if (endDate) {
      const eDate = new Date(endDate);
      eDate.setHours(23, 59, 59, 999);
      dateRangeCond.$lte = eDate;
    }
    filter.$and = (filter.$and || []).concat([
      {
        $or: [
          { updatedAt: dateRangeCond },
          { createdAt: dateRangeCond }
        ]
      }
    ]);
  } else if (period) {
    const now = new Date();
    let periodStartDate;
    switch (period) {
      case "daily":
        periodStartDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case "weekly":
        periodStartDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "monthly":
        periodStartDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case "yearly":
        periodStartDate = new Date(now.getFullYear(), 0, 1);
        break;
      default:
        periodStartDate = null;
    }
    if (periodStartDate) {
      filter.$and = (filter.$and || []).concat([
        {
          $or: [
            { updatedAt: { $gte: periodStartDate } },
            { createdAt: { $gte: periodStartDate } }
          ]
        }
      ]);
    }
  }

  if (pagination === "false") {
    const products = await Product.find(filter)
      .populate("category", "name categoryId description image isActive")
      .populate("subCategory", "name subCategoryId description image isActive")
      .populate("brand", "name brandId description image isActive")
      .populate("vendor", "name vendorId phone isActive")
      .populate("createdBy", "name")
      .sort({ updatedAt: -1, createdAt: -1 });

    const total = products.length;
    const filteredProducts = filterSensitivePrices(products, req.user?.role);
    return res.status(200).json({
      success: true,
      data: filteredProducts,
      total,
    });
  }

  const pageNum = parseInt(page) || 1;
  const limitNum = parseInt(limit) || 10;
  const skip = (pageNum - 1) * limitNum;

  const [products, total, activeCount, inactiveCount] = await Promise.all([
    Product.find(filter)
      .populate("category", "name categoryId description image isActive")
      .populate("subCategory", "name subCategoryId description image isActive")
      .populate("brand", "name brandId description image isActive")
      .populate("vendor", "name vendorId phone isActive")
      .populate("createdBy", "name")
      .sort({ updatedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(limitNum),
    Product.countDocuments(filter),
    Product.countDocuments({ isActive: true }),
    Product.countDocuments({ isActive: false }),
  ]);

  const filteredProducts = filterSensitivePrices(products, req.user?.role);

  const stats = {
    total,
    activeCount,
    inactiveCount,
  };

  res.status(200).json({
    success: true,
    data: filteredProducts,
    stats,
    pagination: {
      currentPage: pageNum,
      totalPages: Math.ceil(total / limitNum) || 1,
      totalItems: total,
      total,
      limit: limitNum,
      hasNextPage: pageNum < Math.ceil(total / limitNum),
      hasPrevPage: pageNum > 1,
    },
  });
});

// Get products with zero stock in any variation (for Admin/Employee)
const getZeroStockProducts = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, isActive, q } = req.query;
  const skip = (parseInt(page) - 1) * parseInt(limit);

  // Build filter
  const filter = {
    "variation.stock": 0,
  };
  if (isActive === "true") filter.isActive = true;
  else if (isActive === "false") filter.isActive = false;

  if (q && q.trim()) {
    const regex = new RegExp(q.trim(), "i");
    filter.$or = [
      { name: regex },
      { productId: regex },
      { description: regex },
    ];
  }

  // Find products where at least one variation has a stock of 0
  const products = await Product.find(filter)
    .populate("category", "name categoryId isActive")
    .populate("subCategory", "name subCategoryId isActive")
    .populate("brand", "name brandId isActive")
    .populate("vendor", "name vendorId phone isActive")
    .populate("createdBy", "name")
    .sort({ updatedAt: -1, createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit));

  const total = await Product.countDocuments(filter);

  if (!products || products.length === 0) {
    return res.status(200).json({
      success: true,
      message: "No products with zero stock found.",
      data: [],
      pagination: {
        currentPage: parseInt(page),
        totalPages: 0,
        total: 0,
        limit: parseInt(limit),
      },
    });
  }

  const filteredProducts = filterSensitivePrices(products, "admin");

  const [activeProducts, inactiveProducts] = await Promise.all([
    Product.countDocuments({ ...filter, isActive: true }),
    Product.countDocuments({ ...filter, isActive: false }),
  ]);

  const stats = {
    totalOutOfStock: total,
    total,
    activeProducts,
    inactiveProducts,
  };

  res.status(200).json({
    success: true,
    data: filteredProducts,
    stats,
    pagination: {
      currentPage: parseInt(page),
      totalPages: Math.ceil(total / parseInt(limit)),
      total,
      limit: parseInt(limit),
    },
  });
});

// Get Product by ID
const getProductById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Build a query that can find the product by either its custom productId or its MongoDB _id.
  // This makes the endpoint more flexible.
  const query = mongoose.Types.ObjectId.isValid(id)
    ? { $or: [{ _id: id }, { productId: id }] }
    : { productId: id };

  const product = await Product.findOne(query)
    .populate("category", "name categoryId description image isActive")
    .populate("subCategory", "name subCategoryId description image isActive")
    .populate("brand", "name brandId description image isActive")
    .populate("vendor", "name vendorId phone isActive")
    .populate("createdBy", "name");

  if (!product) {
    return res
      .status(404)
      .json({ success: false, message: "Product not found" });
  }

  // Hide OFFLINE-only products from public website customers
  if (product.salesChannel === "OFFLINE" && (!req.user || !["admin", "manager", "employee"].includes(req.user?.role))) {
    return res
      .status(404)
      .json({ success: false, message: "This product is only available at our physical shop counter." });
  }

  // Apply price field filtering using helper function
  let filteredProduct = filterSensitivePrices(product, req.user?.role);
  filteredProduct = await attachActiveOffersToProducts(filteredProduct);

  res.status(200).json({ success: true, data: filteredProduct[0] });
});

const normalizeVariations = (vars) => {
  if (!Array.isArray(vars)) return [];
  return vars.map((v) => ({
    size: String(v.size || "").trim(),
    color: String(v.color || "").trim(),
    sku: String(v.sku || "").trim(),
    stock: Number(v.stock || 0),
    purchasePrice: Number(v.purchasePrice || 0),
    basePrice: Number(v.basePrice || 0),
    discountPrice: Number(v.discountPrice || 0),
  }));
};

// Update Product
const updateProduct = asyncHandler(async (req, res) => {
  console.log("🔍 Update Product Request:");
  console.log("Product ID:", req.params.id);
  console.log("Request Body:", req.body);
  console.log("Files:", req.files);

  const product = await Product.findOne({ productId: req.params.id });
  if (!product)
    return res
      .status(404)
      .json({ success: false, message: "Product not found" });

  const origCategory = product.category?._id ? String(product.category._id) : (product.category ? String(product.category) : null);
  const origSubCategory = product.subCategory?._id ? String(product.subCategory._id) : (product.subCategory ? String(product.subCategory) : null);
  const origBrand = product.brand?._id ? String(product.brand._id) : (product.brand ? String(product.brand) : null);
  const origVendor = product.vendor?._id ? String(product.vendor._id) : (product.vendor ? String(product.vendor) : null);

  const originalState = {
    name: String(product.name || "").trim(),
    description: String(product.description || "").trim(),
    category: origCategory,
    subCategory: origSubCategory,
    brand: origBrand,
    vendor: origVendor,
    flag: product.flag || null,
    isActive: Boolean(product.isActive),
    origVars: normalizeVariations(product.variation),
  };

  // Extract per-variation images from uploaded files
  const { variationImagesMap, allUploadedUrls } = extractVariationImages(req.files);

  // Parse variation if it's a string
  let parsedVariation = req.body.variation;
  if (typeof req.body.variation === "string") {
    try {
      parsedVariation = JSON.parse(req.body.variation);
    } catch (err) {
      console.error("❌ Error parsing variations JSON:", err.message);
      return res.status(400).json({
        success: false,
        message: "Invalid variations format. Please provide valid JSON array.",
        error: "Variation data must be a valid JSON array",
      });
    }
  }

  // Validate variations - ensure at least one variation exists
  if (parsedVariation && Array.isArray(parsedVariation)) {
    if (parsedVariation.length === 0) {
      return res.status(400).json({
        success: false,
        message:
          "Product must have at least one variation (size/color/stock combination)",
        error:
          "Cannot save product without variations. Please add at least one variation.",
      });
    }

    // Coerce and validate each variation numeric fields
    for (let i = 0; i < parsedVariation.length; i++) {
      const v = parsedVariation[i];
      const purPrice = Number(v.purchasePrice);
      const bPrice = Number(v.basePrice);
      const stk = Number(v.stock);

      if (isNaN(purPrice) || isNaN(bPrice) || isNaN(stk)) {
        return res.status(400).json({
          success: false,
          message:
            "Each variation must have valid purchasePrice, basePrice, and stock",
          error:
            "Invalid variation data - missing or invalid price/stock fields",
        });
      }

      v.purchasePrice = purPrice;
      v.basePrice = bPrice;
      v.stock = Math.max(0, stk);
      if (v.discountPrice !== undefined && v.discountPrice !== null && v.discountPrice !== "") {
        const disc = Number(v.discountPrice);
        v.discountPrice = isNaN(disc) ? undefined : disc;
      }
    }
  }

  // Handle images marked for removal (array of Cloudinary URLs to delete)
  let removeVariationImages = req.body.removeVariationImages;
  if (typeof removeVariationImages === "string") {
    try {
      removeVariationImages = JSON.parse(removeVariationImages);
    } catch {
      removeVariationImages = [];
    }
  }

  // Collect all old image URLs from the product variations in database before updating
  // Note: sizeChart is an independent product field, NOT a variation image, so it is managed separately below
  const oldProductImageUrls = new Set();
  if (product.bannerImage) oldProductImageUrls.add(product.bannerImage);
  if (Array.isArray(product.images)) {
    product.images.forEach((img) => img && oldProductImageUrls.add(img));
  }
  if (Array.isArray(product.variation)) {
    product.variation.forEach((v) => {
      if (Array.isArray(v.images)) {
        v.images.forEach((img) => img && oldProductImageUrls.add(img));
      }
    });
  }

  const deletedImageUrls = new Set();

  // Delete explicitly requested removeVariationImages from Cloudinary first
  if (Array.isArray(removeVariationImages) && removeVariationImages.length > 0) {
    for (const imageUrl of removeVariationImages) {
      if (imageUrl && typeof imageUrl === "string") {
        deletedImageUrls.add(imageUrl);
        const publicId = extractPublicIdFromUrl(imageUrl);
        if (publicId) {
          try {
            await deleteImageFromCloudinary(publicId);
          } catch (err) {
            console.error("Error deleting requested image from Cloudinary:", imageUrl, err);
          }
        }
      }
    }
  }

  // Merge variation images: existing (from parsedVariation) + newly uploaded files
  if (Array.isArray(parsedVariation)) {
    parsedVariation = parsedVariation.map((v, idx) => {
      // Get existing images from the submitted variation data (already filtered of removed ones)
      const existingImages = Array.isArray(v.images) ? v.images.filter(Boolean) : [];
      const newImages = variationImagesMap[idx] || [];

      return {
        ...v,
        images: [...existingImages, ...newImages],
      };
    });
  }

  // Find any remaining orphaned image URLs that are no longer part of the updated variations
  const newKeptImageUrls = new Set();
  if (Array.isArray(parsedVariation)) {
    parsedVariation.forEach((v) => {
      if (Array.isArray(v.images)) {
        v.images.forEach((img) => img && newKeptImageUrls.add(img));
      }
    });
  }

  for (const oldUrl of oldProductImageUrls) {
    if (!newKeptImageUrls.has(oldUrl) && !deletedImageUrls.has(oldUrl)) {
      deletedImageUrls.add(oldUrl);
      const publicId = extractPublicIdFromUrl(oldUrl);
      if (publicId) {
        try {
          await deleteImageFromCloudinary(publicId);
        } catch (err) {
          console.error("Error deleting orphaned product image:", oldUrl, err);
        }
      }
    }
  }

  // Update fields
  const updateData = { ...req.body };

  if (updateData.category !== undefined) {
    updateData.category = (updateData.category && updateData.category.trim() && updateData.category !== "none" && updateData.category !== "null") ? updateData.category : null;
    if (!updateData.category) {
      return res.status(400).json({
        success: false,
        message: "Category is required",
      });
    }
  }
  if (updateData.subCategory !== undefined) {
    updateData.subCategory = (updateData.subCategory && updateData.subCategory.trim() && updateData.subCategory !== "none" && updateData.subCategory !== "null") ? updateData.subCategory : null;
  }
  if (updateData.brand !== undefined) {
    updateData.brand = (updateData.brand && updateData.brand.trim() && updateData.brand !== "none" && updateData.brand !== "null") ? updateData.brand : null;
  }
  if (updateData.vendor !== undefined) {
    updateData.vendor = (updateData.vendor && updateData.vendor.trim() && updateData.vendor !== "none" && updateData.vendor !== "null") ? updateData.vendor : null;
  }
  if (updateData.vat !== undefined) {
    updateData.vat = (updateData.vat !== null && !isNaN(Number(updateData.vat))) ? Math.max(0, Number(updateData.vat)) : 0;
  }

  // Size Chart Image handling:
  // 1. If a new sizeChart file was uploaded, use its uploaded path
  // 2. Otherwise if req.body.sizeChart was sent as string:
  //    - empty string / 'null' means explicitly removed -> set to null
  //    - non-empty URL string means kept -> preserve it
  let newSizeChart = undefined;

  if (Array.isArray(req.files)) {
    const sizeChartFile = req.files.find(
      (f) => f.fieldname === "sizeChart" || f.fieldname === "sizeChartImage"
    );
    if (sizeChartFile) {
      newSizeChart = sizeChartFile.path;
    }
  }

  if (newSizeChart === undefined && req.body.sizeChart !== undefined) {
    const trimmed = typeof req.body.sizeChart === "string" ? req.body.sizeChart.trim() : "";
    newSizeChart = (trimmed && trimmed !== "null" && trimmed !== "undefined") ? trimmed : null;
  }

  if (newSizeChart !== undefined) {
    updateData.sizeChart = newSizeChart;

    // If sizeChart is replaced or removed, delete the old sizeChart image from Cloudinary
    if (product.sizeChart && product.sizeChart !== newSizeChart) {
      const oldPublicId = extractPublicIdFromUrl(product.sizeChart);
      if (oldPublicId) {
        console.log(`🗑️ Deleting previous sizeChart image from Cloudinary: ${oldPublicId}`);
        try {
          await deleteImageFromCloudinary(oldPublicId);
        } catch (err) {
          console.error("Error deleting old size chart image from Cloudinary:", err);
        }
      }
    }
  }

  // Update legacy bannerImage to first image of first variation (if available)
  if (parsedVariation && parsedVariation.length > 0) {
    const firstVariationImage = parsedVariation[0]?.images?.[0];
    if (firstVariationImage) {
      updateData.bannerImage = firstVariationImage;
    }
    // Update legacy images array
    updateData.images = parsedVariation.flatMap((v) => v.images || []);
  }

  // Stock Purchase Interceptor (For ALL roles: Admin, Manager, Employee):
  // When editing a product, existing variation stocks are 100% safely preserved.
  let createdPurchaseCount = 0;
  const purchasesToSave = [];
  if (Array.isArray(parsedVariation)) {
    parsedVariation = parsedVariation.map((v, idx) => {
      // Robust lookup of original variation from DB by _id, sku, or size/color
      const origVar = (product.variation || []).find((ov) => {
        if (v._id && ov._id && ov._id.toString() === v._id.toString()) return true;
        if (v.sku && ov.sku && String(ov.sku).trim().toLowerCase() === String(v.sku).trim().toLowerCase()) return true;
        const sizeMatch = String(ov.size || "").trim().toLowerCase() === String(v.size || "").trim().toLowerCase();
        const colorMatch = String(ov.color || "").trim().toLowerCase() === String(v.color || "").trim().toLowerCase();
        return sizeMatch && colorMatch;
      }) || (originalState.origVars && originalState.origVars[idx]) || (product.variation && product.variation[idx]) || {};

      const oldStock = Number(origVar.stock) || 0;
      const requestedStock = Number(v.stock) || 0;

      if (requestedStock > oldStock) {
        const qtyAdded = requestedStock - oldStock;
        const unitPrice = Number(v.purchasePrice || origVar.purchasePrice || 0);

        const newPurchase = new Purchase({
          product: product._id,
          productName: product.name,
          productIdCode: product.productId || "",
          variationId: v._id || origVar._id || "",
          productSize: (v.size || origVar.size || "").trim(),
          productColor: (v.color || origVar.color || "").trim(),
          quantity: qtyAdded,
          purchasePrice: unitPrice,
          totalCost: qtyAdded * unitPrice,
          notes: `Stock purchase request (+${qtyAdded} units) submitted via Inventory edit by ${req.user.role?.toUpperCase() || "User"} "${req.user.name || "Staff"}"`,
          status: "pending",
          createdBy: req.user.id || req.user._id,
          createdByName: req.user.name || "Staff",
          createdByRole: req.user.role,
        });

        purchasesToSave.push(newPurchase);
        createdPurchaseCount++;
      }

      // Preserve original SKU once set (cannot be modified after initial creation)
      const lockedSku = (origVar.sku && String(origVar.sku).trim()) ? origVar.sku : (v.sku || "");

      // Preserve old existing stock! (Existing stock is NEVER wiped to 0 on edit)
      return {
        ...v,
        sku: lockedSku,
        stock: oldStock,
      };
    });
  }

  if (purchasesToSave.length > 0) {
    for (const pDoc of purchasesToSave) {
      await pDoc.save();
    }
  }

  if (parsedVariation) updateData.variation = parsedVariation;
  if (req.body.isActive !== undefined) {
    updateData.isActive =
      req.body.isActive === "true" || req.body.isActive === true;
  }
  if (req.body.flag !== undefined) {
    updateData.flag = (req.body.flag === "" || req.body.flag === "none" || req.body.flag === null) ? null : req.body.flag;
  }
  if (req.body.salesChannel !== undefined) {
    updateData.salesChannel = req.body.salesChannel === "OFFLINE" ? "OFFLINE" : "BOTH";
  }

  // Remove fields that shouldn't be in updateData
  delete updateData.removeVariationImages;

  Object.assign(product, updateData);
  await product.save();

  console.log("✅ Product updated successfully:", product.productId);

  // Populate and return updated product
  const populatedProduct = await Product.findById(product._id)
    .populate("category", "name categoryId description image isActive")
    .populate("subCategory", "name subCategoryId description image isActive")
    .populate("brand", "name brandId description image isActive")
    .populate("vendor", "name vendorId phone isActive")
    .populate("createdBy", "name");

  if (createdPurchaseCount > 0) {
    return res.status(200).json({
      success: true,
      message: `Stock purchase request for ${createdPurchaseCount} variation(s) submitted to Stock Purchases page for Admin approval. Product stock remains at current level until approved.`,
      data: populatedProduct,
    });
  }

  const productChanges = [];
  if (req.body.name !== undefined && String(req.body.name).trim() !== originalState.name) productChanges.push("name");
  if (req.body.description !== undefined && String(req.body.description).trim() !== originalState.description) productChanges.push("description");
  if (updateData.category !== undefined && String(updateData.category || "") !== String(originalState.category || "")) productChanges.push("category");
  if (updateData.subCategory !== undefined && String(updateData.subCategory || "") !== String(originalState.subCategory || "")) productChanges.push("subCategory");
  if (updateData.brand !== undefined && String(updateData.brand || "") !== String(originalState.brand || "")) productChanges.push("brand");
  if (updateData.vendor !== undefined && String(updateData.vendor || "") !== String(originalState.vendor || "")) productChanges.push("vendor");
  if (updateData.flag !== undefined && updateData.flag !== originalState.flag) productChanges.push("flag");
  if (updateData.isActive !== undefined && Boolean(updateData.isActive) !== originalState.isActive) productChanges.push("status");
  
  if (parsedVariation && Array.isArray(parsedVariation)) {
    const newVars = normalizeVariations(parsedVariation);

    // 1. Check stock change
    const isStockChanged = newVars.some((nv, i) => {
      const ov = originalState.origVars[i];
      if (!ov) return true;
      return ov.stock !== nv.stock;
    }) || newVars.length !== originalState.origVars.length;
    if (isStockChanged) {
      productChanges.push("stock");
    }

    // 2. Check price change (purchasePrice, basePrice, discountPrice)
    const isPriceChanged = newVars.some((nv, i) => {
      const ov = originalState.origVars[i];
      if (!ov) return true;
      return (
        ov.purchasePrice !== nv.purchasePrice ||
        ov.basePrice !== nv.basePrice ||
        ov.discountPrice !== nv.discountPrice
      );
    });
    if (isPriceChanged) {
      productChanges.push("price");
    }

    // 3. Check variation attributes (size, color, SKU)
    const isVarAttrChanged = newVars.some((nv, i) => {
      const ov = originalState.origVars[i];
      if (!ov) return true;
      return ov.size !== nv.size || ov.color !== nv.color || ov.sku !== nv.sku;
    });
    if (isVarAttrChanged) {
      productChanges.push("variation");
    }
  }

  if (
    (req.files && (req.files.bannerImage || req.files.images || (Array.isArray(req.files) && req.files.length > 0) || (allUploadedUrls && allUploadedUrls.length > 0))) ||
    (deletedImageUrls && deletedImageUrls.size > 0)
  ) {
    productChanges.push("image");
  }

  if (productChanges.length === 0) {
    productChanges.push("details");
  }

  const productChangeSummary = ` (${productChanges.join(", ")})`;

  const oldProductSummary = {
    name: originalState.name,
    category: originalState.category,
    subCategory: originalState.subCategory,
    brand: originalState.brand,
    vendor: originalState.vendor,
    flag: originalState.flag,
    isActive: originalState.isActive,
    variations: originalState.origVars,
  };

  const newProductSummary = {
    name: populatedProduct.name,
    category: populatedProduct.category?.name || populatedProduct.category,
    subCategory: populatedProduct.subCategory?.name || populatedProduct.subCategory,
    brand: populatedProduct.brand?.name || populatedProduct.brand,
    vendor: populatedProduct.vendor?.name || populatedProduct.vendor,
    flag: populatedProduct.flag,
    isActive: populatedProduct.isActive,
    variations: populatedProduct.variation?.map((v) => ({
      size: v.size,
      color: v.color,
      stock: v.stock,
      basePrice: v.basePrice,
      purchasePrice: v.purchasePrice,
    })),
  };

  logActivity({
    req,
    action: "UPDATE_PRODUCT",
    entityType: "Product",
    entityId: populatedProduct.productId || populatedProduct._id,
    description: `Updated product '${populatedProduct.name}'${productChangeSummary}`,
    oldValues: oldProductSummary,
    newValues: newProductSummary,
    metadata: { productId: populatedProduct.productId, name: populatedProduct.name, updatedFields: productChanges }
  });

  res.status(200).json({
    success: true,
    message: "Product updated successfully. You can now generate barcodes.",
    data: populatedProduct,
  });
});

// Delete Product (Hard Delete)
const deleteProduct = asyncHandler(async (req, res) => {
  // Find the product by its custom productId first
  const product = await Product.findOne({ productId: req.params.id });

  if (!product) {
    return res
      .status(404)
      .json({ success: false, message: "Product not found" });
  }

  // 1. Collect all Cloudinary image URLs for this product
  const imagesToDelete = new Set();
  if (product.bannerImage) imagesToDelete.add(product.bannerImage);
  if (product.sizeChart) imagesToDelete.add(product.sizeChart);

  if (Array.isArray(product.images) && product.images.length > 0) {
    product.images.forEach((img) => img && imagesToDelete.add(img));
  }

  if (Array.isArray(product.variation) && product.variation.length > 0) {
    product.variation.forEach((v) => {
      if (Array.isArray(v.images) && v.images.length > 0) {
        v.images.forEach((img) => img && imagesToDelete.add(img));
      }
    });
  }

  // 2. Delete ALL images from Cloudinary FIRST
  console.log(`🗑️ Deleting ${imagesToDelete.size} images from Cloudinary FIRST...`);
  for (const imageUrl of imagesToDelete) {
    try {
      const publicId = extractPublicIdFromUrl(imageUrl);
      if (publicId) {
        await deleteImageFromCloudinary(publicId);
      }
    } catch (cloudinaryErr) {
      console.error("❌ Error deleting image from Cloudinary:", imageUrl, cloudinaryErr);
    }
  }

  // 3. Delete product document from database AFTER Cloudinary cleanup
  await Product.findByIdAndDelete(product._id);

  logActivity({
    req,
    action: "DELETE_PRODUCT",
    entityType: "Product",
    entityId: product.productId || product._id,
    description: `Permanently deleted product: ${product.name} (${product.productId || ""})`,
    metadata: { productId: product.productId, name: product.name }
  });

  const count = await Product.countDocuments();
  await Counter.findOneAndUpdate(
    { _id: "Product" },
    { seq: count },
    { upsert: true },
  );

  res
    .status(200)
    .json({ success: true, message: "Product permanently deleted" });
});

// @desc    Get inventory products with filtering and pagination
// @route   GET /api/product/inventory
// @access  Private/Admin/Employee
const getInventoryProducts = asyncHandler(async (req, res) => {
  const {
    vendor,
    category,
    subCategory,
    productId,
    stockStatus,
    brand,
    size,
    q,
    pagination,
    page = 1,
    limit = 10,
  } = req.query;

  // Build query - lookup by name to get ObjectIds
  const query = {};

  // Vendor filter - lookup by name
  if (vendor && vendor.trim()) {
    const Vendor = require("../models/Vendor");
    const vendorDoc = await Vendor.findOne({
      name: { $regex: `^${vendor}$`, $options: "i" },
    });
    if (vendorDoc) {
      query.vendor = vendorDoc._id;
    } else {
      // If vendor name not found, return empty result
      return res.status(200).json({
        success: true,
        count: 0,
        data: [],
        pagination: {
          currentPage: parseInt(page),
          totalPages: 0,
          total: 0,
        },
      });
    }
  }

  // Category filter - lookup by name
  if (category && category.trim()) {
    const Category = require("../models/Category");
    const categoryDoc = await Category.findOne({
      name: { $regex: `^${category}$`, $options: "i" },
    });
    if (categoryDoc) {
      query.category = categoryDoc._id;
    } else {
      // If category name not found, return empty result
      return res.status(200).json({
        success: true,
        count: 0,
        data: [],
        pagination: {
          currentPage: parseInt(page),
          totalPages: 0,
          total: 0,
        },
      });
    }
  }

  // SubCategory filter - lookup by name
  if (subCategory && subCategory.trim()) {
    const SubCategory = require("../models/SubCategory");
    const subCategoryDoc = await SubCategory.findOne({
      name: { $regex: `^${subCategory}$`, $options: "i" },
    });
    if (subCategoryDoc) {
      query.subCategory = subCategoryDoc._id;
    } else {
      // If subcategory name not found, return empty result
      return res.status(200).json({
        success: true,
        count: 0,
        data: [],
        pagination: {
          currentPage: parseInt(page),
          totalPages: 0,
          total: 0,
        },
      });
    }
  }

  // Brand filter - lookup by name
  if (brand && brand.trim()) {
    const Brand = require("../models/Brand");
    const brandDoc = await Brand.findOne({
      name: { $regex: `^${brand}$`, $options: "i" },
    });
    if (brandDoc) {
      query.brand = brandDoc._id;
    } else {
      // If brand name not found, return empty result
      return res.status(200).json({
        success: true,
        count: 0,
        data: [],
        pagination: {
          currentPage: parseInt(page),
          totalPages: 0,
          total: 0,
        },
      });
    }
  }

  // General search query (q)
  if (q && q.trim()) {
    const regex = new RegExp(q.trim(), "i");
    const searchCondition = {
      $or: [
        { name: regex },
        { productId: regex },
        { description: regex },
      ],
    };
    if (query.$and) {
      query.$and.push(searchCondition);
    } else {
      query.$and = [searchCondition];
    }
  }

  // Stock Status filter - checks variation-level stock health
  if (stockStatus && stockStatus !== "all") {
    let stockCondition = null;
    if (stockStatus === "outOfStock") {
      // Out of Stock: Any variation has stock <= 0, or product without variations has stock <= 0
      stockCondition = {
        $or: [
          { variation: { $elemMatch: { stock: { $lte: 0 } } } },
          {
            $and: [
              { "variation.0": { $exists: false } },
              { stock: { $lte: 0 } },
            ],
          },
        ],
      };
    } else if (stockStatus === "lowStock") {
      // Low Stock: Any variation has 0 < stock <= 5, or product without variations has 0 < stock <= 5
      stockCondition = {
        $or: [
          { variation: { $elemMatch: { stock: { $gt: 0, $lte: 5 } } } },
          {
            $and: [
              { "variation.0": { $exists: false } },
              { stock: { $gt: 0, $lte: 5 } },
            ],
          },
        ],
      };
    } else if (
      stockStatus === "availableStock" ||
      stockStatus === "inStock" ||
      stockStatus === "available"
    ) {
      // Available Stock: ALL variations must have stock > 5 (no variation with stock <= 5), or product without variations has stock > 5
      stockCondition = {
        $or: [
          {
            $and: [
              { "variation.0": { $exists: true } },
              { variation: { $not: { $elemMatch: { stock: { $lte: 5 } } } } },
            ],
          },
          {
            $and: [
              { "variation.0": { $exists: false } },
              { stock: { $gt: 5 } },
            ],
          },
        ],
      };
    }

    if (stockCondition) {
      if (query.$and) {
        query.$and.push(stockCondition);
      } else {
        query.$and = [stockCondition];
      }
    }
  }

  // Add productId filter using custom productId field (case-insensitive)
  if (productId && productId.trim()) {
    query.productId = new RegExp(productId.trim(), "i");
  }

  // Size filter - filter by variation.size
  if (size && size.trim() && size !== "all") {
    const sizeItems = (Array.isArray(size) ? size : size.split(","))
      .map((s) => s.trim())
      .filter(Boolean);
    if (sizeItems.length > 0) {
      query["variation.size"] = {
        $in: sizeItems.map((s) => new RegExp(`^${s}$`, "i")),
      };
    }
  }

  // Sales Channel Filter: Hide OFFLINE products from public website users
  const { salesChannel } = req.query;
  if (salesChannel && salesChannel !== "all") {
    query.salesChannel = salesChannel;
  } else if (!req.user || !["admin", "manager", "employee"].includes(req.user?.role)) {
    query.salesChannel = { $ne: "OFFLINE" };
  }

  const total = await Product.countDocuments(query);

  // pagination=false হলে সব products একসাথে return করা হবে
  const { pagination: paginationParam } = req.query;
  const isPaginationDisabled = paginationParam === "false";

  let query2 = Product.find(query)
    .populate("category", "name isActive")
    .populate("subCategory", "name isActive")
    .populate("brand", "name isActive")
    .populate("vendor", "name isActive")
    .sort({ createdAt: -1 })
    .lean();

  if (!isPaginationDisabled) {
    const limitValue = parseInt(limit);
    const skip = (parseInt(page) - 1) * limitValue;
    query2 = query2.skip(skip).limit(limitValue);
  }

  const products = await query2;

  // Filter sensitive prices based on user role
  // Admin can see purchasePrice, other roles cannot
  const filteredProducts = filterSensitivePrices(products, req.user?.role);

  // Calculate total stock from all variations and enrich with variation health
  const productsWithTotalStock = filteredProducts.map((product) => {
    const variations = product.variation || [];
    const hasVariations = variations.length > 0;

    const totalStock = hasVariations
      ? variations.reduce((sum, v) => sum + (Number(v.stock) || 0), 0)
      : Number(product.stock) || 0;

    const lowStockVariations = hasVariations
      ? variations.filter((v) => Number(v.stock || 0) > 0 && Number(v.stock || 0) <= 5)
      : (product.stock > 0 && product.stock <= 5 ? [{ size: "Default", color: "Default", stock: product.stock }] : []);

    const outOfStockVariations = hasVariations
      ? variations.filter((v) => Number(v.stock || 0) <= 0)
      : (product.stock <= 0 ? [{ size: "Default", color: "Default", stock: product.stock }] : []);

    let stockHealth = "availableStock";
    if (outOfStockVariations.length > 0) {
      stockHealth = "outOfStock";
    } else if (lowStockVariations.length > 0) {
      stockHealth = "lowStock";
    }

    return {
      ...product,
      stock: totalStock,
      totalStock,
      lowStockVariations,
      outOfStockVariations,
      lowStockVariationsCount: lowStockVariations.length,
      outOfStockVariationsCount: outOfStockVariations.length,
      isFullyAvailable: lowStockVariations.length === 0 && outOfStockVariations.length === 0,
      stockHealth,
    };
  });

  const limitValue = isPaginationDisabled ? total : parseInt(limit);

  // Compute overall inventory summary across the active query filter
  const allFilteredForSummary = await Product.find(query, { variation: 1, stock: 1, isActive: 1 }).lean();
  let totalStockUnits = 0;
  let availableStockCount = 0;
  let lowStockCount = 0;
  let outOfStockCount = 0;
  let activeProducts = 0;
  let inactiveProducts = 0;

  for (const p of allFilteredForSummary) {
    if (p.isActive) activeProducts++;
    else inactiveProducts++;

    const vars = p.variation || [];
    let pStock = 0;
    let hasZero = false;
    let hasLow = false;

    if (vars.length > 0) {
      for (const v of vars) {
        const s = Number(v.stock) || 0;
        pStock += s;
        if (s <= 0) hasZero = true;
        else if (s <= 5) hasLow = true;
      }
    } else {
      pStock = Number(p.stock) || 0;
      if (pStock <= 0) hasZero = true;
      else if (pStock <= 5) hasLow = true;
    }

    totalStockUnits += pStock;
    if (hasZero) outOfStockCount++;
    else if (hasLow) lowStockCount++;
    else availableStockCount++;
  }

  const stats = {
    totalProducts: allFilteredForSummary.length,
    totalStockUnits,
    availableStockCount,
    lowStockCount,
    outOfStockCount,
    activeProducts,
    inactiveProducts,
  };

  res.status(200).json({
    success: true,
    data: productsWithTotalStock,
    stats,
    pagination: {
      currentPage: isPaginationDisabled ? 1 : parseInt(page),
      totalPages: isPaginationDisabled ? 1 : Math.ceil(total / limitValue),
      total: total,
    },
  });
});

// @desc    Export inventory to Excel
// @route   GET /api/product/inventory/export
// @access  Private/Admin/Employee
const exportInventoryToExcel = asyncHandler(async (req, res) => {
  const ExcelJS = require("exceljs");
  const {
    vendor,
    category,
    subCategory,
    brand,
    productId,
    stockStatus,
    size,
    q,
    isActive,
    salesChannel,
  } = req.query;

  // Build query - same as getInventoryProducts (lookup by name)
  const query = {};

  // Stock Status filter - checks variation-level stock health
  if (stockStatus && stockStatus !== "all") {
    let stockCondition = null;
    if (stockStatus === "outOfStock") {
      stockCondition = {
        $or: [
          { variation: { $elemMatch: { stock: { $lte: 0 } } } },
          {
            $and: [
              { "variation.0": { $exists: false } },
              { stock: { $lte: 0 } },
            ],
          },
        ],
      };
    } else if (stockStatus === "lowStock") {
      stockCondition = {
        $or: [
          { variation: { $elemMatch: { stock: { $gt: 0, $lte: 5 } } } },
          {
            $and: [
              { "variation.0": { $exists: false } },
              { stock: { $gt: 0, $lte: 5 } },
            ],
          },
        ],
      };
    } else if (
      stockStatus === "availableStock" ||
      stockStatus === "inStock" ||
      stockStatus === "available"
    ) {
      stockCondition = {
        $or: [
          {
            $and: [
              { "variation.0": { $exists: true } },
              { variation: { $not: { $elemMatch: { stock: { $lte: 5 } } } } },
            ],
          },
          {
            $and: [
              { "variation.0": { $exists: false } },
              { stock: { $gt: 5 } },
            ],
          },
        ],
      };
    }

    if (stockCondition) {
      if (query.$and) {
        query.$and.push(stockCondition);
      } else {
        query.$and = [stockCondition];
      }
    }
  }

  // Helper for empty excel response
  const sendEmptyExcel = async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Inventory");
    worksheet.columns = [{ header: "No Data", key: "noData", width: 20 }];
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=inventory_${Date.now()}.xlsx`,
    );
    return await workbook.xlsx.write(res);
  };

  // Vendor filter - lookup by name
  if (vendor && vendor.trim()) {
    const Vendor = require("../models/Vendor");
    const vendorDoc = await Vendor.findOne({
      name: { $regex: `^${vendor.trim()}$`, $options: "i" },
    });
    if (vendorDoc) {
      query.vendor = vendorDoc._id;
    } else {
      return await sendEmptyExcel();
    }
  }

  // Category filter - lookup by name
  if (category && category.trim()) {
    const Category = require("../models/Category");
    const categoryDoc = await Category.findOne({
      name: { $regex: `^${category.trim()}$`, $options: "i" },
    });
    if (categoryDoc) {
      query.category = categoryDoc._id;
    } else {
      return await sendEmptyExcel();
    }
  }

  // SubCategory filter - lookup by name
  if (subCategory && subCategory.trim()) {
    const SubCategory = require("../models/SubCategory");
    const subCategoryDoc = await SubCategory.findOne({
      name: { $regex: `^${subCategory.trim()}$`, $options: "i" },
    });
    if (subCategoryDoc) {
      query.subCategory = subCategoryDoc._id;
    } else {
      return await sendEmptyExcel();
    }
  }

  // Brand filter - lookup by name
  if (brand && brand.trim()) {
    const Brand = require("../models/Brand");
    const brandDoc = await Brand.findOne({
      name: { $regex: `^${brand.trim()}$`, $options: "i" },
    });
    if (brandDoc) {
      query.brand = brandDoc._id;
    } else {
      return await sendEmptyExcel();
    }
  }

  // General search query (q) - matches title, ID, or description
  if (q && q.trim()) {
    const regex = new RegExp(q.trim(), "i");
    const searchCondition = {
      $or: [
        { name: regex },
        { productId: regex },
        { description: regex },
      ],
    };
    if (query.$and) {
      query.$and.push(searchCondition);
    } else {
      query.$and = [searchCondition];
    }
  }

  if (productId && productId.trim())
    query.productId = new RegExp(productId.trim(), "i");

  // Size filter - filter by variation.size
  if (size && size.trim() && size !== "all") {
    const sizeItems = (Array.isArray(size) ? size : size.split(","))
      .map((s) => s.trim())
      .filter(Boolean);
    if (sizeItems.length > 0) {
      query["variation.size"] = {
        $in: sizeItems.map((s) => new RegExp(`^${s}$`, "i")),
      };
    }
  }

  // Optional Active status filter
  if (isActive !== undefined && isActive !== "" && isActive !== "all") {
    query.isActive = isActive === "true" || isActive === true;
  }

  // Sales Channel Filter
  if (salesChannel && salesChannel !== "all") {
    query.salesChannel = salesChannel;
  } else if (!req.user || !["admin", "manager", "employee"].includes(req.user?.role)) {
    query.salesChannel = { $ne: "OFFLINE" };
  }

  // Fetch ALL active products without pagination
  const products = await Product.find(query)
    .populate("category", "name categoryId isActive")
    .populate("subCategory", "name subCategoryId isActive")
    .populate("brand", "name brandId isActive")
    .populate("vendor", "name vendorId phone isActive")
    .populate("createdBy", "name email")
    .sort({ createdAt: -1 })
    .lean();

  // Filter sensitive prices based on user role
  // Admin can see purchasePrice, other roles cannot
  const filteredProducts = filterSensitivePrices(products, req.user?.role);

  // Create a new workbook
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "LifeStyle Admin";
  workbook.created = new Date();

  // Add a worksheet
  const worksheet = workbook.addWorksheet("Inventory");

  // Define requested columns (1,2,3,4,5,6,7,8,12)
  worksheet.columns = [
    { header: "Product ID", key: "productId", width: 15 },
    { header: "Product Name", key: "name", width: 30 },
    { header: "SKU", key: "sku", width: 18 },
    { header: "Category", key: "category", width: 20 },
    { header: "Sub-Category", key: "subCategory", width: 20 },
    { header: "Brand", key: "brand", width: 20 },
    { header: "Vendor", key: "vendor", width: 25 },
    { header: "Vendor Phone", key: "vendorPhone", width: 15 },
    { header: "Stock", key: "stock", width: 12 },
  ];

  // Style the header row
  worksheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  worksheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF4472C4" },
  };
  worksheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" };

  // Add data rows
  filteredProducts.forEach((product) => {
    if (product.variation && product.variation.length > 0) {
      // Add a row for each variation that matches stockStatus filter
      product.variation.forEach((variation) => {
        const vStock = Number(variation.stock || 0);

        // Filter individual variation rows based on active stockStatus
        if (
          stockStatus === "availableStock" ||
          stockStatus === "inStock" ||
          stockStatus === "available"
        ) {
          if (vStock <= 5) return; // Only include stock > 5 in Available Stock export
        } else if (stockStatus === "outOfStock") {
          if (vStock > 0) return; // Only include 0 stock in Out of Stock export
        } else if (stockStatus === "lowStock") {
          if (vStock <= 0 || vStock > 5) return; // Only include 1 to 5 stock in Low Stock export
        }

        // Filter individual variation rows based on active size
        if (size && size.trim() && size !== "all") {
          const sizeItems = (Array.isArray(size) ? size : size.split(","))
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean);
          if (!sizeItems.includes((variation.size || "").trim().toLowerCase())) {
            return; // Skip variations that don't match the selected size
          }
        }

        worksheet.addRow({
          productId: product.productId || "",
          name: product.name || "",
          sku: variation.sku || product.sku || "",
          category: product.category?.name || "",
          subCategory: product.subCategory?.name || "",
          brand: product.brand?.name || "",
          vendor: product.vendor?.name || "",
          vendorPhone: product.vendor?.phone || "",
          stock: vStock,
        });
      });
    } else {
      const pStock = Number(product.stock || 0);

      // Filter product without variations based on active stockStatus
      if (
        stockStatus === "availableStock" ||
        stockStatus === "inStock" ||
        stockStatus === "available"
      ) {
        if (pStock <= 5) return; // Only include stock > 5 in Available Stock export
      } else if (stockStatus === "outOfStock") {
        if (pStock > 0) return; // Only include 0 stock in Out of Stock export
      } else if (stockStatus === "lowStock") {
        if (pStock <= 0 || pStock > 5) return; // Only include 1 to 5 stock in Low Stock export
      }

      // Product without variations
      worksheet.addRow({
        productId: product.productId || "",
        name: product.name || "",
        sku: product.sku || "",
        category: product.category?.name || "",
        subCategory: product.subCategory?.name || "",
        brand: product.brand?.name || "",
        vendor: product.vendor?.name || "",
        vendorPhone: product.vendor?.phone || "",
        stock: pStock,
      });
    }
  });

  // Add borders to all cells
  worksheet.eachRow((row, rowNumber) => {
    row.eachCell((cell) => {
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    });
  });

  // Auto-fit columns (approximate)
  worksheet.columns.forEach((column) => {
    column.alignment = { vertical: "middle" };
  });

  // Set response headers
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=inventory_${Date.now()}.xlsx`,
  );

  // Write to response
  await workbook.xlsx.write(res);
  res.end();
});

// @desc    Search active products by name or variation
// @route   GET /api/product/search?q=<query>
// @access  Public
const searchProducts = asyncHandler(async (req, res) => {
  const searchQuery = req.query.q;

  if (!searchQuery) {
    return res.status(200).json({
      success: true,
      message: "Please provide a search query.",
      data: [],
    });
  }

  // Create a case-insensitive regex
  const regex = new RegExp(searchQuery, "i");

  // Find active products where the name, productId, sku, barcode, or any variation attribute matches the search query.
  const products = await Product.find({
    isActive: true,
    $or: [
      { name: regex },
      { productId: regex },
      { sku: regex },
      { barcode: regex },
      { "variation.sku": regex },
      { "variation.size": regex },
      { "variation.color": regex },
    ],
  })
    .select("productId sku name bannerImage variation")
    .populate("category", "name categoryId")
    .populate("subCategory", "name subCategoryId")
    .populate("brand", "name brandId")
    .populate("vendor", "name vendorId")
    .populate("createdBy", "name")
    .lean(); // Use .lean() for better performance as we are only reading data

  const filteredProducts = filterSensitivePrices(products, req.user?.role);

  res.status(200).json({ success: true, data: filteredProducts });
});

// @desc    Get search suggestions (limited results for autocomplete)
// @route   GET /api/product/suggestions?q=<query>
// @access  Public
const getSearchSuggestions = asyncHandler(async (req, res) => {
  const searchQuery = req.query.q;

  if (!searchQuery || searchQuery.trim().length < 2) {
    return res.status(200).json({
      success: true,
      message: "Query too short.",
      data: [],
    });
  }

  const regex = new RegExp(searchQuery, "i");

  // Find active products (excluding OFFLINE), limit to 5 suggestions
  const products = await Product.find({
    isActive: true,
    salesChannel: { $ne: "OFFLINE" },
    $or: [
      { name: regex },
      { productId: regex },
      { sku: regex },
      { "variation.sku": regex },
    ],
  })
    .select("name bannerImage productId sku") // Return productId and sku
    .limit(5)
    .lean();

  res.status(200).json({ success: true, data: products });
});

// @desc    Get related products by sub-category
// @route   GET /api/product/related/subcategory/:subCategoryId
// @access  Public
const getRelatedProducts = asyncHandler(async (req, res) => {
  const { subCategoryId } = req.params;
  const { currentProductId } = req.query; // productId of the product being viewed

  if (!subCategoryId) {
    return res
      .status(400)
      .json({ success: false, message: "Sub-category ID is required." });
  }

  // Find active products in the same sub-category, excluding the current one & OFFLINE-only items.
  const relatedProducts = await Product.find({
    subCategory: subCategoryId,
    _id: { $ne: currentProductId }, // Exclude the current product by its MongoDB _id
    isActive: true,
    salesChannel: { $ne: "OFFLINE" },
  })
    .limit(4) // Show up to 4 related products
    .populate("category", "name")
    .populate("subCategory", "name")
    .populate("brand", "name");

  const filteredRelatedProducts = filterSensitivePrices(
    relatedProducts,
    req.user?.role,
  );

  res.status(200).json({ success: true, data: filteredRelatedProducts });
});

// @desc    Search products for Admin (by name, productId, sku, barcode)
// @route   GET /api/product/admin/search?q=<query>&page=<page>&limit=<limit>
// @access  Private (Admin/Employee)
const searchProductsAdmin = asyncHandler(async (req, res) => {
  const searchQuery = req.query.q;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const skip = (page - 1) * limit;

  if (!searchQuery) {
    return res.status(200).json({
      success: true,
      message: "Please provide a search query.",
      data: [],
      pagination: {
        currentPage: page,
        totalPages: 0,
        totalItems: 0,
        limit: limit,
      },
    });
  }

  // Create a case-insensitive regex
  const regex = new RegExp(searchQuery, "i");
  const searchFilter = {
    $or: [
      { name: regex },
      { productId: regex },
      { sku: regex },
      { barcode: regex },
      { "variation.sku": regex },
    ],
  };

  // Count total matching products
  const totalItems = await Product.countDocuments(searchFilter);

  // Find products where name, productId, or SKU matches the search query (including inactive products)
  const products = await Product.find(searchFilter)
    .populate("category", "name categoryId description image isActive")
    .populate("subCategory", "name subCategoryId description image isActive")
    .populate("brand", "name brandId description image isActive")
    .populate("vendor", "name vendorId phone isActive")
    .populate("createdBy", "name")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  const totalPages = Math.ceil(totalItems / limit);
  const filteredProducts = filterSensitivePrices(products, "admin");

  res.status(200).json({
    success: true,
    data: filteredProducts,
    pagination: {
      currentPage: page,
      totalPages: totalPages,
      totalItems: totalItems,
      limit: limit,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  });
});

// @desc    Get top selling products aggregated by real order sales (online + shop)
// @route   GET /api/product/top-selling
// @access  Public
const getTopSellingProducts = asyncHandler(async (req, res, next) => {
  const limit = req.query.limit ? parseInt(req.query.limit, 10) : 0;

  // 1. Aggregate total sales quantity per product across ALL non-cancelled orders (online & shop)
  const salesData = await Order.aggregate([
    { $match: { status: { $ne: "cancelled" } } },
    { $unwind: "$products" },
    {
      $group: {
        _id: "$products.productId",
        totalSold: { $sum: "$products.quantity" },
      },
    },
    { $sort: { totalSold: -1 } },
  ]);

  const salesMap = new Map();
  salesData.forEach((item) => {
    if (item._id) {
      salesMap.set(item._id.toString(), item.totalSold);
    }
  });

  // 2. Build active products filter for website
  const filter = { isActive: true };
  if (!req.user || !["admin", "manager", "employee"].includes(req.user?.role)) {
    filter.salesChannel = { $ne: "OFFLINE" };
  }

  const products = await Product.find(filter)
    .populate("category", "name categoryId description image isActive")
    .populate("subCategory", "name subCategoryId description image isActive")
    .populate("brand", "name brandId description image isActive")
    .populate("vendor", "name vendorId phone isActive")
    .populate("createdBy", "name")
    .lean();

  let filteredProducts = filterSensitivePrices(products, req.user?.role);
  filteredProducts = await attachActiveOffersToProducts(filteredProducts);

  // 3. Attach totalSold count to each product and sort
  const productsWithSales = filteredProducts.map((p) => {
    const pId = p._id.toString();
    const totalSold = salesMap.get(pId) || 0;
    return {
      ...p,
      totalSold,
    };
  });

  // Sort: Explicitly flagged "trendy" / "top-selling" products FIRST, then highest sales, then newest
  productsWithSales.sort((a, b) => {
    const aIsTrendy = a.flag === "trendy" || a.flag === "top-selling";
    const bIsTrendy = b.flag === "trendy" || b.flag === "top-selling";
    if (aIsTrendy && !bIsTrendy) return -1;
    if (!aIsTrendy && bIsTrendy) return 1;
    if (b.totalSold !== a.totalSold) {
      return b.totalSold - a.totalSold;
    }
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  const finalProducts = limit > 0 ? productsWithSales.slice(0, limit) : productsWithSales;

  res.status(200).json({
    success: true,
    count: finalProducts.length,
    data: finalProducts,
  });
});

// @desc    Get products for Stock Management across locations (Display, Shop, Store Room)
// @route   GET /api/admin/product/stock-management
// @access  Private (Admin, Manager, Employee)
const getStockManagementProducts = asyncHandler(async (req, res) => {
  const {
    q,
    search,
    category,
    brand,
    stockStatus,
    page = 1,
    limit = 20,
    pagination,
  } = req.query;

  const query = {};

  const searchTerm = (search || q || "").trim();
  if (searchTerm) {
    const regex = new RegExp(searchTerm, "i");
    query.$or = [
      { name: regex },
      { productId: regex },
      { sku: regex },
      { barcode: regex },
      { "variation.sku": regex },
    ];
  }

  // Category filter
  if (category && category.trim() && category !== "all") {
    if (mongoose.Types.ObjectId.isValid(category.trim())) {
      query.category = category.trim();
    } else {
      const Category = require("../models/Category");
      const categoryDoc = await Category.findOne({
        name: { $regex: `^${category.trim()}$`, $options: "i" },
      });
      if (categoryDoc) query.category = categoryDoc._id;
    }
  }

  // Brand filter
  if (brand && brand.trim() && brand !== "all") {
    if (mongoose.Types.ObjectId.isValid(brand.trim())) {
      query.brand = brand.trim();
    } else {
      const Brand = require("../models/Brand");
      const brandDoc = await Brand.findOne({
        name: { $regex: `^${brand.trim()}$`, $options: "i" },
      });
      if (brandDoc) query.brand = brandDoc._id;
    }
  }

  // Stock status filter
  if (stockStatus && stockStatus !== "all") {
    if (stockStatus === "out-of-stock") {
      query.$expr = { $lte: [{ $sum: "$variation.stock" }, 0] };
    } else if (stockStatus === "low-stock") {
      query.$expr = {
        $and: [
          { $gt: [{ $sum: "$variation.stock" }, 0] },
          { $lte: [{ $sum: "$variation.stock" }, 5] },
        ],
      };
    } else if (stockStatus === "in-stock") {
      query.$expr = { $gt: [{ $sum: "$variation.stock" }, 0] };
    } else if (stockStatus === "low-display") {
      // Any variation has display <= 2 with remaining stock in shop or storeroom
      query.$expr = {
        $gt: [
          {
            $size: {
              $filter: {
                input: "$variation",
                as: "v",
                cond: {
                  $and: [
                    { $lte: [{ $ifNull: ["$$v.locations.display", "$$v.stock"] }, 2] },
                    {
                      $or: [
                        { $gt: [{ $ifNull: ["$$v.locations.shopStock", { $ifNull: ["$$v.locations.shop", 0] }] }, 0] },
                        { $gt: [{ $ifNull: ["$$v.locations.warehouse", { $ifNull: ["$$v.locations.storeRoom", 0] }] }, 0] },
                      ],
                    },
                  ],
                },
              },
            },
          },
          0,
        ],
      };
    }
  }

  const isPaginationDisabled = pagination === "false" || parseInt(limit) === 0;
  const pageNum = parseInt(page) || 1;
  const limitNum = isPaginationDisabled ? 0 : parseInt(limit) || 20;
  const skip = (pageNum - 1) * limitNum;

  const total = await Product.countDocuments(query);

  let queryBuilder = Product.find(query)
    .populate("category", "name")
    .populate("subCategory", "name")
    .populate("brand", "name")
    .populate("vendor", "name phone")
    .sort({ createdAt: -1 })
    .lean();

  if (!isPaginationDisabled) {
    queryBuilder = queryBuilder.skip(skip).limit(limitNum);
  }

  const rawProducts = await queryBuilder;

  // Process and normalize location data per product and variation
  const products = rawProducts.map((p) => {
    let prodDisplay = 0;
    let prodShopStock = 0;
    let prodWarehouse = 0;
    let prodTotalStock = 0;

    const variations = (p.variation || []).map((v) => {
      // Sensitive price security: Omit purchasePrice completely in Stock Management
      delete v.purchasePrice;
      delete v.profit;
      delete v.profitMargin;

      const display = Number(v.locations?.display ?? (v.stock || 0));
      const shopStock = Number(v.locations?.shopStock ?? (v.locations?.shop ?? 0));
      const warehouse = Number(v.locations?.warehouse ?? (v.locations?.storeRoom ?? 0));
      const vStock = display + shopStock + warehouse;

      prodDisplay += display;
      prodShopStock += shopStock;
      prodWarehouse += warehouse;
      prodTotalStock += vStock;

      return {
        ...v,
        locations: {
          display,
          shopStock,
          warehouse,
        },
        stock: vStock,
      };
    });

    return {
      ...p,
      variation: variations,
      stock: prodTotalStock,
      locations: {
        display: prodDisplay,
        shopStock: prodShopStock,
        warehouse: prodWarehouse,
      },
    };
  });

  // Calculate high-level catalog summary stats
  const allProductsForSummary = await Product.find({}, "variation").lean();
  let totalUnits = 0;
  let totalDisplay = 0;
  let totalShopStock = 0;
  let totalWarehouse = 0;
  let lowDisplayAlertCount = 0;
  let outOfStockCount = 0;

  for (const prod of allProductsForSummary) {
    let pTotal = 0;
    for (const v of prod.variation || []) {
      const d = Number(v.locations?.display ?? (v.stock || 0));
      const sh = Number(v.locations?.shopStock ?? (v.locations?.shop ?? 0));
      const w = Number(v.locations?.warehouse ?? (v.locations?.storeRoom ?? 0));
      const vTotal = d + sh + w;
      totalUnits += vTotal;
      totalDisplay += d;
      totalShopStock += sh;
      totalWarehouse += w;
      pTotal += vTotal;

      if (d <= 2 && (sh > 0 || w > 0)) {
        lowDisplayAlertCount++;
      }
    }
    if (pTotal === 0) {
      outOfStockCount++;
    }
  }

  const productStats = {
    totalProducts: allProductsForSummary.length,
    totalUnits,
    totalDisplay,
    totalShopStock,
    totalWarehouse,
    // Backward compatibility fields
    totalShop: totalShopStock,
    totalStoreRoom: totalWarehouse,
    lowDisplayAlertCount,
    outOfStockCount,
  };

  res.status(200).json({
    success: true,
    data: products,
    stats: productStats,
    pagination: {
      currentPage: isPaginationDisabled ? 1 : pageNum,
      totalPages: isPaginationDisabled ? 1 : Math.ceil(total / (limitNum || 1)),
      total,
      limit: limitNum,
    },
  });
});

// @desc    Update stock locations - BLOCKED per Rule 13 (prevent direct silent mutation)
// @route   PUT /api/admin/product/:id/stock-locations
// @access  Private (Admin, Manager, Employee)
const updateStockLocations = asyncHandler(async (req, res) => {
  return res.status(403).json({
    success: false,
    errorCode: "DIRECT_MUTATION_FORBIDDEN",
    message:
      "Direct stock mutation is prohibited by inventory control rules. Please use Manual Stock Transfer or Stock Adjustment with an audited reason.",
  });
});

// @desc    Transfer stock between locations (display <-> shopStock <-> warehouse)
// @route   POST /api/admin/product/:id/stock-transfer
// @access  Private (Admin, Manager, Employee)
const transferStockLocation = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { variationId, fromLocation, toLocation, quantity, reason, note } = req.body;

  const query = mongoose.Types.ObjectId.isValid(id)
    ? { $or: [{ _id: id }, { productId: id }] }
    : { productId: id };

  const product = await Product.findOne(query);
  if (!product) {
    return res.status(404).json({
      success: false,
      message: "Product not found",
    });
  }

  let targetVar = null;
  if (variationId) {
    targetVar = product.variation.id(variationId);
  }
  if (!targetVar && product.variation.length === 1) {
    targetVar = product.variation[0];
  }
  if (!targetVar && product.variation.length > 0) {
    targetVar = product.variation[0];
  }

  if (!targetVar) {
    return res.status(404).json({
      success: false,
      message: "Product variation not found",
    });
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const result = await inventoryService.transferStock({
      productId: product._id,
      variationId: targetVar._id,
      fromLocation,
      toLocation,
      quantity,
      reason: reason || "Manual Location Stock Transfer",
      note: note || "",
      user: req.user,
      session,
    });

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      success: true,
      message: `Transferred ${quantity} units from ${fromLocation} to ${toLocation} successfully!`,
      movement: result.movement,
      variation: result.variation,
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return res.status(err.code === "INSUFFICIENT_STOCK" || err.code === "INVALID_LOCATION" ? 400 : 500).json({
      success: false,
      errorCode: err.code || "TRANSFER_ERROR",
      message: err.message,
      details: err.details || null,
    });
  }
});

// @desc    Stock adjustment (Damaged, Expired, Lost, Broken, Sample/Test, Stock Correction, Other)
// @route   POST /api/admin/product/stock-adjustment
// @access  Private (Admin, Manager)
const stockAdjustment = asyncHandler(async (req, res) => {
  const productId = req.body.productId || req.params.id;
  const { variationId, location, quantity, reason, note } = req.body;

  if (!productId || !location || !quantity || !reason) {
    return res.status(400).json({
      success: false,
      message: "productId, location, quantity, and reason are required.",
    });
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const result = await inventoryService.adjustStock({
      productId,
      variationId,
      location,
      quantity,
      reason,
      note: note || "",
      user: req.user,
      session,
    });

    await session.commitTransaction();
    session.endSession();

    res.status(200).json({
      success: true,
      message: `Adjusted ${quantity} units from ${location} (${reason}) successfully.`,
      movement: result.movement,
      variation: result.variation,
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return res.status(err.code === "INSUFFICIENT_STOCK" || err.code === "INVALID_REASON" ? 400 : 500).json({
      success: false,
      errorCode: err.code || "ADJUSTMENT_ERROR",
      message: err.message,
      details: err.details || null,
    });
  }
});

// @desc    Get stock movement audit logs
// @route   GET /api/admin/product/stock-movements
// @access  Private (Admin, Manager)
const getStockMovements = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 20,
    productId,
    variationId,
    transactionType,
    fromLocation,
    toLocation,
    startDate,
    endDate,
    search,
  } = req.query;

  const query = {};
  if (productId && mongoose.Types.ObjectId.isValid(productId)) {
    query.product = productId;
  }
  if (variationId && mongoose.Types.ObjectId.isValid(variationId)) {
    query.variationId = variationId;
  }
  if (transactionType && transactionType !== "all") {
    query.transactionType = transactionType;
  }
  if (fromLocation && fromLocation !== "all") {
    query.fromLocation = fromLocation;
  }
  if (toLocation && toLocation !== "all") {
    query.toLocation = toLocation;
  }
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) {
      const e = new Date(endDate);
      e.setHours(23, 59, 59, 999);
      query.createdAt.$lte = e;
    }
  }
  if (search && search.trim()) {
    const regex = new RegExp(search.trim(), "i");
    query.$or = [
      { movementId: regex },
      { productName: regex },
      { sku: regex },
      { orderId: regex },
      { exchangeId: regex },
      { reason: regex },
    ];
  }

  const pageNum = parseInt(page, 10) || 1;
  const limitNum = parseInt(limit, 10) || 20;
  const skip = (pageNum - 1) * limitNum;

  const [movements, total] = await Promise.all([
    StockMovement.find(query)
      .populate("product", "name productId images")
      .populate("user", "name role")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
    StockMovement.countDocuments(query),
  ]);

  res.status(200).json({
    success: true,
    data: movements,
    pagination: {
      currentPage: pageNum,
      totalPages: Math.ceil(total / limitNum),
      total,
      limit: limitNum,
    },
  });
});

module.exports = {
  createProduct,
  getAllProducts,
  getAllProductsAdmin,
  getZeroStockProducts,
  getProductById,
  updateProduct,
  deleteProduct,
  getInventoryProducts,
  exportInventoryToExcel,
  searchProducts,
  getSearchSuggestions,
  getRelatedProducts,
  searchProductsAdmin,
  getTopSellingProducts,
  getStockManagementProducts,
  updateStockLocations,
  transferStockLocation,
  stockAdjustment,
  getStockMovements,
};
