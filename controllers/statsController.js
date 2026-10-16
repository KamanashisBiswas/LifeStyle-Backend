const User = require("../models/User");
const Customer = require("../models/Customer");
const Category = require("../models/Category");
const SubCategory = require("../models/SubCategory");
const Brand = require("../models/Brand");
const Product = require("../models/Product");
const Order = require("../models/Order");
const Expense = require("../models/Expense");
const Exchange = require("../models/Exchange");
const Return = require("../models/Return");
const OwnerPayout = require("../models/OwnerPayout");

/**
 * GET /api/stats/dashboard
 * Private (Admin / Employee / Salesman)
 * Returns overview statistics for the admin dashboard
 */
exports.getDashboardStats = async (req, res, next) => {
  try {
    const isAdmin = req.user?.role === "admin";

    const [
      totalUsers,
      totalCustomers,
      totalCategories,
      totalSubCategories,
      totalBrands,
      totalProducts,
      totalOrders,
      shopOrdersCount,
      onlineOrdersCount,
    ] = await Promise.all([
      User.countDocuments(),
      Customer.countDocuments(),
      Category.countDocuments(),
      SubCategory.countDocuments(),
      Brand.countDocuments(),
      Product.countDocuments(),
      Order.countDocuments(),
      Order.countDocuments({ address: "POS Sale" }),
      Order.countDocuments({ address: { $ne: "POS Sale" } }),
    ]);

    // Calculate actual revenue (gross sales excluding cancelled orders)
    const revenueResult = await Order.aggregate([
      { $match: { status: { $ne: "cancelled" } } },
      { $group: { _id: null, total: { $sum: "$totalAmount" } } },
    ]);
    const totalRevenue = revenueResult[0]?.total || 0;

    // Calculate Returns (Shop & Online) with intelligent fallback
    let shopReturnsCount = 0;
    let shopReturnValue = 0;
    let onlineReturnsCount = 0;
    let onlineReturnValue = 0;

    const allReturns = await Return.find({
      status: { $ne: "rejected" },
    })
      .populate("order")
      .populate("product")
      .lean();

    if (allReturns && allReturns.length > 0) {
      allReturns.forEach((r) => {
        const isShop = r.order && (r.order.address === "POS Sale" || r.reason === "Shop Return");
        let val = Number(r.refundAmount || 0);
        if (val === 0 && r.order) {
          val = Number(r.order.totalAmount || r.order.subtotal || 0);
        }
        if (val === 0 && r.product) {
          val = Number(r.product.discountPrice || r.product.price || 0) * Number(r.quantity || 1);
        }
        if (isShop) {
          shopReturnsCount++;
          shopReturnValue += val;
        } else {
          onlineReturnsCount++;
          onlineReturnValue += val;
        }
      });
    }

    // Also check Order collection for any returned/refunded orders not in Return collection
    const returnedOrders = await Order.find({
      status: { $in: ["returned", "partial-returned", "refunded"] },
    }).lean();

    returnedOrders.forEach((order) => {
      const isShop = order.address === "POS Sale";
      const val = Number(order.totalAmount || order.subtotal || 0);
      const alreadyCounted = allReturns.some(
        (r) => r.order && r.order._id && r.order._id.toString() === order._id.toString()
      );
      if (!alreadyCounted) {
        if (isShop) {
          shopReturnsCount++;
          shopReturnValue += val;
        } else {
          onlineReturnsCount++;
          onlineReturnValue += val;
        }
      }
    });

    // Calculate Shop Exchanges
    const exchanges = await Exchange.find({}).lean();
    const shopExchangeCount = exchanges.length;
    const shopExchangeValue = exchanges.reduce(
      (sum, ex) => sum + Number(ex.additionalPaymentAmount || 0),
      0
    );

    const exchangePaymentBreakdown = { Cash: 0, Bkash: 0, Card: 0, "Bangla QR": 0 };
    exchanges.forEach((ex) => {
      const m = ex.paymentMethod || "Cash";
      exchangePaymentBreakdown[m] =
        (exchangePaymentBreakdown[m] || 0) + Number(ex.additionalPaymentAmount || 0);
    });

    let shopProfit = 0;
    let onlineProfit = 0;
    let totalNetProfit = 0;

    if (isAdmin) {
      // 1. Calculate Shop (POS) Profit
      const shopOrders = await Order.find({ address: "POS Sale" }).lean();
      let shopSales = 0;
      let shopProductCost = 0;

      const shopProductIds = [];
      shopOrders.forEach((o) => {
        (o.products || []).forEach((p) => {
          if (p.productId) shopProductIds.push(p.productId);
        });
      });
      const dbProductsList = await Product.find({ _id: { $in: shopProductIds } }).lean();
      const dbProductMap = new Map(dbProductsList.map((prod) => [prod._id.toString(), prod]));

      shopOrders.forEach((order) => {
        shopSales += Number(order.totalAmount || 0);
        if (order.products && Array.isArray(order.products)) {
          order.products.forEach((product) => {
            let purchasePrice = Number(product.purchasePrice) || 0;
            if (purchasePrice === 0 && product.productId) {
              const dbProd = dbProductMap.get(product.productId.toString());
              if (dbProd && Array.isArray(dbProd.variation)) {
                const matchedVar = dbProd.variation.find(
                  (v) =>
                    (v.size === product.size || (!v.size && !product.size)) &&
                    (v.color === product.color || (!v.color && !product.color))
                );
                if (matchedVar) purchasePrice = Number(matchedVar.purchasePrice) || 0;
                else if (dbProd.variation[0]) purchasePrice = Number(dbProd.variation[0].purchasePrice) || 0;
              }
            }
            shopProductCost += purchasePrice * Number(product.quantity || 0);
          });
        }
      });

      // Deduct returned merchandise purchase price from shopProductCost
      const shopOrderIds = shopOrders.map((o) => o._id);
      const shopReturns = allReturns.filter(
        (r) =>
          r.order &&
          (r.order.address === "POS Sale" ||
            r.reason === "Shop Return" ||
            shopOrderIds.some((id) => id.toString() === (r.order._id || r.order).toString()))
      );

      let totalShopReturnPurchasePrice = 0;
      shopReturns.forEach((ret) => {
        const originalOrder = shopOrders.find(
          (o) => o._id.toString() === (ret.order?._id || ret.order || "").toString()
        );
        if (originalOrder) {
          const matchedProduct = (originalOrder.products || []).find(
            (p) =>
              (p.productId?._id || p.productId || "").toString() === (ret.product?._id || ret.product || "").toString() &&
              (p.size === ret.productSize || (!p.size && !ret.productSize)) &&
              (p.color === ret.productColor || (!p.color && !ret.productColor))
          );
          if (matchedProduct) {
            totalShopReturnPurchasePrice += (Number(matchedProduct.purchasePrice) || 0) * (Number(ret.quantity) || 0);
          }
        }
      });

      const adjustedShopPurchaseCost = Math.max(0, shopProductCost - totalShopReturnPurchasePrice);
      const expenses = await Expense.find({}).lean();
      const totalShopExpense = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);

      shopProfit = (shopSales - shopReturnValue + shopExchangeValue - totalShopExpense) - adjustedShopPurchaseCost;

      // 2. Calculate Online Orders Profit
      const onlineOrders = await Order.find({
        address: { $ne: "POS Sale" },
        status: { $nin: ["cancelled", "returned", "refunded"] },
      }).lean();

      let onlineGrossSales = 0;
      let onlineShippingFee = 0;
      let onlineProductCost = 0;

      const onlineProdIds = [];
      onlineOrders.forEach((o) => {
        (o.products || []).forEach((p) => {
          if (p.productId) onlineProdIds.push(p.productId);
        });
      });
      const onlineDbProds = await Product.find({ _id: { $in: onlineProdIds } }).lean();
      const onlineProdMap = new Map(onlineDbProds.map((prod) => [prod._id.toString(), prod]));

      onlineOrders.forEach((order) => {
        onlineGrossSales += Number(order.totalAmount || 0);
        onlineShippingFee += Number(order.shippingFee || 0);
        if (order.products && Array.isArray(order.products)) {
          order.products.forEach((product) => {
            let purchasePrice = Number(product.purchasePrice) || 0;
            if (purchasePrice === 0 && product.productId) {
              const dbProd = onlineProdMap.get(product.productId.toString());
              if (dbProd && Array.isArray(dbProd.variation)) {
                const matchedVar = dbProd.variation.find(
                  (v) =>
                    (v.size === product.size || (!v.size && !product.size)) &&
                    (v.color === product.color || (!v.color && !product.color))
                );
                if (matchedVar) purchasePrice = Number(matchedVar.purchasePrice) || 0;
                else if (dbProd.variation[0]) purchasePrice = Number(dbProd.variation[0].purchasePrice) || 0;
              }
            }
            onlineProductCost += purchasePrice * Number(product.quantity || 0);
          });
        }
      });

      const netOnlineSales = Math.max(0, onlineGrossSales - onlineShippingFee - onlineReturnValue);
      onlineProfit = Math.max(0, netOnlineSales - onlineProductCost);
      totalNetProfit = shopProfit + onlineProfit;

      // 3. Calculate Shop Owner Payout Summary
      const allPayouts = await OwnerPayout.find({ status: { $ne: "Cancelled" } }).lean();
      let totalPaidToOwner = 0;
      allPayouts.forEach((p) => {
        totalPaidToOwner += Number(p.amount || 0);
      });

      var payoutSummary = {
        shopNetProfit: Math.round(shopProfit * 100) / 100,
        totalPaidToOwner,
        remainingProfitBalance: Math.round((shopProfit - totalPaidToOwner) * 100) / 100,
        totalTransactions: allPayouts.length,
      };
    }

    res.status(200).json({
      success: true,
      data: {
        totalUsers,
        totalCustomers,
        totalCategories,
        totalSubCategories,
        totalBrands,
        totalProducts,
        totalOrders,
        shopOrdersCount,
        onlineOrdersCount,
        totalRevenue,
        shopReturnsCount,
        shopReturnValue,
        onlineReturnsCount,
        onlineReturnValue,
        shopExchangeCount,
        shopExchangeValue,
        exchangePaymentBreakdown,
        ...(isAdmin
          ? {
              totalNetProfit,
              shopProfit,
              onlineProfit,
              payoutSummary,
            }
          : {}),
      },
    });
  } catch (error) {
    next(error);
  }
};
