/**
 * ============================================================
 * controllers/dailyOverviewController.js — Daily Sales & Expense Overview
 * ============================================================
 * অ্যাডমিনের জন্য দৈনিক বা নির্ধারিত তারিখের Online Sell, Shop Sell (POS)
 * এবং Admin Expense-এর বিস্তারিত হিসাব, বিশ্লেষণ ও খতিয়ানের কন্ট্রোলার।
 * MySellPage-এর অনুরূপ সমস্ত স্ট্যাটস কার্ড ও ট্যাব সাপোর্ট করে।
 * ============================================================
 */

const asyncHandler = require("../utils/asyncHandler");
const Order = require("../models/Order");
const AdminExpense = require("../models/AdminExpense");
const Exchange = require("../models/Exchange");
const Return = require("../models/Return");

// Helper to compute date range
function getDateRange({ period = "today", mode = "period", specificDate, startDate, endDate }) {
  const now = new Date();
  let start = new Date();
  let end = new Date();

  if (mode === "specific" && specificDate) {
    const [y, m, d] = specificDate.split("-").map(Number);
    start = new Date(y, m - 1, d, 0, 0, 0, 0);
    end = new Date(y, m - 1, d, 23, 59, 59, 999);
  } else if (mode === "range" && (startDate || endDate)) {
    if (startDate) {
      const [y, m, d] = startDate.split("-").map(Number);
      start = new Date(y, m - 1, d, 0, 0, 0, 0);
    } else {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    }
    if (endDate) {
      const [y, m, d] = endDate.split("-").map(Number);
      end = new Date(y, m - 1, d, 23, 59, 59, 999);
    } else {
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    }
  } else {
    // Mode: period
    switch (period) {
      case "yesterday": {
        const yest = new Date(now);
        yest.setDate(yest.getDate() - 1);
        start = new Date(yest.getFullYear(), yest.getMonth(), yest.getDate(), 0, 0, 0, 0);
        end = new Date(yest.getFullYear(), yest.getMonth(), yest.getDate(), 23, 59, 59, 999);
        break;
      }
      case "weekly":
      case "last7days": {
        const past7 = new Date(now);
        past7.setDate(past7.getDate() - 6);
        start = new Date(past7.getFullYear(), past7.getMonth(), past7.getDate(), 0, 0, 0, 0);
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        break;
      }
      case "monthly":
      case "thisMonth": {
        start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        break;
      }
      case "yearly": {
        start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        break;
      }
      case "":
      case "all": {
        start = new Date(2000, 0, 1, 0, 0, 0, 0);
        end = new Date(now.getFullYear() + 1, 11, 31, 23, 59, 59, 999);
        break;
      }
      case "today":
      case "daily":
      default: {
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        break;
      }
    }
  }

  return { start, end };
}

// Helper: Extract original subtotal (before discount) for an order
function computeOrderSubtotal(order) {
  let origSubtotal = 0;
  if (order.products && Array.isArray(order.products) && order.products.length > 0) {
    origSubtotal = order.products.reduce((sum, p) => {
      const origPrice = Number(p.originalPrice || (p.price + (p.itemDiscount || 0)) || p.price || 0);
      const qty = Number(p.quantity || 1);
      return sum + origPrice * qty;
    }, 0);
  }
  return origSubtotal > 0 ? origSubtotal : Number(order.subtotal) || Number(order.totalAmount) || 0;
}

// Helper: Extract total discount for an order
function computeOrderDiscount(order) {
  let itemDiscs = 0;
  if (order.products && Array.isArray(order.products)) {
    itemDiscs = order.products.reduce(
      (sum, p) => sum + Number(p.itemDiscount || 0) * Number(p.quantity || 1),
      0
    );
  }
  const orderDisc = Number(order.discountAmount || 0);
  return Math.max(orderDisc, itemDiscs);
}

// @desc    Get Daily Business Overview (Online Sell, Shop Sell, Admin Expense)
// @route   GET /api/admin/daily-overview
// @access  Private (Admin, Manager)
const getDailyOverview = asyncHandler(async (req, res) => {
  const {
    period = "today",
    mode = "period",
    specificDate,
    startDate,
    endDate,
    search = "",
    status = "",
    tab = "shop", // 'shop', 'online', 'expense'
    page = 1,
    limit = 10,
  } = req.query;

  const { start, end } = getDateRange({ period, mode, specificDate, startDate, endDate });

  // 1. Fetch Orders in this date range
  const orderDateFilter = {
    createdAt: { $gte: start, $lte: end },
  };

  const allPeriodOrders = await Order.find(orderDateFilter)
    .populate("customer", "name phone email")
    .populate("createdBy", "name email role")
    .populate("salesman", "name email")
    .sort({ createdAt: -1 })
    .lean();

  // Separate Shop vs Online orders
  const shopOrders = [];
  const onlineOrders = [];

  allPeriodOrders.forEach((o) => {
    const isShop = o.orderType === "shop" || o.address === "POS Sale";
    if (isShop) {
      shopOrders.push(o);
    } else {
      onlineOrders.push(o);
    }
  });

  // 2. Fetch Admin Expenses in this date range
  const expenseFilter = {
    $or: [
      { date: { $gte: start, $lte: end } },
      { createdAt: { $gte: start, $lte: end } },
    ],
  };

  const adminExpensesList = await AdminExpense.find(expenseFilter)
    .populate("createdBy", "name email role")
    .sort({ date: -1, createdAt: -1 })
    .lean();

  const totalAdminExpense = adminExpensesList.reduce(
    (sum, exp) => sum + (Number(exp.amount) || 0),
    0
  );

  // 3. Fetch Exchanges with additional payments in this date range
  const allPeriodExchanges = await Exchange.find({
    createdAt: { $gte: start, $lte: end },
  }).lean();

  let totalAdditionalExchangePayment = 0;
  const exchangePaymentBreakdown = {
    Cash: 0,
    Bkash: 0,
    Card: 0,
    "Bangla QR": 0,
  };

  allPeriodExchanges.forEach((ex) => {
    const amt = Number(ex.additionalPaymentAmount) || 0;
    if (amt > 0) {
      totalAdditionalExchangePayment += amt;
      const m = (ex.paymentMethod || "Cash").trim();
      if (m.toLowerCase() === "bkash") {
        exchangePaymentBreakdown.Bkash += amt;
      } else if (m.toLowerCase() === "card") {
        exchangePaymentBreakdown.Card += amt;
      } else if (m.toLowerCase().includes("qr")) {
        exchangePaymentBreakdown["Bangla QR"] += amt;
      } else {
        exchangePaymentBreakdown.Cash += amt;
      }
    }
  });

  // 4. Fetch Returns for all period orders
  const allOrderIds = allPeriodOrders.map((o) => o._id);
  const allReturns = await Return.find({
    order: { $in: allOrderIds },
    status: { $in: ["received", "refunded", "approved"] },
  }).lean();

  const shopOrderIdsSet = new Set(shopOrders.map((o) => o._id.toString()));
  const onlineOrderIdsSet = new Set(onlineOrders.map((o) => o._id.toString()));

  let shopReturnAmount = 0;
  let onlineReturnAmount = 0;
  const shopReturnedOrdersSet = new Set();
  const onlineReturnedOrdersSet = new Set();
  const shopPaymentMethodRefunds = {};

  allReturns.forEach((ret) => {
    const refAmt = Number(ret.refundAmount || 0);
    const ordIdStr = ret.order ? ret.order.toString() : "";
    if (shopOrderIdsSet.has(ordIdStr)) {
      shopReturnAmount += refAmt;
      shopReturnedOrdersSet.add(ordIdStr);

      // Track refund payment method from original shop order
      const origOrder = shopOrders.find((o) => o._id.toString() === ordIdStr);
      let refundMethod = "Cash";
      if (origOrder && Array.isArray(origOrder.payments) && origOrder.payments.length > 0) {
        refundMethod = (origOrder.payments[0].method || "Cash").trim();
      } else if (origOrder && origOrder.paymentMethod) {
        refundMethod = origOrder.paymentMethod.trim();
      }
      shopPaymentMethodRefunds[refundMethod] =
        (shopPaymentMethodRefunds[refundMethod] || 0) + refAmt;
    } else if (onlineOrderIdsSet.has(ordIdStr)) {
      onlineReturnAmount += refAmt;
      onlineReturnedOrdersSet.add(ordIdStr);
    }
  });

  // 5. Calculate Shop Orders Statistics
  let shopTotalSales = 0;
  let shopTotalSubtotal = 0;
  let shopTotalDiscount = 0;
  const shopPaymentMethodStats = {};
  const shopCardPosStats = {
    "Pubali Bank POS": 0,
    "City Bank POS": 0,
    "UCB POS": 0,
  };

  shopOrders.forEach((o) => {
    const amt = Number(o.totalAmount || 0);
    const isCancelled = o.status === "cancelled";
    if (!isCancelled) {
      shopTotalSales += amt;
      shopTotalSubtotal += computeOrderSubtotal(o);
      shopTotalDiscount += computeOrderDiscount(o);

      // Payment methods
      if (Array.isArray(o.payments) && o.payments.length > 0) {
        o.payments.forEach((p) => {
          const m = (p.method || "Cash").trim();
          const pAmt = Number(p.amount) || 0;
          shopPaymentMethodStats[m] = (shopPaymentMethodStats[m] || 0) + pAmt;

          if (m === "Card" && p.posMachine) {
            if (shopCardPosStats[p.posMachine] !== undefined) {
              shopCardPosStats[p.posMachine] += pAmt;
            } else {
              shopCardPosStats[p.posMachine] = pAmt;
            }
          }
        });
      } else if (o.paymentMethod) {
        const m = o.paymentMethod.trim();
        shopPaymentMethodStats[m] = (shopPaymentMethodStats[m] || 0) + amt;
      }

      // Excess change paid
      const paid = Number(o.totalPaid || 0);
      if (paid > amt) {
        const change = paid - amt;
        shopPaymentMethodRefunds["Cash"] = (shopPaymentMethodRefunds["Cash"] || 0) + change;
      } else if (o.returnAmount) {
        shopPaymentMethodRefunds["Cash"] =
          (shopPaymentMethodRefunds["Cash"] || 0) + Number(o.returnAmount);
      }
    }
  });

  // Calculate Cash in Hand for Shop
  const shopRawCash = Number(
    shopPaymentMethodStats["Cash"] ||
      shopPaymentMethodStats["cash"] ||
      shopPaymentMethodStats["CASH"] ||
      0
  );
  const shopExchangeCash = Number(exchangePaymentBreakdown.Cash || 0);
  const shopCashRefund = Number(
    shopPaymentMethodRefunds["Cash"] ||
      shopPaymentMethodRefunds["cash"] ||
      shopPaymentMethodRefunds["CASH"] ||
      0
  );
  const shopCashInHand =
    shopRawCash +
    shopExchangeCash -
    totalAdminExpense -
    shopCashRefund;

  // Sort shopPaymentMethodStats so Cash is always first, Card second, etc.
  const sortedShopPaymentMethodStats = {};
  const methodSortPriority = ["Cash", "Card", "Bkash", "Bangla QR"];
  methodSortPriority.forEach((m) => {
    if (shopPaymentMethodStats[m] !== undefined) {
      sortedShopPaymentMethodStats[m] = shopPaymentMethodStats[m];
    }
  });
  Object.keys(shopPaymentMethodStats).forEach((m) => {
    if (sortedShopPaymentMethodStats[m] === undefined) {
      sortedShopPaymentMethodStats[m] = shopPaymentMethodStats[m];
    }
  });

  const shopFinalTotal =
    shopTotalSales + totalAdditionalExchangePayment - totalAdminExpense - shopReturnAmount;

  // 6. Calculate Online Orders Statistics
  let onlineTotalSales = 0;
  let onlineTotalSubtotal = 0;
  let onlineTotalDiscount = 0;
  let onlineTotalShippingFee = 0;
  const onlinePaymentMethodStats = {};

  onlineOrders.forEach((o) => {
    const amt = Number(o.totalAmount || 0);
    const isCancelled = o.status === "cancelled";
    if (!isCancelled) {
      onlineTotalSales += amt;
      onlineTotalSubtotal += computeOrderSubtotal(o);
      onlineTotalDiscount += computeOrderDiscount(o);
      onlineTotalShippingFee += Number(o.shippingFee || 0);

      const m = (o.paymentMethod || "Cash on Delivery").trim();
      onlinePaymentMethodStats[m] = (onlinePaymentMethodStats[m] || 0) + amt;
    }
  });

  const onlineFinalTotal = onlineTotalSales - onlineTotalShippingFee - onlineReturnAmount;

  // 7. Calculate Admin Expense Statistics
  const expenseCategoryBreakdown = {};
  const expensePaymentStats = {};

  adminExpensesList.forEach((exp) => {
    const amt = Number(exp.amount || 0);
    const cat = (exp.category || "General").trim();
    expenseCategoryBreakdown[cat] = (expenseCategoryBreakdown[cat] || 0) + amt;

    const pm = (exp.spentBy || "Cash").trim();
    expensePaymentStats[pm] = (expensePaymentStats[pm] || 0) + amt;
  });

  const avgExpense =
    adminExpensesList.length > 0
      ? Math.round(totalAdminExpense / adminExpensesList.length)
      : 0;

  // 8. Search & Pagination for the Active Tab
  const searchLower = (search || "").trim().toLowerCase();
  const pageNum = Math.max(1, parseInt(page) || 1);
  const limitNum = Math.max(1, parseInt(limit) || 10);

  let filteredItems = [];
  let totalItemsCount = 0;

  if (tab === "online") {
    let list = onlineOrders;
    if (status && status !== "all") {
      list = list.filter((o) => o.status === status);
    }
    if (searchLower) {
      list = list.filter((o) => {
        return (
          (o.orderId && o.orderId.toLowerCase().includes(searchLower)) ||
          (o.customerName && o.customerName.toLowerCase().includes(searchLower)) ||
          (o.phone && o.phone.toLowerCase().includes(searchLower)) ||
          (o.address && o.address.toLowerCase().includes(searchLower)) ||
          (o.city && o.city.toLowerCase().includes(searchLower))
        );
      });
    }
    totalItemsCount = list.length;
    filteredItems = list.slice((pageNum - 1) * limitNum, pageNum * limitNum);
  } else if (tab === "expense") {
    let list = adminExpensesList;
    if (searchLower) {
      list = list.filter((e) => {
        return (
          (e.expenseId && e.expenseId.toLowerCase().includes(searchLower)) ||
          (e.title && e.title.toLowerCase().includes(searchLower)) ||
          (e.spentBy && e.spentBy.toLowerCase().includes(searchLower)) ||
          (e.category && e.category.toLowerCase().includes(searchLower)) ||
          (e.purpose && e.purpose.toLowerCase().includes(searchLower))
        );
      });
    }
    totalItemsCount = list.length;
    filteredItems = list.slice((pageNum - 1) * limitNum, pageNum * limitNum);
  } else if (tab === "all") {
    let list = allPeriodOrders;
    if (status && status !== "all") {
      list = list.filter((o) => o.status === status);
    }
    if (searchLower) {
      list = list.filter((o) => {
        return (
          (o.orderId && o.orderId.toLowerCase().includes(searchLower)) ||
          (o.customerName && o.customerName.toLowerCase().includes(searchLower)) ||
          (o.phone && o.phone.toLowerCase().includes(searchLower)) ||
          (o.address && o.address.toLowerCase().includes(searchLower)) ||
          (o.city && o.city.toLowerCase().includes(searchLower)) ||
          (o.salesmanName && o.salesmanName.toLowerCase().includes(searchLower)) ||
          (o.createdBy?.name && o.createdBy.name.toLowerCase().includes(searchLower)) ||
          (o.note && o.note.toLowerCase().includes(searchLower))
        );
      });
    }
    totalItemsCount = list.length;
    filteredItems = list.slice((pageNum - 1) * limitNum, pageNum * limitNum);
  } else {
    // Default tab === 'shop'
    let list = shopOrders;
    if (status && status !== "all") {
      list = list.filter((o) => o.status === status);
    }
    if (searchLower) {
      list = list.filter((o) => {
        return (
          (o.orderId && o.orderId.toLowerCase().includes(searchLower)) ||
          (o.customerName && o.customerName.toLowerCase().includes(searchLower)) ||
          (o.phone && o.phone.toLowerCase().includes(searchLower)) ||
          (o.salesmanName && o.salesmanName.toLowerCase().includes(searchLower)) ||
          (o.createdBy?.name && o.createdBy.name.toLowerCase().includes(searchLower)) ||
          (o.note && o.note.toLowerCase().includes(searchLower))
        );
      });
    }
    totalItemsCount = list.length;
    filteredItems = list.slice((pageNum - 1) * limitNum, pageNum * limitNum);
  }

  // Inject returned and exchanged status into order products and update order status (matches Shop Orders page)
  const paginatedOrderIds = filteredItems.map((o) => o._id).filter(Boolean);
  if (paginatedOrderIds.length > 0 && (tab === "shop" || tab === "online" || tab === "all")) {
    const [itemReturns, itemExchanges] = await Promise.all([
      Return.find({
        order: { $in: paginatedOrderIds },
        status: { $in: ["received", "refunded", "approved"] },
      })
        .populate("product", "name productId images")
        .lean(),
      Exchange.find({
        order: { $in: paginatedOrderIds },
      })
        .populate("originalProduct", "name productId images")
        .populate("originalItems.originalProduct", "name productId images")
        .populate("replacementProduct", "name productId images bannerImage")
        .populate(
          "replacementItems.replacementProduct",
          "name productId images bannerImage"
        )
        .lean(),
    ]);

    filteredItems.forEach((order) => {
      const orderReturns = itemReturns.filter(
        (r) => r.order.toString() === order._id.toString()
      );
      const orderExchanges = itemExchanges.filter(
        (exc) => exc.order.toString() === order._id.toString()
      );

      // Ensure every return has a proper productName and productIdCode
      orderReturns.forEach((r) => {
        if (!r.productName || r.productName === "Returned Product") {
          const matchedProd = order.products?.find((p) => {
            const prodIdStr =
              p.productId?._id?.toString() || p.productId?.toString() || "";
            const rProdId =
              r.product?._id?.toString() || r.product?.toString() || "";
            return (
              (prodIdStr && rProdId && prodIdStr === rProdId) ||
              (p.productIdCode && r.productIdCode && p.productIdCode === r.productIdCode)
            );
          });
          if (matchedProd) {
            r.productName = matchedProd.name;
            if (!r.productIdCode && matchedProd.productIdCode) {
              r.productIdCode = matchedProd.productIdCode;
            }
          } else if (r.product?.name) {
            r.productName = r.product.name;
          }
        }
      });

      let totalReturnedQty = 0;
      let totalExchangedQty = 0;
      let totalOrderQty = 0;

      if (order.products && Array.isArray(order.products)) {
        order.products = order.products.map((product) => {
          const prodIdStr =
            product.productId?._id?.toString() ||
            product.productId?.toString() ||
            "";
          const prodSize = (product.size || "").trim();
          const prodColor = (product.color || "").trim();
          const prodVarId = product.variationId
            ? String(product.variationId).trim()
            : "";

          // 1. Returns matching
          const productReturns = orderReturns.filter((r) => {
            const rProdId =
              r.product?._id?.toString() || r.product?.toString() || "";
            const rSize = (r.productSize || "").trim();
            const rColor = (r.productColor || "").trim();
            const idMatch = rProdId && prodIdStr && rProdId === prodIdStr;
            const codeMatch = r.productIdCode && product.productIdCode && r.productIdCode === product.productIdCode;
            const nameMatch = r.productName && product.name && r.productName.trim().toLowerCase() === product.name.trim().toLowerCase();
            return (
              (idMatch || codeMatch || nameMatch) &&
              (!rColor || !prodColor || rColor === prodColor) &&
              (!rSize || !prodSize || rSize === prodSize)
            );
          });

          const returnedQty = productReturns.reduce(
            (sum, r) => sum + (Number(r.quantity) || 0),
            0
          );
          totalReturnedQty += returnedQty;

          // 2. Exchanges matching
          let productExchangedQty = 0;
          const productExchanges = orderExchanges.filter((exc) => {
            if (Array.isArray(exc.originalItems) && exc.originalItems.length > 0) {
              const matchedOis = exc.originalItems.filter((oi) => {
                const oiProdId =
                  oi.originalProduct?._id?.toString() ||
                  oi.originalProduct?.toString() ||
                  "";
                const oiSize = (oi.originalProductSize || "").trim();
                const oiColor = (oi.originalProductColor || "").trim();
                const idMatch = oiProdId && prodIdStr && oiProdId === prodIdStr;
                const codeMatch = oi.originalProductIdCode && product.productIdCode && oi.originalProductIdCode === product.productIdCode;
                const nameMatch = oi.originalProductName && product.name && oi.originalProductName.trim().toLowerCase() === product.name.trim().toLowerCase();
                return (
                  (idMatch || codeMatch || nameMatch) &&
                  (!oiColor || !prodColor || oiColor === prodColor) &&
                  (!oiSize || !prodSize || oiSize === prodSize)
                );
              });

              if (matchedOis.length > 0) {
                const oiQty = matchedOis.reduce((sum, item) => sum + (Number(item.quantity) || 1), 0);
                productExchangedQty += oiQty;
                return true;
              }
              return false;
            }

            const eProdId =
              exc.originalProduct?._id?.toString() ||
              exc.originalProduct?.toString() ||
              "";
            const eSize = (exc.originalProductSize || "").trim();
            const eColor = (exc.originalProductColor || "").trim();
            const idMatch = eProdId && prodIdStr && eProdId === prodIdStr;
            const codeMatch = exc.originalProductIdCode && product.productIdCode && exc.originalProductIdCode === product.productIdCode;
            const nameMatch = exc.originalProductName && product.name && exc.originalProductName.trim().toLowerCase() === product.name.trim().toLowerCase();
            const isMatch = (idMatch || codeMatch || nameMatch) &&
              (!eColor || !prodColor || eColor === prodColor) &&
              (!eSize || !prodSize || eSize === prodSize);

            if (isMatch) {
              productExchangedQty += (Number(exc.exchangeQuantity) || 1);
              return true;
            }
            return false;
          });

          const exchangedQty =
            Number(product.exchangedQuantity) > 0
              ? Number(product.exchangedQuantity)
              : productExchangedQty;
          totalExchangedQty += exchangedQty;

          const orderedQty = Number(product.quantity) || 0;
          totalOrderQty += orderedQty;

          return {
            ...product,
            returnedQuantity: returnedQty,
            exchangedQuantity: exchangedQty,
            isReturned: returnedQty >= orderedQty && orderedQty > 0,
            isPartiallyReturned: returnedQty > 0 && returnedQty < orderedQty,
            isExchanged: exchangedQty >= orderedQty && orderedQty > 0,
            isPartiallyExchanged: exchangedQty > 0 && exchangedQty < orderedQty,
            exchangeHistory: productExchanges,
          };
        });
      }

      order.returnsCount = orderReturns.length;
      order.exchangesCount = orderExchanges.length;
      order.returns = orderReturns;
      order.exchanges = orderExchanges;

      // Prioritize status display: Returns > Exchanges > Original Order Status
      if (orderReturns.length > 0) {
        if (totalReturnedQty >= totalOrderQty && totalOrderQty > 0) {
          order.status = "Returned";
        } else {
          order.status = "Partially Returned";
        }
      } else if (orderExchanges.length > 0 || totalExchangedQty > 0) {
        if (totalExchangedQty >= totalOrderQty && totalOrderQty > 0) {
          order.status = "Exchanged";
        } else {
          order.status = "Partially Exchanged";
        }
      }
    });
  }

  res.status(200).json({
    success: true,
    data: {
      dateRange: {
        start,
        end,
        period,
        mode,
      },
      activeTab: tab,
      stats: {
        // Shop Stats (MySellPage format)
        shop: {
          totalOrders: shopOrders.length,
          totalSales: shopTotalSales,
          totalSubtotal: shopTotalSubtotal,
          totalDiscount: shopTotalDiscount,
          totalReturnedOrdersCount: shopReturnedOrdersSet.size,
          totalReturnAmount: shopReturnAmount,
          totalShopExpense: totalAdminExpense,
          totalAdditionalExchangePayment,
          exchangePaymentBreakdown,
          paymentMethodStats: sortedShopPaymentMethodStats,
          cardPosStats: shopCardPosStats,
          paymentMethodRefunds: shopPaymentMethodRefunds,
          cashInHand: shopCashInHand,
          finalTotal: shopFinalTotal,
        },
        // Online Stats (MySellPage format)
        online: {
          totalOrders: onlineOrders.length,
          totalSales: onlineTotalSales,
          totalSubtotal: onlineTotalSubtotal,
          totalDiscount: onlineTotalDiscount,
          totalShippingFee: onlineTotalShippingFee,
          totalReturnedOrdersCount: onlineReturnedOrdersSet.size,
          totalReturnAmount: onlineReturnAmount,
          paymentMethodStats: onlinePaymentMethodStats,
          finalTotal: onlineFinalTotal,
        },
        // Admin Expense Stats
        expense: {
          totalExpense: totalAdminExpense,
          totalCount: adminExpensesList.length,
          avgExpense,
          categoriesCount: Object.keys(expenseCategoryBreakdown).length,
          categoryBreakdown: expenseCategoryBreakdown,
          paymentMethodStats: expensePaymentStats,
        },
      },
      counts: {
        all: shopOrders.length + onlineOrders.length + adminExpensesList.length,
        shop: shopOrders.length,
        online: onlineOrders.length,
        expense: adminExpensesList.length,
      },
      items: filteredItems,
      pagination: {
        currentPage: pageNum,
        limit: limitNum,
        totalOrders: totalItemsCount,
        totalItems: totalItemsCount,
        totalPages: Math.ceil(totalItemsCount / limitNum) || 1,
      },
    },
  });
});

module.exports = {
  getDailyOverview,
};
