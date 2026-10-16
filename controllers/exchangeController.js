/**
 * ============================================================
 * controllers/exchangeController.js — Replace / Exchange Controller
 * ============================================================
 * ম্যানেজার এবং অ্যাডমিন কর্তৃক ক্রয়কৃত প্রডাক্ট অন্য প্রডাক্টের সাথে Replace/Exchange করার কন্ট্রোলার।
 * 
 * গুরুত্বপূর্ণ নিয়মাবলী:
 *  1. স্ট্রিক্ট রোল পারমিশন: কেবল Admin এবং Manager এক্সচেঞ্জ প্রসেস করতে পারে। (Employee View-Only)
 *  2. স্টক সেফটি: পুরো অপারেশনটি Mongoose Session Transaction-এর মাধ্যমে এটমিকভাবে সম্পন্ন হয়।
 *  3. রিয়েল-টাইম স্টক অ্যাডজাস্টমেন্ট:
 *      - মূল প্রডাক্টের স্টক: +exchangeQuantity সমপরিমাণ যুক্ত হবে।
 *      - নতুন প্রডাক্টের স্টক: -exchangeQuantity সমপরিমাণ বিয়োগ হবে (পর্যাপ্ত স্টক না থাকলে রোলব্যাক)।
 *      - একই প্রডাক্ট ও ভ্যারিয়েশন হলে স্টক অপরিবর্তিত থাকবে।
 *  4. অবশিষ্ট কোয়ান্টিটি ট্র্যাকিং: (Ordered Qty - Exchanged Qty) এর চেয়ে বেশি এক্সচেঞ্জ করা যাবে না।
 *  5. মূল্য পার্থক্য হিসাব: 
 *      - Replacement Total < Original Total → Cash Change
 *      - Replacement Total > Original Total → Additional Payment (Payment Method সহ)
 *      - Replacement Total == Original Total → Even Exchange
 * ============================================================
 */

const mongoose = require("mongoose");
const asyncHandler = require("../utils/asyncHandler");
const Exchange = require("../models/Exchange");
const Order = require("../models/Order");
const Product = require("../models/Product");
const Customer = require("../models/Customer");
const { logActivity } = require("../utils/activityLogger");
const inventoryService = require("../services/inventoryService");
const { generateCustomId } = require("../utils/customIdGenerator");

// @desc    Process a new Replace / Exchange transaction
// @route   POST /api/exchange
// @access  Private (Admin, Manager only)
const processExchange = asyncHandler(async (req, res) => {
  const {
    orderId, // Mongo ID or ORD- custom ID
    originalProductId,
    originalVariationId,
    originalSize,
    originalColor,
    replacementProductId,
    replacementVariationId,
    replacementSize,
    replacementColor,
    exchangeQuantity,
    paymentMethod,
    notes,
  } = req.body;

  if (!orderId) {
    return res.status(400).json({
      success: false,
      message: "Order ID is required to process exchange",
    });
  }

  // Parse Original Items (Supports 1 or Multiple Returned Products)
  let rawOrigItems = req.body.originalItems;
  if (!Array.isArray(rawOrigItems) || rawOrigItems.length === 0) {
    if (originalProductId) {
      rawOrigItems = [
        {
          originalProductId,
          originalVariationId,
          originalSize,
          originalColor,
          quantity: Number(exchangeQuantity) || 1,
        },
      ];
    } else {
      return res.status(400).json({
        success: false,
        message: "At least one original product must be selected to exchange",
      });
    }
  }

  let numExchangeQty = Number(exchangeQuantity);
  if (!numExchangeQty || numExchangeQty < 1) {
    numExchangeQty = rawOrigItems.reduce((sum, it) => sum + (Number(it.quantity) || 1), 0);
  }

  if (!numExchangeQty || numExchangeQty < 1) {
    return res.status(400).json({
      success: false,
      message: "Exchange quantity must be at least 1",
    });
  }

  // Parse Replacement Items (Supports 1 or Multiple Replacement Products)
  let rawRepItems = req.body.replacementItems;
  if (!Array.isArray(rawRepItems) || rawRepItems.length === 0) {
    if (replacementProductId) {
      rawRepItems = [
        {
          replacementProductId,
          replacementVariationId,
          replacementSize,
          replacementColor,
          quantity: Number(exchangeQuantity) || 1,
        },
      ];
    } else {
      return res.status(400).json({
        success: false,
        message: "At least one replacement product must be selected",
      });
    }
  }

  // Start Mongoose session transaction for strict atomic stock safety
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 1. Find Order
    let query = {};
    if (mongoose.Types.ObjectId.isValid(orderId)) {
      query = { $or: [{ _id: orderId }, { orderId: orderId }] };
    } else {
      query = { orderId: orderId };
    }

    const order = await Order.findOne(query).session(session);
    if (!order) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        success: false,
        message: `Shop order not found with ID: ${orderId}`,
      });
    }

    // Pre-generate exchange custom ID
    const exchangeCustomId = await generateCustomId(
      "EXC",
      Exchange,
      "exchangeId",
      "exchangeId"
    );

    // 2. Process Original Items (Restoring stock & checking remaining quantity)
    // Calculate net product subtotal (selling price after item-level discounts)
    const netProductSubtotal = (order.products || []).reduce(
      (sum, p) => sum + (Number(p.price || 0) * Number(p.quantity || 1)),
      0
    );

    // Calculate total item-level discounts already subtracted from originalPrice to get price
    const totalItemDiscounts = (order.products || []).reduce((sum, p) => {
      const origP = Number(p.originalPrice || (Number(p.price || 0) + Number(p.itemDiscount || 0)) || p.price || 0);
      const effP = Number(p.price || 0);
      const disc = (p.itemDiscount !== undefined && Number(p.itemDiscount) > 0)
        ? Number(p.itemDiscount)
        : Math.max(0, origP - effP);
      return sum + disc * Number(p.quantity || 1);
    }, 0);

    const orderVatWaivedAmount = Boolean(order.isVatDiscount || (order.vatDiscountAmount && Number(order.vatDiscountAmount) > 0))
      ? Number(order.vatDiscountAmount || order.vatAmount || 0)
      : 0;

    const totalDiscountRecorded = Number(order.discountAmount || 0);
    // Order-level discount is strictly the discount beyond item discounts and VAT waiver
    const orderLevelDiscount = Math.max(0, totalDiscountRecorded - totalItemDiscounts - orderVatWaivedAmount);

    // Order-level discount ratio applied to net product price (avoids double discount)
    const discountRatio = (netProductSubtotal > 0 && orderLevelDiscount > 0)
      ? Math.max(0, (netProductSubtotal - orderLevelDiscount) / netProductSubtotal)
      : 1;

    const processedOriginalItems = [];
    let totalOriginalPrice = 0;
    let totalOriginalVat = 0;
    let totalExchangeQty = 0;

    for (const item of rawOrigItems) {
      const origProdId = item.originalProductId || item.productId;
      const itemQty = Number(item.quantity || item.exchangeQuantity) || 1;

      if (!origProdId) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: "Invalid original product ID in returned items list",
        });
      }

      if (itemQty < 1) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: "Exchange quantity must be at least 1 for all returned items",
        });
      }

      // Locate item in order.products
      const orderItem = order.products.find((p) => {
        const matchProd = String(p.productId) === String(origProdId);
        const matchVar = item.originalVariationId || item.variationId
          ? String(p.variationId || "") === String(item.originalVariationId || item.variationId)
          : true;
        const matchSizeColor =
          (p.size || "").trim() === (item.originalSize || item.size || "").trim() &&
          (p.color || "").trim() === (item.originalColor || item.color || "").trim();
        return matchProd && (matchVar || matchSizeColor);
      });

      if (!orderItem) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({
          success: false,
          message: "One or more selected original products were not found in this order",
        });
      }

      const alreadyExchanged = Number(orderItem.exchangedQuantity) || 0;
      const remainingEligibleQty = Number(orderItem.quantity) - alreadyExchanged;

      if (itemQty > remainingEligibleQty) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: `Cannot exchange ${itemQty} units of "${orderItem.name}". Maximum remaining exchangeable quantity is ${remainingEligibleQty}. (Already exchanged: ${alreadyExchanged})`,
        });
      }

      // Find original Product & Variation
      const origProduct = await Product.findById(origProdId).session(session);
      if (!origProduct) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({
          success: false,
          message: `Original product definition not found for ID: ${origProdId}`,
        });
      }

      let origVar;
      if (item.originalVariationId || item.variationId) {
        const targetVarId = String(item.originalVariationId || item.variationId);
        origVar = origProduct.variation.find((v) => String(v._id) === targetVarId);
      } else {
        const targetSize = (item.originalSize || item.size || "").trim();
        const targetColor = (item.originalColor || item.color || "").trim();
        origVar =
          origProduct.variation.find(
            (v) =>
              (v.size || "").trim() === targetSize &&
              (v.color || "").trim() === targetColor
          ) || origProduct.variation[0];
      }

      if (!origVar) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({
          success: false,
          message: `Original product variation not found for product "${origProduct.name}"`,
        });
      }

      // Update Order Item Exchanged Quantity
      orderItem.exchangedQuantity = alreadyExchanged + itemQty;

      // Price calculation: pro-rated net price paid
      const rawUnitPrice = Number(orderItem.price || origVar.basePrice || 0);
      const itemUnitPrice = discountRatio < 1 ? Number((rawUnitPrice * discountRatio).toFixed(2)) : rawUnitPrice;
      const itemTotalPrice = Number((itemUnitPrice * itemQty).toFixed(2));

      // Pro-rated original VAT paid
      const itemOrigVatRate = Number(orderItem.vat) || 0;
      const itemOrigVatAmount = Number(orderItem.quantity) > 0
        ? Number(((Number(orderItem.vatAmount || 0) / Number(orderItem.quantity)) * itemQty).toFixed(2))
        : 0;

      totalOriginalPrice += itemTotalPrice;
      totalOriginalVat += itemOrigVatAmount;
      totalExchangeQty += itemQty;

      processedOriginalItems.push({
        originalProduct: origProduct._id,
        originalProductName: origProduct.name,
        originalProductIdCode: origProduct.productId || "",
        originalProductSize: origVar.size || "",
        originalProductColor: origVar.color || "",
        originalVariationId: String(origVar._id),
        originalUnitPrice: itemUnitPrice,
        quantity: itemQty,
        originalTotalPrice: itemTotalPrice,
        originalVat: itemOrigVatRate,
        originalVatAmount: itemOrigVatAmount,
      });
    }

    await order.save({ session });

    // 3. Process Replacement Items
    const processedReplacementItems = [];
    let totalReplacementPrice = 0;
    let totalReplacementVat = 0;
    const repProductCache = new Map();

    for (const item of rawRepItems) {
      const repProdId = item.replacementProductId || item.productId;
      const itemQty = Number(item.quantity || item.exchangeQuantity) || 1;

      if (!repProdId) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: "Invalid replacement product ID in items list",
        });
      }

      if (itemQty < 1) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: "Quantity for each replacement item must be at least 1",
        });
      }

      let repProduct = repProductCache.get(String(repProdId));
      if (!repProduct) {
        repProduct = await Product.findById(repProdId).session(session);
        if (repProduct) repProductCache.set(String(repProdId), repProduct);
      }

      if (!repProduct) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({
          success: false,
          message: `Replacement product not found for ID: ${repProdId}`,
        });
      }

      // Check overall product stock
      const totalProductStock = Array.isArray(repProduct.variation)
        ? repProduct.variation.reduce((sum, v) => sum + (Number(v.stock) || 0), 0)
        : Number(repProduct.stock || 0);

      if (totalProductStock <= 0) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: `Replacement product "${repProduct.name}" is out of stock!`,
        });
      }

      let repVar;
      if (item.replacementVariationId || item.variationId) {
        const targetVarId = String(item.replacementVariationId || item.variationId);
        repVar = repProduct.variation.find((v) => String(v._id) === targetVarId);
      } else if (item.replacementSize || item.size || item.replacementColor || item.color) {
        const targetSize = (item.replacementSize || item.size || "").trim();
        const targetColor = (item.replacementColor || item.color || "").trim();
        repVar = repProduct.variation.find(
          (v) =>
            (v.size || "").trim() === targetSize &&
            (v.color || "").trim() === targetColor
        );
      } else if (Array.isArray(repProduct.variation) && repProduct.variation.length === 1) {
        repVar = repProduct.variation[0];
      }

      if (!repVar) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: `Please select a valid variation for replacement product "${repProduct.name}"`,
        });
      }

      const availableStock = Number(repVar.stock) || 0;
      const varLabel = `${repVar.size ? `Size: ${repVar.size}` : ""}${repVar.color ? `${repVar.size ? ", " : ""}Color: ${repVar.color}` : ""}`.trim();
      const itemLabel = varLabel ? `"${repProduct.name}" (${varLabel})` : `"${repProduct.name}"`;

      // 1. Strict Block: Variation is out of stock
      if (availableStock <= 0) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: `Replacement product ${itemLabel} is currently out of stock (Stock: 0).`,
        });
      }

      // 2. Strict Block: Requested quantity exceeds available stock
      if (availableStock < itemQty) {
        await session.abortTransaction();
        session.endSession();
        return res.status(400).json({
          success: false,
          message: `Insufficient stock for ${itemLabel}. Available stock: ${availableStock}, requested: ${itemQty}`,
        });
      }

      const itemUnitPrice = Number(repVar.basePrice || 0);
      const itemTotalPrice = itemUnitPrice * itemQty;
      const repVatRate = Number(repProduct.vat) || 0;
      const itemRepVatAmount = Number(((itemTotalPrice * repVatRate) / 100).toFixed(2));

      totalReplacementPrice += itemTotalPrice;
      totalReplacementVat += itemRepVatAmount;

      processedReplacementItems.push({
        replacementProduct: repProduct._id,
        replacementProductName: repProduct.name,
        replacementProductIdCode: repProduct.productId || "",
        replacementProductSize: repVar.size || "",
        replacementProductColor: repVar.color || "",
        replacementVariationId: String(repVar._id),
        replacementUnitPrice: itemUnitPrice,
        quantity: itemQty,
        replacementTotalPrice: itemTotalPrice,
        replacementVat: repVatRate,
        replacementVatAmount: itemRepVatAmount,
      });
    }

    // 4. Financials & Price Difference Rules (with VAT calculation)
    const isVatWaived = Boolean(req.body.isVatWaived || req.body.waiveVat);
    const basePriceDiff = Math.floor(totalReplacementPrice - totalOriginalPrice);

    // Strict Rule: Replacement product value must be EQUAL or HIGHER than original product value
    if (basePriceDiff < 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        success: false,
        message: `Replacement value (৳${Math.floor(totalReplacementPrice)}) cannot be less than original product value (৳${Math.floor(totalOriginalPrice)}). Total replacement amount must be equal or higher.`,
      });
    }

    const origVat = Number(totalOriginalVat.toFixed(2));
    const repVat = Number(totalReplacementVat.toFixed(2));
    const grossVatDiff = Number((repVat - origVat).toFixed(2));

    let netVatAmount = 0;
    let vatWaivedAmount = 0;

    if (basePriceDiff === 0) {
      // Even exchange (same price or variation exchange) -> No extra VAT is charged
      netVatAmount = 0;
      vatWaivedAmount = 0;
    } else if (isVatWaived) {
      // Manager explicitly opted to waive VAT on this replacement difference
      netVatAmount = 0;
      vatWaivedAmount = grossVatDiff > 0 ? grossVatDiff : 0;
    } else {
      // Upgrade: customer pays the net VAT difference on the extra value
      netVatAmount = grossVatDiff > 0 ? grossVatDiff : 0;
      vatWaivedAmount = 0;
    }

    const priceDiff = Math.floor(basePriceDiff + Math.round(netVatAmount));

    let exchangeType = "even_exchange";
    let cashChangeAmount = 0;
    let additionalPaymentAmount = 0;
    let finalPaymentMethod = "N/A";

    if (priceDiff > 0) {
      exchangeType = "additional_payment";
      additionalPaymentAmount = Math.floor(priceDiff);
      cashChangeAmount = 0;
      finalPaymentMethod = paymentMethod || "Cash";
    } else {
      exchangeType = "even_exchange";
      cashChangeAmount = 0;
      additionalPaymentAmount = 0;
      finalPaymentMethod = "N/A";
    }

    // 5. Process Inventory Exchange Movements & Deductions atomically
    const isOnline = order.orderType === "online";
    const exchangeFn = isOnline
      ? inventoryService.processOnlineExchange
      : inventoryService.processShopExchange;

    await exchangeFn({
      exchangeId: exchangeCustomId,
      orderId: order.orderId || order._id,
      originalItems: processedOriginalItems.map((item) => ({
        originalProductId: item.originalProduct,
        originalVariationId: item.originalVariationId,
        size: item.originalProductSize,
        color: item.originalProductColor,
        quantity: item.quantity,
      })),
      replacementItems: processedReplacementItems.map((item) => ({
        replacementProductId: item.replacementProduct,
        replacementVariationId: item.replacementVariationId,
        size: item.replacementProductSize,
        color: item.replacementProductColor,
        quantity: item.quantity,
      })),
      user: req.user,
      session,
    });

    // 6. Create Exchange Record
    const primaryOrig = processedOriginalItems[0];
    const primaryRep = processedReplacementItems[0];

    const newExchange = new Exchange({
      exchangeId: exchangeCustomId,
      order: order._id,
      orderIdCode: order.orderId,
      customer: order.customer || null,
      customerName: order.customerName || "Walk-in Customer",
      customerPhone: order.phone || "N/A",

      originalItems: processedOriginalItems,

      // Primary fields for backward compatibility
      originalProduct: primaryOrig.originalProduct,
      originalProductName: primaryOrig.originalProductName,
      originalProductIdCode: primaryOrig.originalProductIdCode,
      originalProductSize: primaryOrig.originalProductSize,
      originalProductColor: primaryOrig.originalProductColor,
      originalVariationId: primaryOrig.originalVariationId,
      originalUnitPrice: primaryOrig.originalUnitPrice,
      originalTotalPrice: totalOriginalPrice,

      replacementItems: processedReplacementItems,

      // Primary fields for backward compatibility
      replacementProduct: primaryRep.replacementProduct,
      replacementProductName: primaryRep.replacementProductName,
      replacementProductIdCode: primaryRep.replacementProductIdCode,
      replacementProductSize: primaryRep.replacementProductSize,
      replacementProductColor: primaryRep.replacementProductColor,
      replacementVariationId: primaryRep.replacementVariationId,
      replacementUnitPrice: primaryRep.replacementUnitPrice,
      replacementTotalPrice: totalReplacementPrice,

      exchangeQuantity: totalExchangeQty,
      priceDifference: priceDiff,
      originalTotalVat: origVat,
      replacementTotalVat: repVat,
      netVatAmount: netVatAmount,
      isVatWaived: isVatWaived,
      vatWaivedAmount: vatWaivedAmount,
      exchangeType: exchangeType,
      cashChangeAmount: cashChangeAmount,
      additionalPaymentAmount: additionalPaymentAmount,
      paymentMethod: finalPaymentMethod,

      notes: notes ? String(notes).trim() : `Replace/Exchange processed by ${req.user.name || "Manager"}`,
      processedBy: req.user.id || req.user._id,
      processedByName: req.user.name || "Manager",
      processedByRole: req.user.role || "manager",
    });

    await newExchange.save({ session });

    // Commit atomic transaction
    await session.commitTransaction();
    session.endSession();

    // Log Activity
    logActivity({
      user: req.user.id,
      action: "CREATE_EXCHANGE",
      entityType: "Exchange",
      entityId: newExchange.exchangeId,
      description: `Processed Replace/Exchange ${newExchange.exchangeId} for Order ${order.orderId} (${numExchangeQty} units)`,
      oldValues: {
        product: newExchange.originalProductName,
        size: newExchange.originalProductSize,
        color: newExchange.originalProductColor,
        unitPrice: newExchange.originalUnitPrice,
        totalPrice: newExchange.originalTotalPrice,
      },
      newValues: {
        product: newExchange.replacementProductName,
        size: newExchange.replacementProductSize,
        color: newExchange.replacementProductColor,
        unitPrice: newExchange.replacementUnitPrice,
        totalPrice: newExchange.replacementTotalPrice,
      },
      metadata: { exchangeId: newExchange.exchangeId, orderId: order.orderId, exchangeType, priceDiff },
      req,
    });

    res.status(201).json({
      success: true,
      message: `Replace / Exchange (${newExchange.exchangeId}) completed successfully! Stock updated.`,
      data: newExchange,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    console.error("❌ Process Exchange Error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to process Replace / Exchange transaction",
    });
  }
});

// @desc    Get Order details with eligible exchange items
// @route   GET /api/exchange/order/:orderId
// @access  Private (Admin, Manager, Employee)
const getOrderForExchange = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const rawId = orderId.trim();

  let baseQuery = {};
  if (mongoose.Types.ObjectId.isValid(rawId)) {
    baseQuery = { $or: [{ _id: rawId }, { orderId: rawId }, { orderId: `ORD-${rawId}` }] };
  } else {
    const formattedId = rawId.toUpperCase().startsWith("ORD-") ? rawId.toUpperCase() : `ORD-${rawId.toUpperCase()}`;
    baseQuery = { $or: [{ orderId: formattedId }, { orderId: rawId }] };
  }

  // 1. Check if order exists at all (to give accurate error message if it's an online order)
  const existingOrder = await Order.findOne(baseQuery).select("orderId orderType");
  if (!existingOrder) {
    return res.status(404).json({
      success: false,
      message: `Shop order not found with ID: ${orderId}`,
    });
  }

  if (existingOrder.orderType !== "shop") {
    return res.status(400).json({
      success: false,
      message: `Order ${existingOrder.orderId} is an Online Order. Only Shop Orders (POS) can be replaced or exchanged.`,
    });
  }

  const order = await Order.findOne({ ...baseQuery, orderType: "shop" })
    .populate("products.productId", "name productId bannerImage images variation")
    .populate("customer", "name phone email");

  if (!order) {
    return res.status(404).json({
      success: false,
      message: `Shop order not found with ID: ${orderId}`,
    });
  }

  // Calculate net product subtotal (selling price after item-level discounts)
  const netProductSubtotal = (order.products || []).reduce(
    (sum, p) => sum + (Number(p.price || 0) * Number(p.quantity || 1)),
    0
  );

  // Calculate total item-level discounts already subtracted from originalPrice to get price
  const totalItemDiscounts = (order.products || []).reduce((sum, p) => {
    const origP = Number(p.originalPrice || (Number(p.price || 0) + Number(p.itemDiscount || 0)) || p.price || 0);
    const effP = Number(p.price || 0);
    const disc = (p.itemDiscount !== undefined && Number(p.itemDiscount) > 0)
      ? Number(p.itemDiscount)
      : Math.max(0, origP - effP);
    return sum + disc * Number(p.quantity || 1);
  }, 0);

  const orderVatWaivedAmount = Boolean(order.isVatDiscount || (order.vatDiscountAmount && Number(order.vatDiscountAmount) > 0))
    ? Number(order.vatDiscountAmount || order.vatAmount || 0)
    : 0;

  const totalDiscountRecorded = Number(order.discountAmount || 0);
  // Order-level discount is strictly the discount beyond item discounts and VAT waiver
  const orderLevelDiscount = Math.max(0, totalDiscountRecorded - totalItemDiscounts - orderVatWaivedAmount);

  // Order-level discount ratio applied to net product price (avoids double discount)
  const discountRatio = (netProductSubtotal > 0 && orderLevelDiscount > 0)
    ? Math.max(0, (netProductSubtotal - orderLevelDiscount) / netProductSubtotal)
    : 1;

  // Calculate remaining exchangeable quantity and effective pro-rated price for each item
  const eligibleProducts = order.products.map((item) => {
    const ordered = Number(item.quantity) || 1;
    const exchanged = Number(item.exchangedQuantity) || 0;
    const remaining = Math.max(0, ordered - exchanged);
    const rawPrice = Number(item.price) || 0;
    const effectivePrice = discountRatio < 1 ? Number((rawPrice * discountRatio).toFixed(2)) : rawPrice;
    const itemVatRate = Number(item.vat) || 0;
    const itemVatAmount = Number(item.vatAmount) || 0;
    const vatPerUnit = ordered > 0 ? Number((itemVatAmount / ordered).toFixed(2)) : 0;

    return {
      _id: item._id,
      productId: item.productId?._id || item.productId,
      productName: item.name,
      productIdCode: item.productIdCode || item.productId?.productId || "",
      variationId: item.variationId,
      size: item.size || "",
      color: item.color || "",
      rawPrice: rawPrice,
      price: effectivePrice, // Pro-rated net price paid per unit (floored integer)
      discountAppliedPerUnit: Math.floor(rawPrice - effectivePrice),
      vat: itemVatRate,
      vatAmount: itemVatAmount,
      vatPerUnit: vatPerUnit,
      quantity: ordered,
      exchangedQuantity: exchanged,
      remainingExchangeableQty: remaining,
      canExchange: remaining > 0,
    };
  });

  res.status(200).json({
    success: true,
    data: {
      _id: order._id,
      orderId: order.orderId,
      orderType: order.orderType,
      customerName: order.customerName,
      phone: order.phone,
      totalAmount: order.totalAmount,
      subtotal: order.subtotal || order.totalAmount,
      discountAmount: order.discountAmount || 0,
      vatAmount: Number(order.vatAmount) || 0,
      status: order.status,
      createdAt: order.createdAt,
      products: eligibleProducts,
    },
  });
});

// @desc    Get all Exchange history records
// @route   GET /api/exchange
// @access  Private (Admin, Manager, Employee)
const getExchanges = asyncHandler(async (req, res) => {
  const { page = 1, limit = 15, search, exchangeType, startDate, endDate, specificDate, period } = req.query;

  const query = {};

  if (exchangeType && ["cash_change", "additional_payment", "even_exchange"].includes(exchangeType)) {
    query.exchangeType = exchangeType;
  }

  // Date Filtering (checks updatedAt or createdAt)
  if (specificDate) {
    const dateObj = new Date(specificDate);
    const nextDate = new Date(dateObj);
    nextDate.setDate(nextDate.getDate() + 1);
    const dateFilterCond = { $gte: dateObj, $lt: nextDate };
    query.$and = (query.$and || []).concat([
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
    query.$and = (query.$and || []).concat([
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
      query.$and = (query.$and || []).concat([
        {
          $or: [
            { updatedAt: { $gte: periodStartDate } },
            { createdAt: { $gte: periodStartDate } }
          ]
        }
      ]);
    }
  }

  if (search && search.trim()) {
    const regex = new RegExp(search.trim(), "i");
    const searchCond = [
      { exchangeId: regex },
      { orderIdCode: regex },
      { customerName: regex },
      { customerPhone: regex },
      { originalProductName: regex },
      { replacementProductName: regex },
      { processedByName: regex },
    ];
    query.$and = (query.$and || []).concat([{ $or: searchCond }]);
  }

  const pageNum = parseInt(page) || 1;
  const limitNum = parseInt(limit) || 15;
  const skip = (pageNum - 1) * limitNum;

  const [exchanges, totalCount, statsAgg] = await Promise.all([
    Exchange.find(query)
      .populate("originalProduct", "name productId bannerImage images")
      .populate("replacementProduct", "name productId bannerImage images")
      .populate("processedBy", "name role")
      .sort({ updatedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
    Exchange.countDocuments(query),
    Exchange.aggregate([
      {
        $group: {
          _id: null,
          totalCashChange: { $sum: "$cashChangeAmount" },
          totalAdditionalPayment: { $sum: "$additionalPaymentAmount" },
        },
      },
    ]),
  ]);

  const stats = {
    totalExchanges: totalCount,
    total: totalCount,
    totalCashChangeGiven: statsAgg[0]?.totalCashChange || 0,
    totalAdditionalCollected: statsAgg[0]?.totalAdditionalPayment || 0,
  };

  res.status(200).json({
    success: true,
    data: exchanges,
    stats,
    pagination: {
      page: pageNum,
      limit: limitNum,
      totalItems: totalCount,
      totalPages: Math.ceil(totalCount / limitNum) || 1,
    },
  });
});

// @desc    Get single Exchange details by ID
// @route   GET /api/exchange/:id
// @access  Private (Admin, Manager, Employee)
const getExchangeById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  let query = {};
  if (mongoose.Types.ObjectId.isValid(id)) {
    query = { $or: [{ _id: id }, { exchangeId: id }] };
  } else {
    query = { exchangeId: id };
  }

  const exchange = await Exchange.findOne(query)
    .populate("order", "orderId totalAmount customerName phone createdAt")
    .populate("originalProduct", "name productId bannerImage images")
    .populate("replacementProduct", "name productId bannerImage images")
    .populate("processedBy", "name role email");

  if (!exchange) {
    return res.status(404).json({
      success: false,
      message: "Exchange transaction record not found",
    });
  }

  res.status(200).json({
    success: true,
    data: exchange,
  });
});

module.exports = {
  processExchange,
  getOrderForExchange,
  getExchanges,
  getExchangeById,
};
