/**
 * ============================================================
 * validations/orderValidation.js — Online Order Validation
 * ============================================================
 * Website থেকে আসা online order এর জন্য input validate করার
 * রুলস এই ফাইলে আছে।
 *
 * বিশেষ নিয়ম:
 *  - products[]: অন্তত 1টি item থাকতে হবে
 *  - shippingArea: "Inside Dhaka" বা "Outside Dhaka"
 *  - status: pending, received, shipping, delivered, cancelled
 *  - subtotal, shippingFee, totalAmount: numeric হতে হবে
 *
 * Exported validators:
 *  - validateCreateOrder       → POST /api/order
 *  - validateUpdateOrderStatus → PATCH /api/order/:id/status
 *  - validateOrderId           → GET/DELETE /api/order/:id
 * ============================================================
 */
const { body, param } = require("express-validator");
const { handleValidation } = require("../middleware/validation");

const validateCreateOrder = [
  body("customerName")
    .trim()
    .notEmpty()
    .withMessage("Customer name is required")
    .bail()
    .isLength({ min: 2, max: 100 })
    .withMessage("Customer name must be between 2 and 100 characters"),
  body("address")
    .trim()
    .notEmpty()
    .withMessage("Address is required")
    .bail()
    .isLength({ min: 5, max: 500 })
    .withMessage("Address must be between 5 and 500 characters"),
  body("phone")
    .trim()
    .notEmpty()
    .withMessage("Phone number is required")
    .bail()
    .custom((value) => {
      return /^(?:\+?88)?01[3-9]\d{8}$/.test(value);
    })
    .withMessage("Please provide a valid Bangladeshi phone number"),
  body("products")
    .isArray({ min: 1 })
    .withMessage("At least one product is required"),
  body("products.*.productId").isMongoId().withMessage("Invalid product ID"),
  body("products.*.quantity")
    .isInt({ min: 1 })
    .withMessage("Product quantity must be at least 1"),
  body("products.*.price").isNumeric().withMessage("Product price is required"),
  body("products.*.name").notEmpty().withMessage("Product name is required"),
  body("products.*.size").optional().isString(), // Add this line
  body("products.*.color").optional().isString(), // Add this line
  body("couponCode").optional().trim().isString(),
  body("discountAmount").optional().isNumeric(),
  body("subtotal").isNumeric().withMessage("Subtotal is required"),
  body("shippingFee").isNumeric().withMessage("Shipping fee is required"),
  body("shippingArea")
    .isIn(["Inside Dhaka", "Outside Dhaka"])
    .withMessage(
      'Shipping area must be either "Inside Dhaka" or "Outside Dhaka"',
    ),
  body("totalAmount").isNumeric().withMessage("Total amount is required"),
  handleValidation,
];

const validateUpdateOrderStatus = [
  param("id").isMongoId().withMessage("Invalid order ID in URL"),
  body("status")
    .optional()
    .isIn(["pending", "received", "shipping", "delivered", "cancelled", "returned", "refunded", "partial-returned"])
    .withMessage(
      "Status must be one of: pending, received, shipping, delivered, cancelled, returned, refunded, partial-returned",
    ),
  body("shippingArea")
    .optional()
    .isIn(["Inside Dhaka", "Outside Dhaka"])
    .withMessage('Shipping area must be either "Inside Dhaka" or "Outside Dhaka"'),
  handleValidation,
];

const validateOrderId = [
  param("id").isMongoId().withMessage("Invalid order ID in URL"),
  handleValidation,
];

module.exports = {
  validateCreateOrder,
  validateUpdateOrderStatus,
  validateOrderId,
};
