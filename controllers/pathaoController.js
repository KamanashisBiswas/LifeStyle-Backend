/**
 * ============================================================
 * controllers/pathaoController.js — Pathao Courier Integration
 * ============================================================
 * Endpoints for managing stores, cascading location lookups,
 * dispatching parcels, and tracking deliveries via Pathao Aladdin API.
 * ============================================================
 */
const pathaoService = require("../services/pathaoService");
const Order = require("../models/Order");

/**
 * @desc    Get merchant pickup stores from Pathao
 * @route   GET /api/admin/pathao/stores
 * @access  Private (Admin, Employee, Manager)
 */
const getStores = async (req, res) => {
  try {
    const data = await pathaoService.getStores();
    return res.status(200).json({
      success: true,
      data: data.data?.data || data.data || [],
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch stores from Pathao",
    });
  }
};

/**
 * @desc    Create a new pickup store in Pathao
 * @route   POST /api/admin/pathao/stores
 * @access  Private (Admin, Manager)
 */
const createStore = async (req, res) => {
  try {
    const { name, contact_name, contact_number, address, city_id, zone_id, area_id } = req.body;
    if (!name || !contact_name || !contact_number || !address || !city_id || !zone_id) {
      return res.status(400).json({
        success: false,
        message: "name, contact_name, contact_number, address, city_id, and zone_id are required",
      });
    }

    const data = await pathaoService.createStore(req.body);
    return res.status(201).json({
      success: true,
      data: data.data || data,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to create store in Pathao",
    });
  }
};

/**
 * @desc    Get list of all cities
 * @route   GET /api/admin/pathao/cities
 * @access  Private (Admin, Employee, Manager)
 */
const getCities = async (req, res) => {
  try {
    const data = await pathaoService.getCities();
    return res.status(200).json({
      success: true,
      data: data.data?.data || data.data || [],
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch cities from Pathao",
    });
  }
};

/**
 * @desc    Get zones for a specific city
 * @route   GET /api/admin/pathao/cities/:cityId/zones
 * @access  Private (Admin, Employee, Manager)
 */
const getZones = async (req, res) => {
  try {
    const { cityId } = req.params;
    const data = await pathaoService.getZones(cityId);
    return res.status(200).json({
      success: true,
      data: data.data?.data || data.data || [],
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch zones from Pathao",
    });
  }
};

/**
 * @desc    Get areas for a specific zone
 * @route   GET /api/admin/pathao/zones/:zoneId/areas
 * @access  Private (Admin, Employee, Manager)
 */
const getAreas = async (req, res) => {
  try {
    const { zoneId } = req.params;
    const data = await pathaoService.getAreas(zoneId);
    return res.status(200).json({
      success: true,
      data: data.data?.data || data.data || [],
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch areas from Pathao",
    });
  }
};

/**
 * @desc    Calculate Pathao delivery price plan preview
 * @route   POST /api/admin/pathao/calculate-price
 * @access  Private (Admin, Employee, Manager)
 */
const calculatePrice = async (req, res) => {
  try {
    const data = await pathaoService.calculatePrice(req.body);
    return res.status(200).json({
      success: true,
      data: data.data || data,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to calculate delivery price with Pathao",
    });
  }
};

/**
 * @desc    Dispatch / Create an order in Pathao
 * @route   POST /api/admin/pathao/create-order
 * @access  Private (Admin, Employee, Manager)
 */
const sendOrderToPathao = async (req, res) => {
  try {
    const {
      orderId, // MongoDB _id or custom orderId (e.g. ORD-00011)
      store_id,
      store_name,
      city_id,
      city_name,
      zone_id,
      zone_name,
      area_id,
      area_name,
      item_weight = 0.5,
      item_quantity = 1,
      item_type = 2, // 2 for Parcel, 1 for Document
      delivery_type = 48, // 48 for standard delivery
      amount_to_collect,
      special_instruction = "",
      item_description = "",
    } = req.body;

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "orderId is required",
      });
    }

    // Find the order
    const order = await Order.findOne({
      $or: [{ _id: orderId.match(/^[0-9a-fA-F]{24}$/) ? orderId : null }, { orderId: orderId }],
    });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: `Order not found with id "${orderId}"`,
      });
    }

    if (order.pathaoOrder && order.pathaoOrder.consignmentId) {
      return res.status(400).json({
        success: false,
        message: `This order is already dispatched to Pathao with Consignment ID: ${order.pathaoOrder.consignmentId}`,
        pathaoOrder: order.pathaoOrder,
      });
    }

    // Clean recipient fields (support custom edited details from modal)
    const recName = req.body.recipient_name || order.customerName;
    const recAddress = req.body.recipient_address || order.address;
    let recPhone = (req.body.recipient_phone || order.phone || "").replace(/[^0-9]/g, "");
    if (recPhone.startsWith("880")) recPhone = "0" + recPhone.slice(3);
    else if (!recPhone.startsWith("0")) recPhone = "0" + recPhone;

    // Calculate COD Collection Amount
    let finalCollectAmount = 0;
    if (amount_to_collect !== undefined && amount_to_collect !== null) {
      finalCollectAmount = Number(amount_to_collect);
    } else if (order.paymentStatus === "Paid") {
      finalCollectAmount = 0;
    } else if (order.isDeliveryChargePaid) {
      finalCollectAmount = Math.max(0, (order.totalAmount || 0) - (order.shippingFee || 0));
    } else {
      finalCollectAmount = Number(order.totalAmount || 0);
    }

    // Prepare item description if not provided
    const desc =
      item_description ||
      (order.products && order.products.length > 0
        ? order.products.map((p) => `${p.name || "Product"} (x${p.quantity || 1})`).join(", ")
        : "Lifestyle Fashion Item");

    const payload = {
      store_id: Number(store_id),
      merchant_order_id: order.orderId,
      recipient_name: recName,
      recipient_phone: recPhone,
      recipient_address: recAddress,
      recipient_city: Number(city_id),
      recipient_zone: Number(zone_id),
      recipient_area: area_id ? Number(area_id) : undefined,
      delivery_type: Number(delivery_type || 48),
      item_type: Number(item_type || 2),
      special_instruction: special_instruction || order.note || "",
      item_quantity: Number(item_quantity || order.products?.length || 1),
      item_weight: Number(item_weight || 0.5),
      amount_to_collect: finalCollectAmount,
      item_description: desc,
    };

    // Call Pathao Aladdin API
    const responseData = await pathaoService.createOrder(payload);
    const pData = responseData.data || responseData;

    const consignmentId = pData.consignment_id || pData.data?.consignment_id;
    const trackingCode = pData.tracking_code || pData.data?.tracking_code || consignmentId;
    const deliveryFee = pData.delivery_fee || pData.data?.delivery_fee || 0;
    const orderStatus = pData.order_status || pData.data?.order_status || "Pending";

    // Update Order Document in MongoDB
    order.pathaoOrder = {
      consignmentId,
      trackingCode,
      orderStatus,
      deliveryFee,
      storeId: Number(store_id),
      storeName: store_name || null,
      cityId: Number(city_id),
      cityName: city_name || null,
      zoneId: Number(zone_id),
      zoneName: zone_name || null,
      areaId: area_id ? Number(area_id) : null,
      areaName: area_name || null,
      itemWeight: Number(item_weight),
      collectAmount: finalCollectAmount,
      dispatchedAt: new Date(),
      rawResponse: pData,
    };

    // If order was pending or received, update status to "shipping"
    if (["pending", "received"].includes(order.status)) {
      order.status = "shipping";
    }

    await order.save();

    return res.status(200).json({
      success: true,
      message: `Order successfully dispatched to Pathao! Consignment ID: ${consignmentId}`,
      data: order,
      pathao: pData,
    });
  } catch (error) {
    console.error("sendOrderToPathao Error:", error);
    return res.status(error.response?.status || 500).json({
      success: false,
      message: error.message || "Failed to create order in Pathao",
      error: error.response?.data || null,
    });
  }
};

/**
 * @desc    Track Pathao parcel status
 * @route   GET /api/admin/pathao/track/:consignmentId
 * @access  Private (Admin, Employee, Manager)
 */
const trackPathaoOrder = async (req, res) => {
  try {
    const { consignmentId } = req.params;
    const data = await pathaoService.trackOrder(consignmentId);
    const trackingInfo = data.data || data;

    // Synchronize latest status to order if found
    if (trackingInfo && trackingInfo.order_status) {
      await Order.updateOne(
        { "pathaoOrder.consignmentId": consignmentId },
        { $set: { "pathaoOrder.orderStatus": trackingInfo.order_status } }
      );
    }

    return res.status(200).json({
      success: true,
      data: trackingInfo,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to track parcel from Pathao",
    });
  }
};

module.exports = {
  getStores,
  createStore,
  getCities,
  getZones,
  getAreas,
  calculatePrice,
  sendOrderToPathao,
  trackPathaoOrder,
};
