const asyncHandler = require("../utils/asyncHandler");
const mongoose = require("mongoose");
const NewArrival = require("../models/NewArrival");
const Product = require("../models/Product");
const { cloudinary, deleteImageFromCloudinary, extractPublicIdFromUrl } = require("../config/cloudinary");

const filterSensitivePrices = (products, userRole) => {
  if (!Array.isArray(products)) {
    products = [products];
  }

  return products.map((product) => {
    const productObj = product.toObject ? product.toObject() : product;

    if (productObj.variation && Array.isArray(productObj.variation)) {
      productObj.variation = productObj.variation.map((v) => {
        const variationObj = v.toObject ? v.toObject() : v;

        if (userRole !== "admin") {
          delete variationObj.purchasePrice;
          delete variationObj.profit;
          delete variationObj.profitMargin;
        }

        return variationObj;
      });
    }

    return productObj;
  });
};

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
        flag: offerType,
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

/**
 * Helper to ensure a default NewArrival config document exists
 */
const getOrCreateConfig = async () => {
  let config = await NewArrival.findOne({ isActive: true });
  if (!config) {
    config = await NewArrival.findOne();
  }
  if (!config) {
    config = await NewArrival.create({
      title: "New Arrivals",
      description: "Check out our latest fashion and apparel additions.",
      autoIncludeDays: 30,
      manualProducts: [],
      isActive: true,
    });
  }
  return config;
};

// @desc    Get New Arrival Products & Config (Public Website)
// @route   GET /api/new-arrival
// @access  Public
const getNewArrivalProducts = asyncHandler(async (req, res) => {
  const config = await getOrCreateConfig();

  const autoDays = config.autoIncludeDays || 30;
  const cutoffDate = new Date(Date.now() - autoDays * 24 * 60 * 60 * 1000);
  const manualProductIds = (config.manualProducts || []).map((id) =>
    new mongoose.Types.ObjectId(id)
  );

  const {
    page = 1,
    limit = 12,
    pagination,
    category,
    subCategory,
    brand,
    size,
    color,
    minPrice,
    maxPrice,
    sort,
    search,
  } = req.query;

  // Build match query for New Arrival items
  const query = {
    isActive: true,
    $or: [
      { createdAt: { $gte: cutoffDate } },
      { flag: "new-stock" },
      { _id: { $in: manualProductIds } },
    ],
  };

  // Exclude OFFLINE products for public website customers
  if (!req.user || !["admin", "manager", "employee"].includes(req.user?.role)) {
    query.salesChannel = { $ne: "OFFLINE" };
  }

  // Search filter
  if (search && search.trim()) {
    const regex = new RegExp(search.trim(), "i");
    const searchOr = [{ name: regex }, { description: regex }];
    query.$and = [{ $or: query.$or }, { $or: searchOr }];
    delete query.$or;
  }

  // Category filter
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
      query.category = { $in: catObjectIds };
    }
  }

  // SubCategory filter
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
      query.subCategory = { $in: subCatObjectIds };
    }
  }

  // Brand filter
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
      query.brand = { $in: brandObjectIds };
    }
  }

  // Size filter
  if (size) {
    const sizeItems = (Array.isArray(size) ? size : size.split(",")).map((s) => s.trim()).filter(Boolean);
    if (sizeItems.length > 0) {
      query["variation.size"] = { $in: sizeItems.map((s) => new RegExp(`^${s}$`, "i")) };
    }
  }

  // Color filter
  if (color) {
    const colorItems = (Array.isArray(color) ? color : color.split(",")).map((c) => c.trim()).filter(Boolean);
    if (colorItems.length > 0) {
      query["variation.color"] = { $in: colorItems.map((c) => new RegExp(`^${c}$`, "i")) };
    }
  }

  // Price filter
  if (minPrice || maxPrice) {
    const pMin = minPrice ? Number(minPrice) : 0;
    const pMax = maxPrice ? Number(maxPrice) : Infinity;
    query.$and = query.$and || [];
    const priceCondition = { $gte: pMin };
    if (pMax < Infinity) priceCondition.$lte = pMax;
    query.$and.push({ "variation.basePrice": priceCondition });
  }

  // Sort logic
  let sortOption = { createdAt: -1 };
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
    default:
      sortOption = { createdAt: -1 };
      break;
  }

  const total = await Product.countDocuments(query);

  let productQuery = Product.find(query)
    .populate("category", "name categoryId description image isActive")
    .populate("subCategory", "name subCategoryId description image isActive")
    .populate("brand", "name brandId description image isActive")
    .populate("vendor", "name vendorId phone isActive")
    .sort(sortOption)
    .lean();

  if (pagination !== "false") {
    const limitValue = parseInt(limit);
    const skip = (parseInt(page) - 1) * limitValue;
    productQuery = productQuery.skip(skip).limit(limitValue);
  }

  const products = await productQuery;
  let filteredProducts = filterSensitivePrices(products, req.user?.role);
  filteredProducts = await attachActiveOffersToProducts(filteredProducts);

  res.status(200).json({
    success: true,
    config: {
      title: config.title,
      description: config.description,
      bannerImage: config.bannerImage,
      autoIncludeDays: config.autoIncludeDays,
    },
    data: filteredProducts,
    pagination: {
      currentPage: parseInt(page),
      totalPages: Math.ceil(total / (parseInt(limit) || 12)),
      totalItems: total,
    },
    stats: {
      totalItems: total,
    },
  });
});

// @desc    Get New Arrival Config & Products (Admin)
// @route   GET /api/new-arrival/admin
// @access  Private (Admin, Manager, Employee)
const getNewArrivalConfigAdmin = asyncHandler(async (req, res) => {
  const config = await getOrCreateConfig();

  const populatedConfig = await NewArrival.findById(config._id)
    .populate({
      path: "manualProducts",
      select: "name productId category brand bannerImage images variation isActive salesChannel createdAt",
      populate: [
        { path: "category", select: "name" },
        { path: "brand", select: "name" },
      ],
    })
    .lean();

  const autoDays = config.autoIncludeDays || 30;
  const cutoffDate = new Date(Date.now() - autoDays * 24 * 60 * 60 * 1000);

  const autoProducts = await Product.find({
    isActive: true,
    createdAt: { $gte: cutoffDate },
  })
    .populate("category", "name")
    .populate("brand", "name")
    .select("name productId category brand bannerImage images variation isActive salesChannel createdAt")
    .sort({ createdAt: -1 })
    .lean();

  const manualCount = (populatedConfig?.manualProducts || []).length;
  const autoCount = autoProducts.length;

  const stats = {
    total: manualCount + autoCount,
    autoCount,
    manualCount,
    autoIncludeDays: autoDays,
  };

  res.status(200).json({
    success: true,
    data: {
      ...populatedConfig,
      autoProducts,
      autoProductsCount: autoProducts.length,
    },
    config: populatedConfig,
    stats,
  });
});

// @desc    Update New Arrival Config & Manual Products (Admin)
// @route   PUT /api/new-arrival/admin
// @access  Private (Admin)
const updateNewArrivalConfigAdmin = asyncHandler(async (req, res) => {
  const config = await getOrCreateConfig();

  const { title, description, autoIncludeDays, manualProducts, isActive } = req.body;

  if (title !== undefined) config.title = title;
  if (description !== undefined) config.description = description;
  if (autoIncludeDays !== undefined) config.autoIncludeDays = Number(autoIncludeDays);
  if (isActive !== undefined) config.isActive = isActive === "true" || isActive === true;

  if (manualProducts !== undefined) {
    let parsed = manualProducts;
    if (typeof manualProducts === "string") {
      try {
        parsed = JSON.parse(manualProducts);
      } catch (e) {
        parsed = manualProducts.split(",").map((s) => s.trim()).filter(Boolean);
      }
    }
    if (Array.isArray(parsed)) {
      config.manualProducts = parsed.map((id) => new mongoose.Types.ObjectId(id));
    }
  }

  // Handle bannerImage file upload
  if (req.file) {
    if (config.bannerImage) {
      const publicId = extractPublicIdFromUrl(config.bannerImage);
      if (publicId) {
        try {
          await deleteImageFromCloudinary(publicId);
        } catch (err) {
          console.error("Error deleting old banner image:", err);
        }
      }
    }
    const uploadedUrl = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: "lifestyle/new-arrivals" },
        (error, result) => {
          if (error) reject(error);
          else resolve(result.secure_url);
        }
      );
      stream.end(req.file.buffer);
    });
    config.bannerImage = uploadedUrl;
  }

  if (req.user) {
    config.createdBy = req.user.id;
  }

  await config.save();

  const updatedConfig = await NewArrival.findById(config._id)
    .populate({
      path: "manualProducts",
      select: "name productId category brand bannerImage images variation isActive salesChannel createdAt",
      populate: [
        { path: "category", select: "name" },
        { path: "brand", select: "name" },
      ],
    })
    .lean();

  res.status(200).json({
    success: true,
    message: "New Arrival configuration updated successfully",
    data: updatedConfig,
  });
});

module.exports = {
  getNewArrivalProducts,
  getNewArrivalConfigAdmin,
  updateNewArrivalConfigAdmin,
};
