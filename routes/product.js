/**
 * ============================================================
 * routes/product.js — Product Routes
 * ============================================================
 * Base path: /api/product
 *
 * Route সমূহ:
 *  POST   /api/product              → authenticate + authorize(employee/admin) + upload, createProduct
 *  GET    /api/product              → Public, getAllProducts (ফিল্তার/সার্চ/pagination)
 *  GET    /api/product/search       → Public, searchProducts
 *  GET    /api/product/suggestions  → Public, অটোকম্প্লিট suggestions
 *  GET    /api/product/admin        → authenticate + authorize, getAllProductsAdmin
 *  GET    /api/product/inventory    → authenticate, inventory দেখা
 *  GET    /api/product/zero-stock   → authenticate, 0 stock products
 *  GET    /api/product/:id          → Public, getProductByCustomId
 *  PUT    /api/product/:id          → authenticate + authorize + upload, updateProduct
 *  DELETE /api/product/:id          → authenticate + authorize(admin), deleteProduct
 * ============================================================
 */

const express = require("express");
const publicRouter = express.Router();
const adminRouter = express.Router();
const { productUpload } = require("../config/cloudinary");

const {
  createProduct,
  getAllProducts,
  getAllProductsAdmin,
  getZeroStockProducts, // Import the new controller
  getProductById,
  updateProduct,
  deleteProduct,
  getInventoryProducts,
  exportInventoryToExcel, // Import export function
  searchProducts, // Import the new search controller
  getSearchSuggestions,
  getRelatedProducts,
  searchProductsAdmin, // Import admin search controller
  getTopSellingProducts,
  getStockManagementProducts,
  updateStockLocations,
  transferStockLocation,
  stockAdjustment,
  getStockMovements,
} = require("../controllers/productController");

const { authenticate, authorize, optionalAuth } = require("../middleware/auth");
const {
  validateCreateProduct,
  validateProductId,
  validateUpdateProduct,
} = require("../validations/productValidation");

// Create Product (with file upload)
// Uses productUpload.any() to accept dynamic per-variation image fields:
//   variation_0_images, variation_1_images, variation_N_images, ...
// The controller maps these uploaded files to the correct variation.
adminRouter.post(
  "/",
  authenticate,
  authorize("admin", "employee", "products.create"),
  productUpload.any(),
  validateCreateProduct,
  createProduct,
);

// Get All Products (Public - optional auth to identify user for price filtering)
publicRouter.get("/", optionalAuth, getAllProducts);

// @desc    Search products by name
// @route   GET /api/product/search
// @access  Public - optional auth for price filtering
publicRouter.get("/search", optionalAuth, searchProducts);

// @desc    Get search suggestions (autocomplete)
// @route   GET /api/product/suggestions
// @access  Public - optional auth for price filtering
publicRouter.get("/suggestions", optionalAuth, getSearchSuggestions);

// @desc    Get top selling products (aggregated by sales)
// @route   GET /api/product/top-selling
// @access  Public - optional auth for price filtering
publicRouter.get("/top-selling", optionalAuth, getTopSellingProducts);

// @desc    Search products by name or productId (Admin)
// @route   GET /api/admin/product/search
// @access  Private (Admin/Employee/Manager)
adminRouter.get(
  "/search",
  authenticate,
  authorize(
    "admin",
    "employee",
    "manager",
    "salesman",
    "products.view",
    "pos.sell",
    "pos.my_sell",
    "orders.create",
    "purchases.create",
    "exchanges.create",
    "shop_returns.create"
  ),
  searchProductsAdmin,
);

// Get All Products for Admin (including inactive)
adminRouter.get(
  "/",
  authenticate,
  authorize("admin", "employee", "manager", "products.view"),
  getAllProductsAdmin,
);

// Get Products with Zero Stock (Employee, Admin, Manager)
adminRouter.get(
  "/zero-stock",
  authenticate,
  authorize("admin", "employee", "manager", "out_of_stock.view", "products.view"),
  getZeroStockProducts,
);

// Route to get inventory products
adminRouter
  .route("/inventory")
  .get(
    authenticate,
    authorize("admin", "employee", "manager", "inventory.view"),
    getInventoryProducts,
  );

// Route to export inventory to Excel
adminRouter.get(
  "/inventory/export",
  authenticate,
  authorize("admin", "employee", "manager", "inventory.view"),
  exportInventoryToExcel,
);

// Stock Management across locations (Display, Shop, Store Room)
adminRouter.get(
  "/stock-management",
  authenticate,
  authorize("admin", "employee", "manager", "stock.manage", "inventory.view"),
  getStockManagementProducts,
);

// Update stock locations for product variations
adminRouter.put(
  "/:id/stock-locations",
  authenticate,
  authorize("admin", "employee", "manager", "stock.manage"),
  updateStockLocations,
);

// Transfer stock between locations
adminRouter.post(
  "/:id/stock-transfer",
  authenticate,
  authorize("admin", "employee", "manager", "stock.manage"),
  transferStockLocation,
);

// Stock Adjustment
adminRouter.post(
  "/stock-adjustment",
  authenticate,
  authorize("admin", "employee", "manager", "stock.manage"),
  stockAdjustment,
);
adminRouter.post(
  "/:id/stock-adjustment",
  authenticate,
  authorize("admin", "employee", "manager", "stock.manage"),
  stockAdjustment,
);

// Stock Movement Audit Logs
adminRouter.get(
  "/stock-movements",
  authenticate,
  authorize("admin", "employee", "manager", "stock.manage", "inventory.view"),
  getStockMovements,
);

// @desc    Get related products by sub-category
// @route   GET /api/product/related/subcategory/:subCategoryId
// @access  Public - optional auth for price filtering
publicRouter.get(
  "/related/subcategory/:subCategoryId",
  optionalAuth,
  getRelatedProducts,
);

// Get Product by ID (Public - optional auth to filter admin access)
publicRouter.get("/:id", optionalAuth, getProductById);

// Update Product (Employee, Admin, Manager)
// Uses productUpload.any() to accept dynamic per-variation image fields
adminRouter.put(
  "/:id",
  authenticate,
  authorize("admin", "employee", "manager", "products.edit"),
  productUpload.any(),
  validateUpdateProduct,
  updateProduct,
);

// Delete Product (Admin only, permanent delete)
adminRouter.delete(
  "/:id",
  authenticate,
  authorize("admin", "products.delete"), // Admin or users with products.delete permission
  validateProductId,
  deleteProduct,
);

module.exports = { publicRouter, adminRouter };
