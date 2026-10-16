/**
 * ============================================================
 * services/inventoryService.js — Centralized Inventory Engine
 * ============================================================
 * Strictly enforces all 15 Non-Negotiable Business Rules:
 *  1. Exactly 3 locations: display, shopStock, warehouse.
 *  2. Shop Sale Priority: display -> shopStock -> warehouse.
 *  3. Online Sale Priority: shopStock -> warehouse -> display.
 *  4. Shop Return: always -> display.
 *  5. Online Return: always -> display.
 *  6. Exchange: Old -> display, New -> typed priority (Shop vs Online), same Exchange ID.
 *  7. Online Cancellation: restore exact deductions to original source locations.
 *  8. Missing deductions on cancellation: throw HISTORICAL_ALLOCATION_REQUIRED.
 *  9. Concurrency & Negative inventory prevention.
 * 10. Immutable StockMovement logging for every operation inside MongoDB transactions.
 * ============================================================
 */

const mongoose = require("mongoose");
const Product = require("../models/Product");
const StockMovement = require("../models/StockMovement");

const VALID_LOCATIONS = ["display", "shopStock", "warehouse"];
const VALID_ADJUSTMENT_REASONS = [
  "Damaged",
  "Expired",
  "Lost",
  "Broken",
  "Sample/Test",
  "Stock Correction",
  "Other",
];

class InventoryError extends Error {
  constructor(message, code = "INVENTORY_ERROR", details = {}) {
    super(message);
    this.name = "InventoryError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Helper: Find variation within a product document
 */
function findVariation(product, variationId, size, color) {
  if (!product || !Array.isArray(product.variation) || product.variation.length === 0) {
    return null;
  }
  if (variationId) {
    const vIdStr = String(variationId);
    const found = product.variation.find((v) => String(v._id) === vIdStr);
    if (found) return found;
  }
  if (size || color) {
    const s = String(size || "").trim().toLowerCase();
    const c = String(color || "").trim().toLowerCase();
    const found = product.variation.find((v) => {
      const vs = String(v.size || "").trim().toLowerCase();
      const vc = String(v.color || "").trim().toLowerCase();
      return (!s || vs === s) && (!c || vc === c);
    });
    if (found) return found;
  }
  return product.variation[0];
}

/**
 * Concurrency-Safe Location Deduction Helper
 * @param {Object} variation - Product variation object
 * @param {number} qtyToDeduct - Quantity requested
 * @param {Array<string>} priorityOrder - Sequence of locations to deplete
 * @returns {Array<{ location: string, quantity: number }>} - exact slices deducted
 */
function allocateDeduction(variation, qtyToDeduct, priorityOrder) {
  let remaining = qtyToDeduct;
  const current = {
    display: Number(variation.locations?.display || 0),
    shopStock: Number(variation.locations?.shopStock || 0),
    warehouse: Number(variation.locations?.warehouse || 0),
  };

  const totalAvailable = current.display + current.shopStock + current.warehouse;
  if (totalAvailable < qtyToDeduct) {
    throw new InventoryError(
      `Insufficient stock for "${variation.size || variation.color || "Product"}". Requested: ${qtyToDeduct}, Available: ${totalAvailable} (Shortage: ${qtyToDeduct - totalAvailable})`,
      "INSUFFICIENT_STOCK",
      { requested: qtyToDeduct, available: totalAvailable, shortage: qtyToDeduct - totalAvailable }
    );
  }

  const deductions = [];

  for (const loc of priorityOrder) {
    if (remaining <= 0) break;
    const availInLoc = current[loc];
    if (availInLoc > 0) {
      const take = Math.min(availInLoc, remaining);
      current[loc] -= take;
      remaining -= take;
      deductions.push({ location: loc, quantity: take });
    }
  }

  if (remaining > 0) {
    throw new InventoryError(
      `Could not allocate full quantity across locations. Remainder: ${remaining}`,
      "INSUFFICIENT_STOCK",
      { shortage: remaining }
    );
  }

  // Prevent negative inventory check
  for (const loc of VALID_LOCATIONS) {
    if (current[loc] < 0) {
      throw new InventoryError(
        `Negative inventory detected in location ${loc}. Allocation aborted.`,
        "NEGATIVE_INVENTORY_PREVENTED",
        { location: loc, balance: current[loc] }
      );
    }
  }

  // Apply to variation
  variation.locations = {
    display: current.display,
    shopStock: current.shopStock,
    warehouse: current.warehouse,
  };
  variation.stock = current.display + current.shopStock + current.warehouse;

  return deductions;
}

/**
 * 1. DEDUCT FOR SHOP SALE (POS Sale)
 * Priority: display -> shopStock -> warehouse
 */
async function deductForShopSale({ orderId, items, user, session }) {
  const priority = ["display", "shopStock", "warehouse"];
  const movements = [];
  const processedItems = [];

  for (const item of items) {
    const product = await Product.findById(item.productId).session(session);
    if (!product) {
      throw new InventoryError(`Product not found with id: ${item.productId}`, "PRODUCT_NOT_FOUND");
    }

    const variation = findVariation(product, item.variationId, item.size, item.color);
    if (!variation) {
      throw new InventoryError(`Variation not found for product: ${product.name}`, "VARIATION_NOT_FOUND");
    }

    const reqQty = Number(item.quantity) || 1;
    const slices = allocateDeduction(variation, reqQty, priority);

    product.markModified("variation");
    await product.save({ session });

    // Create StockMovement for each deducted slice
    for (const slice of slices) {
      const movement = new StockMovement({
        product: product._id,
        productName: product.name,
        variationId: variation._id,
        sku: variation.sku || product.productId || "",
        quantity: slice.quantity,
        fromLocation: slice.location,
        toLocation: "customer",
        transactionType: "shop_sale",
        orderId: orderId || "",
        user: user?._id || user?.id || null,
        userName: user?.name || "Cashier",
        reason: "Shop POS Sale Checkout",
      });
      await movement.save({ session });
      movements.push(movement);
    }

    processedItems.push({
      ...item,
      deductions: slices,
      purchasePrice: variation.purchasePrice || 0,
      productIdCode: product.productId || "",
    });
  }

  return { processedItems, movements };
}

/**
 * 2. DEDUCT FOR ONLINE ORDER (Website Sale)
 * Priority: shopStock -> warehouse -> display
 * Stores deductions: [{ location, quantity }] per item
 */
async function deductForOnlineOrder({ orderId, items, user, session }) {
  const priority = ["shopStock", "warehouse", "display"];
  const movements = [];
  const processedItems = [];

  for (const item of items) {
    const product = await Product.findById(item.productId).session(session);
    if (!product) {
      throw new InventoryError(`Product not found with id: ${item.productId}`, "PRODUCT_NOT_FOUND");
    }

    const variation = findVariation(product, item.variationId, item.size, item.color);
    if (!variation) {
      throw new InventoryError(`Variation not found for product: ${product.name}`, "VARIATION_NOT_FOUND");
    }

    const reqQty = Number(item.quantity) || 1;
    const slices = allocateDeduction(variation, reqQty, priority);

    product.markModified("variation");
    await product.save({ session });

    // Create StockMovement for each slice
    for (const slice of slices) {
      const movement = new StockMovement({
        product: product._id,
        productName: product.name,
        variationId: variation._id,
        sku: variation.sku || product.productId || "",
        quantity: slice.quantity,
        fromLocation: slice.location,
        toLocation: "customer",
        transactionType: "online_sale",
        orderId: orderId || "",
        user: user?._id || user?.id || null,
        userName: user?.name || "Online Customer",
        reason: "Online Order Placed",
      });
      await movement.save({ session });
      movements.push(movement);
    }

    processedItems.push({
      ...item,
      deductions: slices,
      purchasePrice: variation.purchasePrice || 0,
      productIdCode: product.productId || "",
    });
  }

  return { processedItems, movements };
}

/**
 * 3. RESTORE ONLINE CANCELLATION
 * Restores exact original deductions to their original locations.
 * If deductions are missing (Historical Order): BLOCKS and throws HISTORICAL_ALLOCATION_REQUIRED!
 */
async function restoreOnlineCancellation({ order, user, session }) {
  if (!order || !Array.isArray(order.products)) {
    throw new InventoryError("Invalid order data for cancellation", "INVALID_ORDER");
  }

  // 1. Verify all items have deductions history
  for (const item of order.products) {
    if (!Array.isArray(item.deductions) || item.deductions.length === 0) {
      throw new InventoryError(
        "Historical Stock Allocation Required: This order was placed prior to location tracking. Automatic stock restoration is blocked to prevent location corruption. Please use Manual Stock Adjustment/Reconciliation.",
        "HISTORICAL_ALLOCATION_REQUIRED",
        { orderId: order.orderId || order._id, productId: item.productId }
      );
    }
  }

  const movements = [];

  // 2. Restore each item back to exact location(s)
  for (const item of order.products) {
    const product = await Product.findById(item.productId).session(session);
    if (!product) continue;

    const variation = findVariation(product, item.variationId, item.size, item.color);
    if (!variation) continue;

    if (!variation.locations) {
      variation.locations = { display: 0, shopStock: 0, warehouse: 0 };
    }

    for (const slice of item.deductions) {
      const targetLoc = slice.location;
      const qtyToRestore = Number(slice.quantity) || 0;
      if (qtyToRestore <= 0) continue;

      if (!VALID_LOCATIONS.includes(targetLoc)) {
        throw new InventoryError(`Invalid deduction location: ${targetLoc}`, "INVALID_LOCATION");
      }

      variation.locations[targetLoc] = Number(variation.locations[targetLoc] || 0) + qtyToRestore;

      const movement = new StockMovement({
        product: product._id,
        productName: product.name,
        variationId: variation._id,
        sku: variation.sku || product.productId || "",
        quantity: qtyToRestore,
        fromLocation: "customer",
        toLocation: targetLoc,
        transactionType: "online_cancel_restore",
        orderId: order.orderId || order._id,
        user: user?._id || user?.id || null,
        userName: user?.name || "Admin",
        reason: "Online Order Cancellation - Restored to exact source location",
      });
      await movement.save({ session });
      movements.push(movement);
    }

    variation.stock =
      Number(variation.locations.display || 0) +
      Number(variation.locations.shopStock || 0) +
      Number(variation.locations.warehouse || 0);

    product.markModified("variation");
    await product.save({ session });
  }

  return { movements };
}

/**
 * 4. RESTORE FOR SHOP RETURN
 * All Shop Returns go strictly to -> display
 */
async function restoreForShopReturn({ orderId, items, user, session }) {
  const movements = [];

  for (const item of items) {
    const product = await Product.findById(item.productId).session(session);
    if (!product) {
      throw new InventoryError(`Product not found: ${item.productId}`, "PRODUCT_NOT_FOUND");
    }

    const variation = findVariation(product, item.variationId, item.size, item.color);
    if (!variation) {
      throw new InventoryError(`Variation not found for product: ${product.name}`, "VARIATION_NOT_FOUND");
    }

    const qty = Number(item.quantity) || 1;
    if (!variation.locations) {
      variation.locations = { display: 0, shopStock: 0, warehouse: 0 };
    }

    // Always restore strictly to DISPLAY
    variation.locations.display = Number(variation.locations.display || 0) + qty;
    variation.stock =
      Number(variation.locations.display || 0) +
      Number(variation.locations.shopStock || 0) +
      Number(variation.locations.warehouse || 0);

    product.markModified("variation");
    await product.save({ session });

    const movement = new StockMovement({
      product: product._id,
      productName: product.name,
      variationId: variation._id,
      sku: variation.sku || product.productId || "",
      quantity: qty,
      fromLocation: "customer",
      toLocation: "display",
      transactionType: "shop_return",
      orderId: orderId || "",
      user: user?._id || user?.id || null,
      userName: user?.name || "Manager",
      reason: item.reason || "Customer Shop Return Restocked to Display",
    });
    await movement.save({ session });
    movements.push(movement);
  }

  return { movements };
}

/**
 * 5. RESTORE FOR ONLINE RETURN
 * All Online Returns go strictly to -> display
 */
async function restoreForOnlineReturn({ returnId, orderId, productDoc, variationId, size, color, quantity, user, session }) {
  const variation = findVariation(productDoc, variationId, size, color);
  if (!variation) {
    throw new InventoryError(`Variation not found for product: ${productDoc.name}`, "VARIATION_NOT_FOUND");
  }

  const qty = Number(quantity) || 1;
  if (!variation.locations) {
    variation.locations = { display: 0, shopStock: 0, warehouse: 0 };
  }

  // Always restore strictly to DISPLAY
  variation.locations.display = Number(variation.locations.display || 0) + qty;
  variation.stock =
    Number(variation.locations.display || 0) +
    Number(variation.locations.shopStock || 0) +
    Number(variation.locations.warehouse || 0);

  productDoc.markModified("variation");
  await productDoc.save({ session });

  const movement = new StockMovement({
    product: productDoc._id,
    productName: productDoc.name,
    variationId: variation._id,
    sku: variation.sku || productDoc.productId || "",
    quantity: qty,
    fromLocation: "customer",
    toLocation: "display",
    transactionType: "online_return",
    orderId: orderId || "",
    referenceId: returnId || "",
    user: user?._id || user?.id || null,
    userName: user?.name || "Admin",
    reason: "Delivered Online Parcel Returned - Restocked to Display Counter",
  });
  await movement.save({ session });

  return movement;
}

/**
 * 6. PROCESS SHOP EXCHANGE
 * Old product -> display
 * New product -> display -> shopStock -> warehouse
 * Both movements share the same Exchange ID!
 */
async function processShopExchange({ exchangeId, orderId, originalItems, replacementItems, user, session }) {
  const movements = [];

  // Step A: Old product returned -> strictly DISPLAY
  for (const item of originalItems) {
    const product = await Product.findById(item.originalProductId || item.productId).session(session);
    if (!product) throw new InventoryError("Original product not found", "PRODUCT_NOT_FOUND");

    const variation = findVariation(product, item.originalVariationId || item.variationId, item.originalSize || item.size, item.originalColor || item.color);
    if (!variation) throw new InventoryError("Original variation not found", "VARIATION_NOT_FOUND");

    const qty = Number(item.quantity) || 1;
    if (!variation.locations) variation.locations = { display: 0, shopStock: 0, warehouse: 0 };

    variation.locations.display = Number(variation.locations.display || 0) + qty;
    variation.stock = Number(variation.locations.display || 0) + Number(variation.locations.shopStock || 0) + Number(variation.locations.warehouse || 0);

    product.markModified("variation");
    await product.save({ session });

    const movement = new StockMovement({
      product: product._id,
      productName: product.name,
      variationId: variation._id,
      sku: variation.sku || product.productId || "",
      quantity: qty,
      fromLocation: "customer",
      toLocation: "display",
      transactionType: "shop_exchange_return",
      exchangeId: String(exchangeId),
      orderId: String(orderId || ""),
      user: user?._id || user?.id || null,
      userName: user?.name || "Salesman",
      reason: "Shop Exchange - Returned Item restocked to Display",
    });
    await movement.save({ session });
    movements.push(movement);
  }

  // Step B: New replacement product issued -> display -> shopStock -> warehouse
  const shopPriority = ["display", "shopStock", "warehouse"];
  for (const item of replacementItems) {
    const product = await Product.findById(item.replacementProductId || item.productId).session(session);
    if (!product) throw new InventoryError("Replacement product not found", "PRODUCT_NOT_FOUND");

    const variation = findVariation(product, item.replacementVariationId || item.variationId, item.replacementSize || item.size, item.replacementColor || item.color);
    if (!variation) throw new InventoryError("Replacement variation not found", "VARIATION_NOT_FOUND");

    const reqQty = Number(item.quantity) || 1;
    const slices = allocateDeduction(variation, reqQty, shopPriority);

    product.markModified("variation");
    await product.save({ session });

    for (const slice of slices) {
      const movement = new StockMovement({
        product: product._id,
        productName: product.name,
        variationId: variation._id,
        sku: variation.sku || product.productId || "",
        quantity: slice.quantity,
        fromLocation: slice.location,
        toLocation: "customer",
        transactionType: "shop_exchange_issue",
        exchangeId: String(exchangeId),
        orderId: String(orderId || ""),
        user: user?._id || user?.id || null,
        userName: user?.name || "Salesman",
        reason: "Shop Exchange - Replacement Item Issued",
      });
      await movement.save({ session });
      movements.push(movement);
    }
  }

  return { movements };
}

/**
 * 7. PROCESS ONLINE EXCHANGE
 * Old product -> display
 * New product -> shopStock -> warehouse -> display
 * Both movements share the same Exchange ID!
 */
async function processOnlineExchange({ exchangeId, orderId, originalItems, replacementItems, user, session }) {
  const movements = [];

  // Step A: Old product returned -> strictly DISPLAY
  for (const item of originalItems) {
    const product = await Product.findById(item.originalProductId || item.productId).session(session);
    if (!product) throw new InventoryError("Original product not found", "PRODUCT_NOT_FOUND");

    const variation = findVariation(product, item.originalVariationId || item.variationId, item.originalSize || item.size, item.originalColor || item.color);
    if (!variation) throw new InventoryError("Original variation not found", "VARIATION_NOT_FOUND");

    const qty = Number(item.quantity) || 1;
    if (!variation.locations) variation.locations = { display: 0, shopStock: 0, warehouse: 0 };

    variation.locations.display = Number(variation.locations.display || 0) + qty;
    variation.stock = Number(variation.locations.display || 0) + Number(variation.locations.shopStock || 0) + Number(variation.locations.warehouse || 0);

    product.markModified("variation");
    await product.save({ session });

    const movement = new StockMovement({
      product: product._id,
      productName: product.name,
      variationId: variation._id,
      sku: variation.sku || product.productId || "",
      quantity: qty,
      fromLocation: "customer",
      toLocation: "display",
      transactionType: "online_exchange_return",
      exchangeId: String(exchangeId),
      orderId: String(orderId || ""),
      user: user?._id || user?.id || null,
      userName: user?.name || "Admin",
      reason: "Online Exchange - Returned parcel restocked to Display",
    });
    await movement.save({ session });
    movements.push(movement);
  }

  // Step B: New replacement product issued -> shopStock -> warehouse -> display
  const onlinePriority = ["shopStock", "warehouse", "display"];
  for (const item of replacementItems) {
    const product = await Product.findById(item.replacementProductId || item.productId).session(session);
    if (!product) throw new InventoryError("Replacement product not found", "PRODUCT_NOT_FOUND");

    const variation = findVariation(product, item.replacementVariationId || item.variationId, item.replacementSize || item.size, item.replacementColor || item.color);
    if (!variation) throw new InventoryError("Replacement variation not found", "VARIATION_NOT_FOUND");

    const reqQty = Number(item.quantity) || 1;
    const slices = allocateDeduction(variation, reqQty, onlinePriority);

    product.markModified("variation");
    await product.save({ session });

    for (const slice of slices) {
      const movement = new StockMovement({
        product: product._id,
        productName: product.name,
        variationId: variation._id,
        sku: variation.sku || product.productId || "",
        quantity: slice.quantity,
        fromLocation: slice.location,
        toLocation: "customer",
        transactionType: "online_exchange_issue",
        exchangeId: String(exchangeId),
        orderId: String(orderId || ""),
        user: user?._id || user?.id || null,
        userName: user?.name || "Admin",
        reason: "Online Exchange - Replacement Item Issued",
      });
      await movement.save({ session });
      movements.push(movement);
    }
  }

  return { movements };
}

/**
 * 8. MANUAL STOCK TRANSFER
 * Atomic transfer between any 2 locations: display <-> shopStock <-> warehouse
 */
async function transferStock({ productId, variationId, fromLocation, toLocation, quantity, reason, note, user, session }) {
  if (!VALID_LOCATIONS.includes(fromLocation) || !VALID_LOCATIONS.includes(toLocation)) {
    throw new InventoryError(`Invalid locations. Allowed: ${VALID_LOCATIONS.join(", ")}`, "INVALID_LOCATION");
  }
  if (fromLocation === toLocation) {
    throw new InventoryError("Source and destination locations must be different.", "SAME_LOCATION");
  }

  const transferQty = parseInt(quantity, 10);
  if (isNaN(transferQty) || transferQty <= 0) {
    throw new InventoryError("Transfer quantity must be a positive integer.", "INVALID_QUANTITY");
  }

  const product = await Product.findById(productId).session(session);
  if (!product) throw new InventoryError("Product not found", "PRODUCT_NOT_FOUND");

  const variation = findVariation(product, variationId);
  if (!variation) throw new InventoryError("Product variation not found", "VARIATION_NOT_FOUND");

  if (!variation.locations) {
    variation.locations = { display: variation.stock || 0, shopStock: 0, warehouse: 0 };
  }

  const avail = Number(variation.locations[fromLocation] || 0);
  if (avail < transferQty) {
    throw new InventoryError(
      `Insufficient stock in ${fromLocation}. Available: ${avail}, Requested: ${transferQty}`,
      "INSUFFICIENT_STOCK",
      { location: fromLocation, available: avail, requested: transferQty }
    );
  }

  // Atomic shift
  variation.locations[fromLocation] = avail - transferQty;
  variation.locations[toLocation] = Number(variation.locations[toLocation] || 0) + transferQty;

  // Real total stock is strictly preserved
  variation.stock =
    Number(variation.locations.display || 0) +
    Number(variation.locations.shopStock || 0) +
    Number(variation.locations.warehouse || 0);

  product.markModified("variation");
  await product.save({ session });

  const movement = new StockMovement({
    product: product._id,
    productName: product.name,
    variationId: variation._id,
    sku: variation.sku || product.productId || "",
    quantity: transferQty,
    fromLocation,
    toLocation,
    transactionType: "manual_transfer",
    user: user?._id || user?.id || null,
    userName: user?.name || "Staff",
    reason: reason || "Manual Location Stock Transfer",
    note: note || "",
  });
  await movement.save({ session });

  return { variation, movement };
}

/**
 * 9. STOCK ADJUSTMENT (Damage / Loss / Correction)
 * Deducts stock with mandatory reason and creates audit trail.
 */
async function adjustStock({ productId, variationId, location, quantity, reason, note, user, session }) {
  if (!VALID_LOCATIONS.includes(location)) {
    throw new InventoryError(`Invalid location: ${location}. Allowed: ${VALID_LOCATIONS.join(", ")}`, "INVALID_LOCATION");
  }
  if (!VALID_ADJUSTMENT_REASONS.includes(reason)) {
    throw new InventoryError(`Invalid adjustment reason. Allowed: ${VALID_ADJUSTMENT_REASONS.join(", ")}`, "INVALID_REASON");
  }

  const adjustQty = parseInt(quantity, 10);
  if (isNaN(adjustQty) || adjustQty <= 0) {
    throw new InventoryError("Adjustment quantity must be a positive integer.", "INVALID_QUANTITY");
  }

  const product = await Product.findById(productId).session(session);
  if (!product) throw new InventoryError("Product not found", "PRODUCT_NOT_FOUND");

  const variation = findVariation(product, variationId);
  if (!variation) throw new InventoryError("Product variation not found", "VARIATION_NOT_FOUND");

  if (!variation.locations) {
    variation.locations = { display: variation.stock || 0, shopStock: 0, warehouse: 0 };
  }

  const avail = Number(variation.locations[location] || 0);
  if (avail < adjustQty) {
    throw new InventoryError(
      `Cannot adjust ${adjustQty} pcs from ${location}. Current stock is only ${avail}.`,
      "INSUFFICIENT_STOCK",
      { location, available: avail, requested: adjustQty }
    );
  }

  variation.locations[location] = avail - adjustQty;
  variation.stock =
    Number(variation.locations.display || 0) +
    Number(variation.locations.shopStock || 0) +
    Number(variation.locations.warehouse || 0);

  product.markModified("variation");
  await product.save({ session });

  // Map adjustment reason to destination audit tag
  const toTag = reason.toLowerCase().includes("damage")
    ? "damaged"
    : reason.toLowerCase().includes("expire")
    ? "expired"
    : reason.toLowerCase().includes("lost")
    ? "lost"
    : reason.toLowerCase().includes("broken")
    ? "broken"
    : reason.toLowerCase().includes("sample")
    ? "sample"
    : "correction";

  const movement = new StockMovement({
    product: product._id,
    productName: product.name,
    variationId: variation._id,
    sku: variation.sku || product.productId || "",
    quantity: adjustQty,
    fromLocation: location,
    toLocation: toTag,
    transactionType: "stock_adjustment",
    user: user?._id || user?.id || null,
    userName: user?.name || "Admin",
    reason: `Stock Adjustment: ${reason}`,
    note: note || "",
  });
  await movement.save({ session });

  return { variation, movement };
}

module.exports = {
  VALID_LOCATIONS,
  VALID_ADJUSTMENT_REASONS,
  InventoryError,
  deductForShopSale,
  deductForOnlineOrder,
  restoreOnlineCancellation,
  restoreForShopReturn,
  restoreForOnlineReturn,
  processShopExchange,
  processOnlineExchange,
  transferStock,
  adjustStock,
};
