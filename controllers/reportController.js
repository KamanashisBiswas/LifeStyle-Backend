/**
 * ============================================================
 * controllers/reportController.js — Comprehensive Business Reports
 * ============================================================
 * Generates custom analytical reports for:
 *  1. Product Wise Report (Sales, Revenue, Stock Status per product)
 *  2. Shop Sell Report (Physical POS store sales, payment methods, discounts)
 *  3. Online Sell Report (Website orders, order status, shipping fees)
 *  4. Salesman Wise Report (Sales volume, order count, reward points per salesman)
 *  5. Summary Overview Report (Combined high-level metrics)
 * ============================================================
 */

const Order = require("../models/Order");
const Product = require("../models/Product");
const User = require("../models/User");
const asyncHandler = require("../utils/asyncHandler");
const mongoose = require("mongoose");

/**
 * @desc    Generate filtered report based on reportType and date/channel criteria
 * @route   GET /api/admin/reports
 * @access  Private (Admin, Employee, Manager)
 */
const getReports = asyncHandler(async (req, res) => {
  const {
    reportType: queryReportType,
    startDate,
    endDate,
    salesmanId,
    orderStatus,
    paymentMethod,
    category,
    search,
  } = req.query;

  // Manager is strictly restricted to Product Wise report
  const isManager = req.user?.role === "manager";
  const reportType = isManager ? "product" : (queryReportType || "summary");

  // Build Date Match Filter
  const dateFilter = {};
  if (startDate || endDate) {
    dateFilter.createdAt = {};
    if (startDate) {
      const parts = startDate.split("-");
      if (parts.length === 3) {
        dateFilter.createdAt.$gte = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 0, 0, 0, 0));
      } else {
        const sDate = new Date(startDate);
        sDate.setHours(0, 0, 0, 0);
        dateFilter.createdAt.$gte = sDate;
      }
    }
    if (endDate) {
      const parts = endDate.split("-");
      if (parts.length === 3) {
        dateFilter.createdAt.$lte = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 23, 59, 59, 999));
      } else {
        const eDate = new Date(endDate);
        eDate.setHours(23, 59, 59, 999);
        dateFilter.createdAt.$lte = eDate;
      }
    }
  }

  // Base Match Filter for Orders
  const orderBaseFilter = { ...dateFilter };

  const targetSalesman = salesmanId || req.query.salesman;
  if (targetSalesman && mongoose.Types.ObjectId.isValid(targetSalesman)) {
    const targetId = new mongoose.Types.ObjectId(targetSalesman);
    orderBaseFilter.$or = [
      { salesman: targetId },
      {
        $and: [
          { $or: [{ salesman: { $exists: false } }, { salesman: null }] },
          { createdBy: targetId },
        ],
      },
    ];
  }

  if (paymentMethod && paymentMethod !== "all") {
    orderBaseFilter["payments.method"] = paymentMethod;
  }

  // Calculate Overall Summary Stats
  const totalOrders = await Order.countDocuments(orderBaseFilter);
  
  const shopOrdersFilter = { ...orderBaseFilter, orderType: "shop" };
  const onlineOrdersFilter = { ...orderBaseFilter, orderType: "online" };

  const shopSalesAgg = await Order.aggregate([
    { $match: shopOrdersFilter },
    {
      $group: {
        _id: null,
        totalRevenue: { $sum: "$totalAmount" },
        totalDiscount: { $sum: "$discountAmount" },
        totalItemsSold: {
          $sum: {
            $reduce: {
              input: "$products",
              initialValue: 0,
              in: { $add: ["$$value", "$$this.quantity"] },
            },
          },
        },
        count: { $sum: 1 },
      },
    },
  ]);

  const onlineSalesAgg = await Order.aggregate([
    { $match: onlineOrdersFilter },
    {
      $group: {
        _id: null,
        totalRevenue: { $sum: "$totalAmount" },
        totalDiscount: { $sum: "$discountAmount" },
        totalShipping: { $sum: "$shippingFee" },
        totalItemsSold: {
          $sum: {
            $reduce: {
              input: "$products",
              initialValue: 0,
              in: { $add: ["$$value", "$$this.quantity"] },
            },
          },
        },
        count: { $sum: 1 },
      },
    },
  ]);

  const stats = {
    totalOrders,
    shopOrdersCount: shopSalesAgg[0]?.count || 0,
    onlineOrdersCount: onlineSalesAgg[0]?.count || 0,
    totalShopRevenue: isManager ? 0 : (shopSalesAgg[0]?.totalRevenue || 0),
    totalOnlineRevenue: isManager ? 0 : (onlineSalesAgg[0]?.totalRevenue || 0),
    totalRevenue: isManager ? 0 : ((shopSalesAgg[0]?.totalRevenue || 0) + (onlineSalesAgg[0]?.totalRevenue || 0)),
    totalDiscountGiven: isManager ? 0 : ((shopSalesAgg[0]?.totalDiscount || 0) + (onlineSalesAgg[0]?.totalDiscount || 0)),
    totalItemsSold: (shopSalesAgg[0]?.totalItemsSold || 0) + (onlineSalesAgg[0]?.totalItemsSold || 0),
    totalShippingFee: isManager ? 0 : (onlineSalesAgg[0]?.totalShipping || 0),
  };

  let reportData = [];

  // ==========================================
  // 1. PRODUCT WISE REPORT
  // ==========================================
  if (reportType === "product") {
    const productMatchFilter = {};
    if (category && mongoose.Types.ObjectId.isValid(category)) {
      productMatchFilter.category = new mongoose.Types.ObjectId(category);
    }
    const rawSearch = (search || req.query.productId || "").trim();
    if (rawSearch) {
      const escapedSearch = rawSearch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const searchOr = [
        { name: { $regex: escapedSearch, $options: "i" } },
        { productId: { $regex: escapedSearch, $options: "i" } },
        { barcode: { $regex: escapedSearch, $options: "i" } },
        { sku: { $regex: escapedSearch, $options: "i" } },
      ];
      if (mongoose.Types.ObjectId.isValid(rawSearch)) {
        searchOr.push({ _id: new mongoose.Types.ObjectId(rawSearch) });
      }
      productMatchFilter.$or = searchOr;
    }

    // Get product list with category & total stock
    const products = await Product.find(productMatchFilter)
      .populate("category", "name")
      .populate("brand", "name")
      .lean();

    // Aggregate sales data per product from Orders with Salesman Info
    const salesPerProduct = await Order.aggregate([
      { $match: orderBaseFilter },
      { $unwind: "$products" },
      {
        $lookup: {
          from: "users",
          localField: "salesman",
          foreignField: "_id",
          as: "salesmanInfo",
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "createdBy",
          foreignField: "_id",
          as: "creatorInfo",
        },
      },
      {
        $group: {
          _id: "$products.productId",
          totalQuantitySold: { $sum: "$products.quantity" },
          totalRevenueSold: {
            $sum: { $multiply: ["$products.price", "$products.quantity"] },
          },
          orderCount: { $sum: 1 },
          salesmenEntries: {
            $push: {
              name: {
                $cond: {
                  if: {
                    $and: [
                      { $ne: ["$salesmanName", null] },
                      { $ne: ["$salesmanName", ""] },
                    ],
                  },
                  then: "$salesmanName",
                  else: {
                    $ifNull: [
                      { $arrayElemAt: ["$salesmanInfo.name", 0] },
                      { $arrayElemAt: ["$creatorInfo.name", 0] },
                      {
                        $cond: {
                          if: { $eq: ["$orderType", "shop"] },
                          then: "Store Admin",
                          else: "Online Order",
                        },
                      },
                    ],
                  },
                },
              },
              email: {
                $ifNull: [
                  { $arrayElemAt: ["$salesmanInfo.email", 0] },
                  { $arrayElemAt: ["$creatorInfo.email", 0] },
                  "N/A",
                ],
              },
              quantity: "$products.quantity",
              revenue: { $multiply: ["$products.price", "$products.quantity"] },
            },
          },
        },
      },
    ]);

    // Aggregate product sales history with date details
    const productOrdersAgg = await Order.find(orderBaseFilter)
      .select("orderId customerName phone orderType salesmanName products salesman createdBy createdAt")
      .populate("salesman", "name")
      .populate("createdBy", "name")
      .sort({ createdAt: -1 })
      .lean();

    const prodHistoryMap = new Map();
    productOrdersAgg.forEach((o) => {
      (o.products || []).forEach((p) => {
        const pIdStr = typeof p.productId === "object" ? p.productId?._id?.toString() : p.productId?.toString();
        if (pIdStr) {
          const list = prodHistoryMap.get(pIdStr) || [];
          let soldBy = "Online Order";
          if (o.salesmanName && typeof o.salesmanName === "string" && o.salesmanName.trim() !== "") {
            soldBy = o.salesmanName.trim();
          } else if (o.salesman && o.salesman.name) {
            soldBy = o.salesman.name;
          } else if (o.createdBy && o.createdBy.name) {
            soldBy = o.createdBy.name;
          } else if (o.orderType === "shop") {
            soldBy = "Store Admin";
          } else {
            soldBy = "Online Order";
          }

          list.push({
            orderId: o.orderId,
            customerName: o.customerName || "Customer",
            salesmanName: soldBy,
            size: p.size || "N/A",
            color: p.color || "",
            quantity: p.quantity || 0,
            price: isManager ? 0 : (p.price || 0),
            totalRevenue: isManager ? 0 : ((p.price || 0) * (p.quantity || 0)),
            createdAt: o.createdAt,
          });
          prodHistoryMap.set(pIdStr, list);
        }
      });
    });

    const salesMap = new Map();
    salesPerProduct.forEach((s) => {
      if (s._id) {
        // Group salesmen by name and sum quantity/revenue per salesman
        const salesmanAggMap = new Map();
        (s.salesmenEntries || []).forEach((entry) => {
          const sName = entry.name || "Online Order";
          const current = salesmanAggMap.get(sName) || {
            name: sName,
            email: entry.email,
            quantity: 0,
            revenue: 0,
          };
          current.quantity += entry.quantity || 0;
          current.revenue += isManager ? 0 : (entry.revenue || 0);
          salesmanAggMap.set(sName, current);
        });

        const salesmenList = Array.from(salesmanAggMap.values());
        const salesmenSummaryStr = salesmenList
          .map((sm) => `${sm.name} (${sm.quantity} pcs)`)
          .join(", ");

        salesMap.set(s._id.toString(), {
          ...s,
          salesmenList,
          salesmenSummaryStr: salesmenSummaryStr || "N/A",
        });
      }
    });

    // Fetch all-time last sale dates for the products being inspected
    const prodIds = products.map((p) => p._id);
    const allTimeLastSaleMap = new Map();
    if (prodIds.length > 0) {
      const allTimeSales = await Order.aggregate([
        { $match: { "products.productId": { $in: prodIds } } },
        { $unwind: "$products" },
        { $match: { "products.productId": { $in: prodIds } } },
        {
          $group: {
            _id: "$products.productId",
            lastSaleDate: { $max: "$createdAt" },
          },
        },
      ]);
      allTimeSales.forEach((item) => {
        if (item._id) allTimeLastSaleMap.set(item._id.toString(), item.lastSaleDate);
      });
    }

    reportData = products.map((p) => {
      const pIdStr = p._id.toString();
      const pSales = salesMap.get(pIdStr) || {
        totalQuantitySold: 0,
        totalRevenueSold: 0,
        orderCount: 0,
        salesmenList: [],
        salesmenSummaryStr: "N/A",
      };

      const history = prodHistoryMap.get(pIdStr) || [];
      const lastSaleDate =
        (history.length > 0 ? history[0].createdAt : null) ||
        allTimeLastSaleMap.get(pIdStr) ||
        null;

      const totalStock = (p.variation || []).reduce(
        (sum, v) => sum + (v.stock || 0),
        0
      );

      const basePriceRange = (p.variation || []).map((v) => v.basePrice || 0);
      const minPrice = basePriceRange.length > 0 ? Math.min(...basePriceRange) : 0;
      const maxPrice = basePriceRange.length > 0 ? Math.max(...basePriceRange) : 0;

      return {
        _id: p._id,
        productId: p.productId,
        name: p.name,
        description: p.description,
        categoryName: p.category?.name || "N/A",
        brandName: p.brand?.name || "N/A",
        salesChannel: p.salesChannel || "BOTH",
        isActive: p.isActive,
        totalStock,
        variation: p.variation || [],
        priceRange: isManager ? "" : (minPrice === maxPrice ? `৳${minPrice}` : `৳${minPrice} - ৳${maxPrice}`),
        totalQuantitySold: pSales.totalQuantitySold,
        totalRevenueSold: isManager ? 0 : pSales.totalRevenueSold,
        orderCount: pSales.orderCount,
        salesmenList: pSales.salesmenList,
        salesmenSummary: pSales.salesmenSummaryStr,
        lastSaleDate,
        salesHistory: history,
      };
    });

    // Sort products by sales quantity descending, then by stock
    reportData.sort((a, b) => (b.totalQuantitySold || 0) - (a.totalQuantitySold || 0));

    // When searching for a product or filtering by category, NEVER exclude products with 0 sales
    // Only exclude products with 0 sales when viewing the global unfiltered sales report
    if (!rawSearch && !category) {
      reportData = reportData.filter((p) => p.totalQuantitySold > 0);
    }
  }

  // ==========================================
  // 2. SHOP SELL REPORT (POS)
  // ==========================================
  else if (reportType === "shop") {
    const shopFilter = { ...orderBaseFilter, orderType: "shop" };
    if (search) {
      shopFilter.$or = [
        { customerName: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
        { orderId: { $regex: search, $options: "i" } },
      ];
    }

    const shopOrders = await Order.find(shopFilter)
      .populate("salesman", "name email rewardPoints role")
      .populate("createdBy", "name email")
      .sort({ createdAt: -1 })
      .lean();

    reportData = shopOrders.map((o) => {
      const paymentSummary = Array.from(
        new Set((o.payments || []).map((p) => p.method).filter(Boolean))
      ).join(", ");

      const totalItems = (o.products || []).reduce(
        (acc, item) => acc + (item.quantity || 0),
        0
      );

      return {
        _id: o._id,
        orderId: o.orderId,
        customerName: o.customerName || "Walk-in Customer",
        phone: o.phone || "N/A",
        address: o.address || "N/A",
        totalAmount: o.totalAmount,
        subtotal: o.subtotal,
        discountAmount: o.discountAmount || 0,
        totalPaid: o.totalPaid || o.totalAmount,
        returnAmount: o.returnAmount || 0,
        paymentSummary: paymentSummary || "Cash",
        payments: o.payments || [],
        products: o.products || [],
        salesmanName: o.salesman?.name || o.createdBy?.name || "Store Admin",
        salesmanEmail: o.salesman?.email || "N/A",
        itemsCount: totalItems,
        createdAt: o.createdAt,
      };
    });
  }

  // ==========================================
  // 3. ONLINE SELL REPORT
  // ==========================================
  else if (reportType === "online") {
    const onlineFilter = { ...orderBaseFilter, orderType: "online" };
    if (orderStatus && orderStatus !== "all") {
      onlineFilter.status = orderStatus;
    }
    if (search) {
      onlineFilter.$or = [
        { customerName: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
        { orderId: { $regex: search, $options: "i" } },
        { address: { $regex: search, $options: "i" } },
      ];
    }

    const onlineOrders = await Order.find(onlineFilter)
      .sort({ createdAt: -1 })
      .lean();

    reportData = onlineOrders.map((o) => {
      const totalItems = (o.products || []).reduce(
        (acc, item) => acc + (item.quantity || 0),
        0
      );

      return {
        _id: o._id,
        orderId: o.orderId,
        customerName: o.customerName,
        phone: o.phone,
        address: o.address,
        shippingArea: o.shippingArea,
        shippingFee: o.shippingFee,
        totalAmount: o.totalAmount,
        subtotal: o.subtotal,
        discountAmount: o.discountAmount || 0,
        couponCode: o.couponCode || "N/A",
        status: o.status,
        products: o.products || [],
        payments: o.payments || [],
        itemsCount: totalItems,
        createdAt: o.createdAt,
      };
    });
  }

  // ==========================================
  // 4. SALESMAN WISE REPORT
  // ==========================================
  else if (reportType === "salesman") {
    // If a specific salesman filter is selected, query ONLY that salesman
    const salesmanUserQuery = {};
    if (targetSalesman && mongoose.Types.ObjectId.isValid(targetSalesman)) {
      salesmanUserQuery._id = new mongoose.Types.ObjectId(targetSalesman);
    } else {
      salesmanUserQuery.role = "salesman";
    }

    const salesmen = await User.find(salesmanUserQuery)
      .select("name email role rewardPoints createdAt")
      .lean();

    const salesmanMatchFilter = { ...orderBaseFilter };

    const salesmanIdExpr = {
      $cond: [
        { $and: [{ $ne: ["$salesman", null] }, { $ne: ["$salesman", undefined] }] },
        "$salesman",
        "$createdBy",
      ],
    };

    // Aggregate orders summary per salesman
    const salesmanOrdersAgg = await Order.aggregate([
      {
        $match: salesmanMatchFilter,
      },
      {
        $group: {
          _id: salesmanIdExpr,
          totalOrders: { $sum: 1 },
          totalSalesAmount: { $sum: "$totalAmount" },
          totalDiscountGiven: { $sum: "$discountAmount" },
          lastSaleDate: { $max: "$createdAt" },
        },
      },
    ]);

    // Aggregate sold products per salesman
    const salesmanProductsAgg = await Order.aggregate([
      {
        $match: salesmanMatchFilter,
      },
      { $unwind: "$products" },
      {
        $group: {
          _id: {
            salesmanId: salesmanIdExpr,
            name: "$products.name",
            size: "$products.size",
            color: "$products.color",
            price: "$products.price",
          },
          quantitySold: { $sum: "$products.quantity" },
          totalRevenue: {
            $sum: { $multiply: ["$products.price", "$products.quantity"] },
          },
          latestDate: { $max: "$createdAt" },
        },
      },
    ]);

    // Get itemized order sales history per salesman
    const salesmanOrdersList = await Order.find(salesmanMatchFilter)
      .select("orderId customerName phone products totalAmount discountAmount orderType createdAt salesman createdBy")
      .sort({ createdAt: -1 })
      .lean();

    const historyMap = new Map();
    salesmanOrdersList.forEach((o) => {
      const smId = (o.salesman && o.salesman.toString() !== "null") ? o.salesman : o.createdBy;
      const smIdStr = smId ? (typeof smId === "object" && smId._id ? smId._id.toString() : smId.toString()) : null;
      if (smIdStr) {
        const list = historyMap.get(smIdStr) || [];
        list.push({
          _id: o._id,
          orderId: o.orderId,
          customerName: o.customerName || "Walk-in Customer",
          phone: o.phone || "N/A",
          orderType: o.orderType,
          totalAmount: o.totalAmount,
          productsCount: (o.products || []).reduce((acc, p) => acc + (p.quantity || 0), 0),
          createdAt: o.createdAt,
          products: o.products || [],
        });
        historyMap.set(smIdStr, list);
      }
    });

    const ordersAggMap = new Map();
    salesmanOrdersAgg.forEach((s) => {
      if (s._id) ordersAggMap.set(s._id.toString(), s);
    });

    const productsAggMap = new Map();
    salesmanProductsAgg.forEach((item) => {
      const smIdStr = item._id.salesmanId?.toString();
      if (smIdStr) {
        const list = productsAggMap.get(smIdStr) || [];
        list.push({
          name: item._id.name || "Product",
          size: item._id.size || "N/A",
          color: item._id.color || "",
          price: item._id.price || 0,
          quantitySold: item.quantitySold || 0,
          totalRevenue: item.totalRevenue || 0,
          latestDate: item.latestDate,
        });
        productsAggMap.set(smIdStr, list);
      }
    });

    reportData = salesmen.map((sm) => {
      const smIdStr = sm._id.toString();
      const sAgg = ordersAggMap.get(smIdStr) || {
        totalOrders: 0,
        totalSalesAmount: 0,
        totalDiscountGiven: 0,
        lastSaleDate: null,
      };

      const soldProducts = productsAggMap.get(smIdStr) || [];
      const totalItemsSold = soldProducts.reduce((acc, p) => acc + (p.quantitySold || 0), 0);

      return {
        _id: sm._id,
        name: sm.name || "Unnamed Salesman",
        email: sm.email,
        role: sm.role,
        rewardPoints: sm.rewardPoints || 0,
        totalOrders: sAgg.totalOrders,
        totalSalesAmount: sAgg.totalSalesAmount,
        totalDiscountGiven: sAgg.totalDiscountGiven,
        totalItemsSold,
        lastSaleDate: sAgg.lastSaleDate,
        soldProducts,
        salesHistory: historyMap.get(smIdStr) || [],
      };
    });

    // Sort by totalSalesAmount descending
    reportData.sort((a, b) => b.totalSalesAmount - a.totalSalesAmount);
  }

    res.status(200).json({
      success: true,
      reportType,
      stats,
      data: reportData,
      generatedAt: new Date().toISOString(),
    });
  });

/**
 * @desc    Get paginated salesman details (products sold & orders history) on demand
 * @route   GET /api/admin/reports/salesman-details
 * @access  Private (Admin, Employee, Manager)
 */
const getSalesmanDetails = asyncHandler(async (req, res) => {
  const userPermissions = req.user?.permissions || [];
  const hasDetailsPermission = req.user?.role === "admin" || userPermissions.includes("reports.details");
  if (!hasDetailsPermission) {
    return res.status(403).json({
      success: false,
      message: "You do not have permission to view detailed salesman breakdown.",
    });
  }

  const {
    salesmanId,
    startDate,
    endDate,
    productsPage = 1,
    productsLimit = 10,
    ordersPage = 1,
    ordersLimit = 10,
  } = req.query;

  if (!salesmanId || !mongoose.Types.ObjectId.isValid(salesmanId)) {
    return res.status(400).json({ success: false, message: "Valid salesman ID is required." });
  }

  const targetId = new mongoose.Types.ObjectId(salesmanId);
  const salesmanUser = await User.findById(targetId).select("name email role rewardPoints").lean();

  if (!salesmanUser) {
    return res.status(404).json({ success: false, message: "Salesman not found." });
  }

  // Date Filter
  const dateFilter = {};
  if (startDate || endDate) {
    dateFilter.createdAt = {};
    if (startDate) {
      const parts = startDate.split("-");
      if (parts.length === 3) {
        dateFilter.createdAt.$gte = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 0, 0, 0, 0));
      } else {
        const sDate = new Date(startDate);
        sDate.setHours(0, 0, 0, 0);
        dateFilter.createdAt.$gte = sDate;
      }
    }
    if (endDate) {
      const parts = endDate.split("-");
      if (parts.length === 3) {
        dateFilter.createdAt.$lte = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 23, 59, 59, 999));
      } else {
        const eDate = new Date(endDate);
        eDate.setHours(23, 59, 59, 999);
        dateFilter.createdAt.$lte = eDate;
      }
    }
  }

  const smMatchFilter = {
    ...dateFilter,
    $or: [
      { salesman: targetId },
      {
        $and: [
          { $or: [{ salesman: { $exists: false } }, { salesman: null }] },
          { createdBy: targetId },
        ],
      },
      { salesmanName: { $regex: new RegExp(`^${salesmanUser.name}$`, "i") } },
    ],
  };

  // 1. Paginated Orders History
  const oPage = Math.max(1, parseInt(ordersPage));
  const oLimit = Math.max(1, parseInt(ordersLimit));
  const oSkip = (oPage - 1) * oLimit;

  const totalOrdersCount = await Order.countDocuments(smMatchFilter);
  const rawOrders = await Order.find(smMatchFilter)
    .select("orderId customerName phone products totalAmount discountAmount orderType createdAt")
    .sort({ createdAt: -1 })
    .skip(oSkip)
    .limit(oLimit)
    .lean();

  const salesHistory = rawOrders.map((o) => ({
    _id: o._id,
    orderId: o.orderId,
    customerName: o.customerName || "Walk-in Customer",
    phone: o.phone || "N/A",
    orderType: o.orderType,
    totalAmount: o.totalAmount,
    productsCount: (o.products || []).reduce((acc, p) => acc + (p.quantity || 0), 0),
    createdAt: o.createdAt,
    products: o.products || [],
  }));

  // 2. Aggregate Sold Products
  const pPage = Math.max(1, parseInt(productsPage));
  const pLimit = Math.max(1, parseInt(productsLimit));
  const pSkip = (pPage - 1) * pLimit;

  const soldProductsAgg = await Order.aggregate([
    { $match: smMatchFilter },
    { $unwind: "$products" },
    {
      $group: {
        _id: {
          name: "$products.name",
          size: "$products.size",
          color: "$products.color",
          price: "$products.price",
        },
        quantitySold: { $sum: "$products.quantity" },
        totalRevenue: { $sum: { $multiply: ["$products.price", "$products.quantity"] } },
        latestDate: { $max: "$createdAt" },
      },
    },
    { $sort: { quantitySold: -1 } },
  ]);

  const totalSoldProductsCount = soldProductsAgg.length;
  const paginatedSoldProducts = soldProductsAgg.slice(pSkip, pSkip + pLimit).map((item) => ({
    name: item._id.name || "Product",
    size: item._id.size || "N/A",
    color: item._id.color || "",
    price: item._id.price || 0,
    quantitySold: item.quantitySold || 0,
    totalRevenue: item.totalRevenue || 0,
    latestDate: item.latestDate,
  }));

  res.status(200).json({
    success: true,
    data: {
      salesman: salesmanUser,
      soldProducts: paginatedSoldProducts,
      soldProductsPagination: {
        currentPage: pPage,
        totalPages: Math.ceil(totalSoldProductsCount / pLimit) || 1,
        totalItems: totalSoldProductsCount,
        limit: pLimit,
      },
      salesHistory,
      salesHistoryPagination: {
        currentPage: oPage,
        totalPages: Math.ceil(totalOrdersCount / oLimit) || 1,
        totalItems: totalOrdersCount,
        limit: oLimit,
      },
    },
  });
});

/**
 * @desc    Compare reports across 2, 3, or 4 different periods (Weeks, Months, Years, or Custom Ranges)
 * @route   POST /api/admin/reports/compare
 * @access  Private (Admin, Employee, Manager)
 */
const compareReports = asyncHandler(async (req, res) => {
  const { periods, comparisonType = "month" } = req.body;
  const isManager = req.user?.role === "manager";

  if (!Array.isArray(periods) || periods.length < 2 || periods.length > 4) {
    return res.status(400).json({
      success: false,
      message: "Please provide between 2 and 4 periods to compare.",
    });
  }

  const periodResults = await Promise.all(
    periods.map(async (period, index) => {
      const { label, startDate, endDate } = period;
      const dateFilter = {};

      if (startDate || endDate) {
        dateFilter.createdAt = {};
        if (startDate) {
          const parts = String(startDate).split("-");
          if (parts.length === 3) {
            dateFilter.createdAt.$gte = new Date(
              Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 0, 0, 0, 0)
            );
          } else {
            const sDate = new Date(startDate);
            sDate.setHours(0, 0, 0, 0);
            dateFilter.createdAt.$gte = sDate;
          }
        }
        if (endDate) {
          const parts = String(endDate).split("-");
          if (parts.length === 3) {
            dateFilter.createdAt.$lte = new Date(
              Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 23, 59, 59, 999)
            );
          } else {
            const eDate = new Date(endDate);
            eDate.setHours(23, 59, 59, 999);
            dateFilter.createdAt.$lte = eDate;
          }
        }
      }

      const shopOrdersFilter = { ...dateFilter, orderType: "shop" };
      const onlineOrdersFilter = { ...dateFilter, orderType: "online" };

      const [totalOrders, shopSalesAgg, onlineSalesAgg, topProductsAgg, paymentAgg] =
        await Promise.all([
          Order.countDocuments(dateFilter),
          Order.aggregate([
            { $match: shopOrdersFilter },
            {
              $group: {
                _id: null,
                totalRevenue: { $sum: "$totalAmount" },
                totalDiscount: { $sum: "$discountAmount" },
                totalItemsSold: {
                  $sum: {
                    $reduce: {
                      input: "$products",
                      initialValue: 0,
                      in: { $add: ["$$value", "$$this.quantity"] },
                    },
                  },
                },
                count: { $sum: 1 },
              },
            },
          ]),
          Order.aggregate([
            { $match: onlineOrdersFilter },
            {
              $group: {
                _id: null,
                totalRevenue: { $sum: "$totalAmount" },
                totalDiscount: { $sum: "$discountAmount" },
                totalShipping: { $sum: "$shippingFee" },
                totalItemsSold: {
                  $sum: {
                    $reduce: {
                      input: "$products",
                      initialValue: 0,
                      in: { $add: ["$$value", "$$this.quantity"] },
                    },
                  },
                },
                count: { $sum: 1 },
              },
            },
          ]),
          Order.aggregate([
            { $match: dateFilter },
            { $unwind: "$products" },
            {
              $group: {
                _id: "$products.name",
                productId: { $first: "$products.productId" },
                quantitySold: { $sum: "$products.quantity" },
                totalRevenue: {
                  $sum: { $multiply: ["$products.price", "$products.quantity"] },
                },
              },
            },
            { $sort: { quantitySold: -1 } },
            { $limit: 5 },
          ]),
          Order.aggregate([
            { $match: dateFilter },
            { $unwind: "$payments" },
            {
              $group: {
                _id: "$payments.method",
                amount: { $sum: "$payments.amount" },
                count: { $sum: 1 },
              },
            },
          ]),
        ]);

      const shopRevenue = shopSalesAgg[0]?.totalRevenue || 0;
      const onlineRevenue = onlineSalesAgg[0]?.totalRevenue || 0;
      const totalRevenue = shopRevenue + onlineRevenue;
      const totalDiscount =
        (shopSalesAgg[0]?.totalDiscount || 0) + (onlineSalesAgg[0]?.totalDiscount || 0);
      const totalItems =
        (shopSalesAgg[0]?.totalItemsSold || 0) + (onlineSalesAgg[0]?.totalItemsSold || 0);
      const aov = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;

        const periodSummary = {
          totalOrders,
          shopOrdersCount: shopSalesAgg[0]?.count || 0,
          onlineOrdersCount: onlineSalesAgg[0]?.count || 0,
          totalRevenue: isManager ? 0 : totalRevenue,
          totalShopRevenue: isManager ? 0 : shopRevenue,
          totalOnlineRevenue: isManager ? 0 : onlineRevenue,
          totalDiscountGiven: isManager ? 0 : totalDiscount,
          totalItemsSold: totalItems,
          averageOrderValue: isManager ? 0 : aov,
        };

        return {
          index,
          label: label || `Period ${index + 1}`,
          startDate: startDate || "",
          endDate: endDate || "",
          stats: periodSummary,
        topProducts: topProductsAgg.map((p) => ({
          name: p._id || "Unknown Product",
          productId: p.productId || "",
          quantitySold: p.quantitySold || 0,
          revenue: isManager ? 0 : p.totalRevenue || 0,
        })),
        paymentMethods: paymentAgg.map((pm) => ({
          method: pm._id || "cash",
          amount: isManager ? 0 : pm.amount || 0,
          count: pm.count || 0,
        })),
      };
    })
  );

  // Compute percentage differences
  const comparisonWithDeltas = periodResults.map((current, idx) => {
    if (idx === 0) {
      return {
        ...current,
        growthVsPrevious: null,
        growthVsBase: null,
      };
    }

    const prev = periodResults[idx - 1];
    const base = periodResults[0];

    const calcGrowth = (currVal, prevVal) => {
      if (!prevVal || prevVal === 0) {
        return currVal > 0 ? 100 : 0;
      }
      return Number((((currVal - prevVal) / prevVal) * 100).toFixed(1));
    };

    const growthVsPrevious = {
      revenueGrowth: calcGrowth(current.summary.totalRevenue, prev.summary.totalRevenue),
      ordersGrowth: calcGrowth(current.summary.totalOrders, prev.summary.totalOrders),
      itemsSoldGrowth: calcGrowth(current.summary.totalItemsSold, prev.summary.totalItemsSold),
      discountGrowth: calcGrowth(current.summary.totalDiscountGiven, prev.summary.totalDiscountGiven),
    };

    const growthVsBase = {
      revenueGrowth: calcGrowth(current.summary.totalRevenue, base.summary.totalRevenue),
      ordersGrowth: calcGrowth(current.summary.totalOrders, base.summary.totalOrders),
      itemsSoldGrowth: calcGrowth(current.summary.totalItemsSold, base.summary.totalItemsSold),
      discountGrowth: calcGrowth(current.summary.totalDiscountGiven, base.summary.totalDiscountGiven),
    };

    return {
      ...current,
      growthVsPrevious,
      growthVsBase,
    };
  });

  res.status(200).json({
    success: true,
    data: {
      comparisonType,
      periodsCount: periods.length,
      periods: comparisonWithDeltas,
    },
  });
});

module.exports = {
  getReports,
  getSalesmanDetails,
  compareReports,
};
