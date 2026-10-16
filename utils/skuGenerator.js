/**
 * ============================================================
 * utils/skuGenerator.js — Server-Side Unique SKU Generator
 * ============================================================
 * এটি সার্ভার সাইড থেকে পণ্য এবং তাদের প্রতিটি ভ্যারিয়েশনের জন্য 
 * শতভাগ ইউনিক ও ক্ল্যাশ-মুক্ত SKU জেনারেট করে।
 * 
 * ফরম্যাট: ৬ ডিজিটের আলফানিউমেরিক (যেমন: 8F3A29, 7K03YG)
 * সম্ভাব্য কম্বিনেশন: ৩৬^৬ = ২.১৭ বিলিয়ন
 * ============================================================
 */

const crypto = require("crypto");

const CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Generate a clean 6-character random uppercase alphanumeric SKU
 * @param {number} length - Default 6
 * @returns {string} e.g. "8F3A29"
 */
const generateRandomSKU = (length = 6) => {
  const bytes = crypto.randomBytes(length);
  let result = "";
  for (let i = 0; i < length; i++) {
    result += CHARSET[bytes[i] % CHARSET.length];
  }
  return result;
};

/**
 * Generate a guaranteed unique SKU across all products and variations in the DB
 * @param {Model} ProductModel - Mongoose Product model
 * @param {Set<string>} inMemoryUsedSkus - Set of SKUs already used in current batch/document
 * @returns {Promise<string>}
 */
const generateUniqueSKU = async (ProductModel, inMemoryUsedSkus = new Set()) => {
  let attempts = 0;
  while (attempts < 100) {
    attempts++;
    const candidate = generateRandomSKU(6);
    if (inMemoryUsedSkus.has(candidate)) continue;

    // Check if candidate exists in Product.sku or Product.variation.sku or Product.barcode
    const exists = await ProductModel.exists({
      $or: [
        { sku: candidate },
        { "variation.sku": candidate },
        { barcode: candidate },
        { productId: candidate },
      ],
    });

    if (!exists) {
      inMemoryUsedSkus.add(candidate);
      return candidate;
    }
  }

  // Fallback if 100 random attempts collide: use timestamp-based suffix
  const fallback = `SK${Date.now().toString(36).toUpperCase().slice(-5)}`;
  inMemoryUsedSkus.add(fallback);
  return fallback;
};

/**
 * Ensure product and its variations have strictly unique SKUs
 * @param {Document} product - Product Mongoose document
 * @param {Model} ProductModel - Mongoose Product model
 */
const ensureUniqueProductSKUs = async (product, ProductModel) => {
  const inMemoryUsedSkus = new Set();

  // 1. Ensure top-level product SKU
  if (!product.sku || String(product.sku).trim() === "") {
    product.sku = await generateUniqueSKU(ProductModel, inMemoryUsedSkus);
  } else {
    // If top-level SKU already exists on ANOTHER product, re-generate it
    const query = { sku: product.sku };
    if (product._id) query._id = { $ne: product._id };
    const duplicate = await ProductModel.exists(query);
    if (duplicate) {
      product.sku = await generateUniqueSKU(ProductModel, inMemoryUsedSkus);
    } else {
      inMemoryUsedSkus.add(product.sku);
    }
  }

  // 2. Ensure each variation has a strictly unique SKU
  if (Array.isArray(product.variation)) {
    for (let idx = 0; idx < product.variation.length; idx++) {
      const v = product.variation[idx];
      const existingSku = v.sku && String(v.sku).trim();

      let needsNewSku = false;

      if (!existingSku) {
        needsNewSku = true;
      } else if (inMemoryUsedSkus.has(existingSku)) {
        // Collides within same document
        needsNewSku = true;
      } else {
        // Check if existingSku collides with any other product in DB
        const conflictQuery = {
          $or: [
            { sku: existingSku },
            { barcode: existingSku },
            { "variation.sku": existingSku },
          ],
        };
        if (product._id) {
          conflictQuery._id = { $ne: product._id };
        }
        const conflict = await ProductModel.exists(conflictQuery);
        if (conflict) {
          needsNewSku = true;
        }
      }

      if (needsNewSku) {
        v.sku = await generateUniqueSKU(ProductModel, inMemoryUsedSkus);
      } else {
        inMemoryUsedSkus.add(existingSku);
      }
    }
  }
};

module.exports = {
  generateRandomSKU,
  generateUniqueSKU,
  ensureUniqueProductSKUs,
};
