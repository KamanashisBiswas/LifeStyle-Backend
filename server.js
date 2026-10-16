/**
 * ============================================================
 * server.js — Application Entry Point
 * ============================================================
 * এটি পুরো backend এর মূল ফাইল।
 * এখানে Express অ্যাপ তৈরি হয়, সব middleware এবং route যুক্ত হয়,
 * এবং সার্ভার চালু হয়।
 *
 * কাজের ধারা:
 *  1. MongoDB database এ সংযোগ (connectDB)
 *  2. CORS policy সেট করে কোন কোন frontend থেকে request আসতে পারবে
 *  3. JSON ও URL-encoded body parse করার middleware যুক্ত
 *  4. সবগুলো route /api prefix দিয়ে register করা হয়
 *  5. Health check endpoint — সার্ভার চলছে কিনা তা যাচাই করতে
 *  6. Global error handler সবার শেষে add করা হয়
 * ============================================================
 */

const express = require("express");
const cors = require("cors");
require("dotenv").config(); // .env ফাইল থেকে environment variable লোড করে
const dns = require("dns");

// Change DNS
dns.setServers(["1.1.1.1", "8.8.8.8"]);

// ─── Config & Middleware imports ──────────────────────────────────────────────
const connectDB = require("./config/database"); // MongoDB connection
const errorHandler = require("./middleware/errorHandler"); // Global error handler

// ─── Route imports ─────────────────────────────────────────────────────────────
const authRoutes = require("./routes/auth"); // Admin/Employee লগইন ও রেজিস্ট্রেশন
const customerAuthRoutes = require("./routes/customerAuth"); // Customer লগইন ও রেজিস্ট্রেশন (OTP)
const userRoutes = require("./routes/user"); // User profile ও password management
const categoryRoutes = require("./routes/category"); // পণ্যের ক্যাটাগরি CRUD
const subCategoryRoutes = require("./routes/subCategory"); // পণ্যের সাব-ক্যাটাগরি CRUD
const brandRoutes = require("./routes/brand"); // ব্র্যান্ড CRUD
const colorRoutes = require("./routes/color"); // কালার CRUD
const productRoutes = require("./routes/product"); // পণ্য CRUD ও সার্চ/ফিল্টার
const offerRoutes = require("./routes/offer"); // New Offer Management module
const offerDealRoutes = require("./routes/offerDeal"); // অফার ও ডিল ম্যানেজমেন্ট
const couponRoutes = require("./routes/coupon"); // কুপন কোড ম্যানেজমেন্ট
const loginImageRoutes = require("./routes/loginImage"); // লগইন পেজের ব্যাকগ্রাউন্ড ইমেজ
const carouselRoutes = require("./routes/carousel"); // হোম পেজ মেইন Carousel banner
const carouselRightRoutes = require("./routes/carouselRight"); // হোম পেজ ডান পাশের Carousel banner
const orderRoutes = require("./routes/order"); // Customer অর্ডার ম্যানেজমেন্ট
const vendorRoutes = require("./routes/vendor"); // সাপ্লাইয়ার/ভেন্ডর ম্যানেজমেন্ট
const barcodeRoutes = require("./routes/barcode"); // পণ্যের বারকোড জেনারেশন
const salesRoutes = require("./routes/sales"); // কাউন্টার সেলস (POS)
const returnRoutes = require("./routes/return"); // পণ্য রিটার্ন ম্যানেজমেন্ট
const statsRoutes = require("./routes/stats"); // ড্যাশবোর্ড স্ট্যাটাস ও ওভারভিউ
const reviewRoutes = require("./routes/review"); // কাস্টমার রিভিউ ও রেটিং

const app = express();

app.use(
  cors({
    origin: function (origin, callback) {
      const allowedOrigins = [
        "https://shoppersperklifestyle.com", // Production — Customer website
        "https://admin.shoppersperklifestyle.com", // Production — Admin dashboard
        "http://localhost:5173", // Local development — Customer frontend
        "http://localhost:5174", // Local development — Admin frontend
        "https://zesty-palmier-df47b8.netlify.app", // Netlify — Customer frontend staging
        "https://frolicking-hotteok-d8cb7b.netlify.app", // Netlify — Admin frontend staging
        process.env.CORS_ORIGIN, // .env থেকে extra origin (optional)
      ].filter(Boolean);

      // Mobile app, curl, Postman — zero origin header
      if (!origin) return callback(null, true);

      // Allow listed origins or any Vercel domain preview
      if (allowedOrigins.includes(origin) || origin.endsWith(".vercel.app")) {
        return callback(null, true);
      } else {
        return callback(null, false);
      }
    },
    credentials: true,
    optionsSuccessStatus: 200,
  }),
);

// ─── Database Auto-Connection Middleware for Vercel Serverless ────────────────
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error("Database connection middleware error:", err);
    next(err);
  }
});

// ─── Body Parser Middleware ─────────────────────────────────────────────────────
// Request body parse করার জন্য। limit: "10mb" — বড় ছবি base64 আকারে পাঠাতে পারবে
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true })); // HTML form data parse করে

// ─── API Routes ─────────────────────────────────────────────────────────────────
// প্রতিটি route এর prefix /api দিয়ে শুরু যাতে সব API endpoint আলাদা ভাবে চেনা যায়

app.use("/api/auth", authRoutes); // POST /api/auth/register, /api/auth/login, /api/auth/refresh, /api/auth/logout
app.use("/api/user", userRoutes.publicRouter); // User profile update, password change

// Public API Routes (For Customer Website)
app.use("/api/customer", customerAuthRoutes.publicRouter);
app.use("/api/category", categoryRoutes.publicRouter);
app.use("/api/subcategory", subCategoryRoutes.publicRouter);
app.use("/api/brand", brandRoutes.publicRouter);
app.use("/api/color", colorRoutes.publicRouter);
app.use("/api/product", productRoutes.publicRouter);
app.use("/api/offer", offerRoutes.publicRouter);
app.use("/api/offer-deals", offerDealRoutes.publicRouter);
app.use("/api/coupon", couponRoutes.publicRouter);
app.use("/api/login-image", loginImageRoutes.publicRouter);
app.use("/api/carousel", carouselRoutes.publicRouter);
app.use("/api/carousel-right", carouselRightRoutes.publicRouter);
app.use("/api/order", orderRoutes.publicRouter);
app.use("/api/returns", returnRoutes.publicRouter);
app.use("/api/header", require("./routes/header").publicRouter);
app.use("/api/headline", require("./routes/headline").publicRouter);
app.use("/api/review", reviewRoutes.publicRouter);

// Admin / Dashboard API Routes
app.use("/api/admin/customer", customerAuthRoutes.adminRouter);
app.use("/api/admin/category", categoryRoutes.adminRouter);
app.use("/api/admin/subcategory", subCategoryRoutes.adminRouter);
app.use("/api/admin/brand", brandRoutes.adminRouter);
app.use("/api/admin/color", colorRoutes.adminRouter);
app.use("/api/admin/user", userRoutes.adminRouter);
app.use("/api/admin/product", productRoutes.adminRouter);
app.use("/api/admin/review", reviewRoutes.adminRouter);
app.use("/api/admin/offer", offerRoutes.adminRouter);
app.use("/api/admin/offer-deals", offerDealRoutes.adminRouter);
app.use("/api/admin/coupon", couponRoutes.adminRouter);
app.use("/api/admin/login-image", loginImageRoutes.adminRouter);
app.use("/api/admin/carousel", carouselRoutes.adminRouter);
app.use("/api/admin/carousel-right", carouselRightRoutes.adminRouter);
app.use("/api/admin/order", orderRoutes.adminRouter);
app.use("/api/admin/pathao", require("./routes/pathao"));
app.use("/api/admin/returns", returnRoutes.adminRouter);
app.use("/api/admin/header", require("./routes/header").adminRouter);
app.use("/api/admin/headline", require("./routes/headline").adminRouter);
const activityLogRoutes = require("./routes/activityLog");
app.use("/api/admin/activity-logs", activityLogRoutes);
app.use("/api/admin/vendor", vendorRoutes);
app.use("/api/admin/barcode", barcodeRoutes);
app.use("/api/admin/sales", salesRoutes);
app.use("/api/sales", salesRoutes);
app.use("/api/admin/dashboard", statsRoutes);
app.use("/api/admin/reports", require("./routes/report"));
app.use("/api/admin/daily-overview", require("./routes/dailyOverview"));
app.use("/api/expense", require("./routes/expense"));
app.use("/api/admin/expense", require("./routes/expense"));
app.use("/api/admin-expense", require("./routes/adminExpense"));
app.use("/api/admin/admin-expense", require("./routes/adminExpense"));
app.use("/api/owner-payout", require("./routes/ownerPayout"));
app.use("/api/admin/owner-payout", require("./routes/ownerPayout"));
app.use("/api/purchase", require("./routes/purchase"));
app.use("/api/admin/purchase", require("./routes/purchase"));
app.use("/api/exchange", require("./routes/exchange"));
app.use("/api/admin/exchange", require("./routes/exchange"));
app.use("/api/vendor-return", require("./routes/vendorReturn"));
app.use("/api/admin/vendor-return", require("./routes/vendorReturn"));
app.use("/api/new-arrival", require("./routes/newArrivalRoutes"));
app.use("/api/hrm/leave", require("./routes/leave"));
app.use("/api/admin/hrm/leave", require("./routes/leave"));
app.use("/api/admin/sales-targets", require("./routes/salesTarget"));
app.use("/api/admin/product-requests", require("./routes/productRequest"));
app.use("/api/attendance", require("./routes/attendance"));
app.use("/api/shop-documents", require("./routes/shopDocument"));
app.use("/api/admin/shop-documents", require("./routes/shopDocument"));
app.use("/api/inventory-audit", require("./routes/inventoryAudit"));
app.use("/api/admin/inventory-audit", require("./routes/inventoryAudit"));
app.use("/api/admin/roles", require("./routes/role"));
app.use("/api/roles", require("./routes/role"));

// Root route (GET /) for health & status check
app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "ShoppersPerk LifeStyle Backend API is active and running",
    timestamp: new Date().toISOString(),
  });
});

// ─── Health Check ───────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Server is running",
    timestamp: new Date().toISOString(),
  });
});

// ─── Global Error Handler ────────────────────────────────────────────────────────
app.use(errorHandler);

// ─── Server Startup (Local Development) ───────────────────────────────────────
if (process.env.NODE_ENV !== "production" || !process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  connectDB().then(() => {
    const seedRoles = require("./utils/seedRoles");
    seedRoles().catch((e) => console.error("Seed roles error:", e));
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
    });
  }).catch((err) => {
    console.error("❌ Failed to start local server:", err);
  });
}

// Export Express app for Vercel Serverless Functions
module.exports = app;
