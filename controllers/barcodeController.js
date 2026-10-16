/**
 * ============================================================
 * controllers/barcodeController.js — Product Barcode Generation
 * ============================================================
 * Product ID (productId) অথবা barcode ব্যবহার করে barcode image তৈরি করে।
 * Thermal printer এ print করার জন্য optimize করা।
 *
 * API Endpoints:
 *  GET /api/barcode/generate           → generateProductBarcodes()     — Active products এর barcode তৈরি
 *  GET /api/barcode/single/:productId  → generateSingleBarcode()       — একটি product এর barcode PNG
 *  POST /api/barcode/scan              → scanProductForPOS()           — barcode অথবা productId দিয়ে scan
 *
 * Barcode Strategy:
 *  - If barcode field exists → use it
 *  - Otherwise → fallback to productId
 *  - CODE128 format (industry standard)
 *  - 203/300 DPI thermal printer এর জন্য optimize করা
 *  - PNG image হিসেবে response পাঠায়
 *  - bwip-js ব্যবহার করে server-side render
 *
 * ব্যবহার:
 *  Admin panel থেকে product বারকোড print করতে এই endpoint ব্যবহার হয়
 * ============================================================
 */

const Product = require("../models/Product");
const asyncHandler = require("../utils/asyncHandler");
const bwipjs = require("bwip-js");

// Professional barcode settings for thermal printers (203/300 DPI)
// Following GS1 and industry standards for CODE128
const BARCODE_OPTIONS = {
  bcid: "code128",
  text: "", // Will be set dynamically
  scale: 3,
  height: 10,
  margin: 5,
  includetext: true,
  textxoffset: 0,
};

/**
 * Generate barcode PNG buffer using bwip-js
 *
 * @param {string} value - The value to encode (barcode or productId)
 * @returns {Promise<Buffer>} - PNG buffer of the barcode
 * @throws {Error} if value is invalid or barcode generation fails
 */
const generateBarcodePngBuffer = async (value) => {
  const text = String(value ?? "").trim();

  // Validate input
  if (!text || text.length === 0) {
    throw new Error("Barcode value cannot be empty");
  }

  // bwip-js uses callback-based API, so we wrap it in a Promise
  return new Promise((resolve, reject) => {
    try {
      bwipjs.toBuffer(
        {
          bcid: "code128",
          text: text,
          scale: 3,
          height: 10,
          margin: 5,
          includetext: true,
        },
        (err, png) => {
          if (err) {
            console.error("Barcode generation error:", err.message);
            reject(new Error(`Failed to generate barcode: ${err.message}`));
          } else {
            resolve(png);
          }
        },
      );
    } catch (error) {
      console.error("Barcode generation error:", error.message);
      reject(new Error(`Failed to generate barcode: ${error.message}`));
    }
  });
};

/**
 * Safely calculate the lowest price from product variations
 * Handles malformed or empty variation arrays gracefully
 *
 * @param {Array} variations - Array of product variations
 * @returns {number} - Lowest price (0 if no valid variations)
 */
const calculateLowestPrice = (variations) => {
  try {
    if (!Array.isArray(variations) || variations.length === 0) {
      return 0;
    }

    const lowestPrice = variations.reduce((min, v) => {
      // Safely get numeric price value
      const price = Number(v.discountPrice || v.basePrice);

      // Validate numeric value
      if (typeof price !== "number" || isNaN(price) || !isFinite(price)) {
        return min;
      }

      return price < min ? price : min;
    }, Infinity);

    return lowestPrice === Infinity ? 0 : lowestPrice;
  } catch (err) {
    console.error("Error calculating lowest price:", err);
    return 0;
  }
};

/**
 * Safely calculate total stock from product variations
 * Handles malformed or empty variation arrays gracefully
 *
 * @param {Array} variations - Array of product variations
 * @returns {number} - Total stock (0 if no valid variations)
 */
const calculateTotalStock = (variations) => {
  try {
    if (!Array.isArray(variations) || variations.length === 0) {
      return 0;
    }

    return variations.reduce((sum, v) => {
      const stock = Number(v.stock);

      // Validate numeric value
      if (typeof stock !== "number" || isNaN(stock) || !isFinite(stock)) {
        return sum;
      }

      return sum + stock;
    }, 0);
  } catch (err) {
    console.error("Error calculating total stock:", err);
    return 0;
  }
};

/**
 * @desc    Generate barcodes for products
 * @route   GET /api/barcode/generate
 * @access  Private (Admin/Employee)
 * @query   {string} startId - Optional: Start product ID for range
 * @query   {string} endId - Optional: End product ID for range
 */
const generateProductBarcodes = asyncHandler(async (req, res) => {
  const { startId, endId } = req.query;

  let query = { isActive: true };

  // If startId and endId are provided, filter by productId range
  if (startId && endId) {
    query.productId = {
      $gte: startId,
      $lte: endId,
    };
  } else if (startId) {
    query.productId = startId;
  } else if (endId) {
    query.productId = endId;
  }

  // Fetch products from database
  const products = await Product.find(query)
    .select("productId barcode name bannerImage variation")
    .sort({ productId: 1 });

  if (!products || products.length === 0) {
    return res.status(404).json({
      success: false,
      message: "No products found",
    });
  }

  // Generate barcodes for each product
  const productsWithBarcodes = await Promise.all(
    products.map(async (product) => {
      try {
        // Get barcode value (barcode or fallback to productId)
        const barcodeValue = Product.getBarcodeValue(product);

        if (
          !Array.isArray(product.variation) ||
          product.variation.length === 0
        ) {
          throw new Error(
            `Product "${product.name}" has no valid variations. Cannot generate barcode for product without variations.`,
          );
        }

        // Generate barcode PNG using bwip-js (CODE128 format)
        const barcodeBuffer = await generateBarcodePngBuffer(barcodeValue);

        // Convert buffer to base64 data URI
        const barcodeBase64 = `data:image/png;base64,${barcodeBuffer.toString(
          "base64",
        )}`;

        // Get the lowest price from variations (safely calculated)
        const lowestPrice = calculateLowestPrice(product.variation);

        return {
          productId: product.productId,
          barcode: product.barcode || null,
          name: product.name,
          price: lowestPrice,
          coverImage: product.bannerImage,
          barcodeImage: barcodeBase64,
          barcodeValue: barcodeValue, // For reference (what was encoded)
        };
      } catch (error) {
        console.error(
          `❌ Error generating barcode for product ${product.productId}:`,
          {
            errorMessage: error.message,
            productId: product.productId,
            productName: product.name,
            hasVariations: Array.isArray(product.variation),
            variationCount: Array.isArray(product.variation)
              ? product.variation.length
              : 0,
          },
        );

        // Get the lowest price from variations (safely calculated)
        const lowestPrice = calculateLowestPrice(product.variation);

        return {
          productId: product.productId,
          barcode: product.barcode || null,
          name: product.name,
          price: lowestPrice,
          coverImage: product.bannerImage,
          barcodeImage: null,
          error: error.message || "Failed to generate barcode",
        };
      }
    }),
  );

  res.status(200).json({
    success: true,
    count: productsWithBarcodes.length,
    data: productsWithBarcodes,
  });
});

/**
 * @desc    Scan product barcode for POS system
 * @route   POST /api/barcode/scan
 * @access  Private (Manager/Admin/Employee)
 * @body    {string} scannedCode or code - Barcode or ProductId to scan
 *
 * Search Strategy:
 *  - Tries to find product by barcode field first
 *  - Falls back to productId search
 *  - Uses $or operator to search both fields in single query
 */
const scanProductForPOS = asyncHandler(async (req, res) => {
  const { scannedCode, code } = req.body;
  const barcodeValue = scannedCode || code;

  if (!barcodeValue) {
    return res.status(400).json({
      success: false,
      message: "Scanned code is required",
    });
  }

  const searchValue = String(barcodeValue).trim();

  // Find product by barcode, productId, top-level SKU, or variation SKU / size
  const product = await Product.findOne({
    $or: [
      { barcode: searchValue },
      { productId: searchValue },
      { sku: searchValue },
      { "variation.sku": searchValue },
      { "variation.size": searchValue },
    ],
    isActive: true,
  }).select("productId sku barcode name bannerImage variation vat");

  if (!product) {
    return res.status(404).json({
      success: false,
      message: "Product not found or inactive",
    });
  }

  // Find specific matched variation if scanned by SKU or variation ID / size
  let selectedVariation = null;
  if (Array.isArray(product.variation) && product.variation.length > 0) {
    const sLower = searchValue.toLowerCase();
    selectedVariation = product.variation.find(
      (v) =>
        (v.sku && String(v.sku).trim().toLowerCase() === sLower) ||
        (v.size && String(v.size).trim().toLowerCase() === sLower) ||
        (v._id && String(v._id) === searchValue)
    );
    // Fallback: if single variation exists
    if (!selectedVariation && product.variation.length === 1) {
      selectedVariation = product.variation[0];
    }
  }

  // Calculate total stock from all variations safely
  const totalStock = calculateTotalStock(product.variation);

  // Get the lowest price from variations safely
  const lowestPrice = calculateLowestPrice(product.variation);

  // Determine what was used to find the product
  const foundBy =
    product.barcode && product.barcode === searchValue
      ? "barcode"
      : "productId";

  // Check stock availability
  if (totalStock <= 0) {
    return res.status(200).json({
      success: true,
      message: "Product found but out of stock",
      selectedVariation,
      data: {
        _id: product._id,
        productId: product.productId,
        sku: product.sku,
        barcode: product.barcode || null,
        name: product.name,
        bannerImage: product.bannerImage,
        price: lowestPrice,
        totalStock,
        vat: product.vat || 0,
        variation: product.variation,
        foundBy: foundBy,
      },
      stockStatus: "OUT_OF_STOCK",
    });
  }

  res.status(200).json({
    success: true,
    message: "Product found",
    selectedVariation,
    data: {
      _id: product._id,
      productId: product.productId,
      sku: product.sku,
      barcode: product.barcode || null,
      name: product.name,
      bannerImage: product.bannerImage,
      price: lowestPrice,
      totalStock,
      vat: product.vat || 0,
      variation: product.variation,
      foundBy: foundBy,
    },
    stockStatus: "IN_STOCK",
  });
});

/**
 * @desc    Generate single product barcode
 * @route   GET /api/barcode/generate/:productId
 * @access  Private (Admin/Employee)
 * @param   {string} productId - Product ID to generate barcode for
 */
const generateSingleBarcode = asyncHandler(async (req, res) => {
  const { productId } = req.params;

  const product = await Product.findOne({ productId }).select(
    "productId barcode name bannerImage variation",
  );

  if (!product) {
    return res.status(404).json({
      success: false,
      message: "Product not found",
    });
  }

  // Validate product data before barcode generation
  if (!Array.isArray(product.variation) || product.variation.length === 0) {
    return res.status(400).json({
      success: false,
      message: `Product "${product.name}" has no valid variations. Cannot generate barcode for product without variations.`,
      error:
        "Missing or invalid product variations - please edit the product and ensure it has at least one variation",
    });
  }

  // Get the lowest price from variations safely
  const lowestPrice = calculateLowestPrice(product.variation);

  try {
    // Get barcode value (barcode or fallback to productId) using helper method
    const barcodeValue = Product.getBarcodeValue(product);

    // Generate barcode PNG using bwip-js (CODE128 format)
    const barcodeBuffer = await generateBarcodePngBuffer(barcodeValue);

    // Convert buffer to base64 data URI
    const barcodeBase64 = `data:image/png;base64,${barcodeBuffer.toString(
      "base64",
    )}`;

    res.status(200).json({
      success: true,
      data: {
        productId: product.productId,
        barcode: product.barcode || null,
        name: product.name,
        price: lowestPrice,
        coverImage: product.bannerImage,
        barcodeImage: barcodeBase64,
        barcodeValue: barcodeValue, // For reference (what was encoded)
      },
    });
  } catch (error) {
    console.error(`❌ Error generating barcode for product ${productId}:`, {
      errorMessage: error.message,
      productId: product.productId,
      productName: product.name,
      timestamp: new Date().toISOString(),
    });

    return res.status(500).json({
      success: false,
      message: "Failed to generate barcode",
      error:
        error.message ||
        "An error occurred while generating the barcode. Please contact support.",
      debugInfo: {
        productId: product.productId,
        reason:
          "Barcode generation failed - this could be due to invalid barcode/productId format or system issues",
      },
    });
  }
});

module.exports = {
  generateProductBarcodes,
  scanProductForPOS,
  generateSingleBarcode,
};
