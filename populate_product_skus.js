/**
 * ============================================================
 * populate_product_skus.js
 * ============================================================
 * Generates and populates unique SKUs for all products and variations
 * in the development/test database following the exact system pattern:
 * - 6-character uppercase alphanumeric strings (e.g. 8F3A29, 7K03YG)
 * - 100% collision-free across all products and variations
 * - Updates the development/test database directly via bulk operations
 * ============================================================
 */

require("dotenv").config();
const mongoose = require("mongoose");
const crypto = require("crypto");

const TARGET_MONGO_URI =
  process.env.MONGODB_URI ||
  "mongodb+srv://kamanashis:bVqUCGloGyQR53j2@cluster0.wg8xgkc.mongodb.net/shoppers-livestyle?retryWrites=true&w=majority&appName=Cluster0";

const CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function generateRandomSKU(length = 6) {
  const bytes = crypto.randomBytes(length);
  let result = "";
  for (let i = 0; i < length; i++) {
    result += CHARSET[bytes[i] % CHARSET.length];
  }
  return result;
}

function getUniqueSKU(usedSkusSet) {
  let sku;
  do {
    sku = generateRandomSKU(6);
  } while (usedSkusSet.has(sku));
  usedSkusSet.add(sku);
  return sku;
}

async function populateSKUs() {
  console.log("==================================================");
  console.log("   POPULATING PRODUCT & VARIATION SKUs");
  console.log("==================================================");

  await mongoose.connect(TARGET_MONGO_URI);
  console.log("Connected to MongoDB successfully!\n");

  const db = mongoose.connection.db;
  const productsCollection = db.collection("products");

  const products = await productsCollection.find({}).toArray();
  console.log(`Found ${products.length} products to process.`);

  const usedSkusSet = new Set();

  // First collect any non-empty valid uppercase existing SKUs
  products.forEach((p) => {
    if (p.sku && String(p.sku).trim() !== "") {
      usedSkusSet.add(String(p.sku).trim().toUpperCase());
    }
    if (Array.isArray(p.variation)) {
      p.variation.forEach((v) => {
        if (v.sku && String(v.sku).trim() !== "") {
          usedSkusSet.add(String(v.sku).trim().toUpperCase());
        }
      });
    }
  });

  console.log(`Found ${usedSkusSet.size} pre-existing SKUs. Generating unique SKUs for the rest...\n`);

  let updatedProductsCount = 0;
  let updatedVariationsCount = 0;
  const bulkOps = [];

  for (const prod of products) {
    let modified = false;

    // 1. Check top-level product SKU
    let productSku = prod.sku ? String(prod.sku).trim().toUpperCase() : null;
    if (!productSku || productSku === "") {
      productSku = getUniqueSKU(usedSkusSet);
      modified = true;
    }

    // 2. Check each variation SKU
    const variations = prod.variation || [];
    if (Array.isArray(variations)) {
      variations.forEach((v) => {
        let vSku = v.sku ? String(v.sku).trim().toUpperCase() : null;
        if (!vSku || vSku === "") {
          vSku = getUniqueSKU(usedSkusSet);
          v.sku = vSku;
          updatedVariationsCount++;
          modified = true;
        } else {
          v.sku = vSku;
        }
      });
    }

    if (modified) {
      updatedProductsCount++;
      bulkOps.push({
        updateOne: {
          filter: { _id: prod._id },
          update: {
            $set: {
              sku: productSku,
              variation: variations,
            },
          },
        },
      });
    }
  }

  if (bulkOps.length > 0) {
    console.log(`Executing bulkWrite for ${bulkOps.length} products...`);
    const result = await productsCollection.bulkWrite(bulkOps);
    console.log(`✓ BulkWrite completed: ${result.modifiedCount} documents modified.`);
  }

  console.log(`\n==================================================`);
  console.log(`Summary:`);
  console.log(`- Total products updated with product SKU: ${updatedProductsCount}`);
  console.log(`- Total variations updated with variation SKU: ${updatedVariationsCount}`);
  console.log(`- Total unique SKUs generated: ${usedSkusSet.size}`);
  console.log(`==================================================\n`);

  // Verification step
  const sample = await productsCollection.find({}).limit(5).toArray();
  console.log("Sample updated products:");
  sample.forEach((p) => {
    console.log(`- [${p.productId}] ${p.name} -> Product SKU: ${p.sku}`);
    if (p.variation) {
      p.variation.slice(0, 3).forEach((v, idx) => {
        console.log(`    Var #${idx + 1} (${v.size || "N/A"}/${v.color || "N/A"}): SKU = ${v.sku}`);
      });
    }
  });

  await mongoose.disconnect();
}

populateSKUs()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Error populating SKUs:", err);
    process.exit(1);
  });
