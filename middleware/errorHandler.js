/**
 * ============================================================
 * middleware/errorHandler.js — Global Error Handler
 * ============================================================
 * এই middleware সব unhandled error গুলো catch করে এবং
 * client কে structured JSON response পাঠায়।
 *
 * server.js এ সব route এর শেষে add করা হয়:
 *   app.use(errorHandler)
 *
 * যেসব error handle করা হয়:
 *  - CastError (invalid MongoDB ObjectId) → 404 Not Found
 *  - Duplicate key (11000) → 400 Already Exists
 *  - Mongoose ValidationError → 400 Validation failed
 *  - JsonWebTokenError → 401 Invalid token
 *  - TokenExpiredError → 401 Token expired
 *  - অন্য সব error → 500 Server Error
 *
 * Development mode এ stack trace দেখা যায়,
 * Production mode এ শুধু error message দেখা যায়।
 * ============================================================
 */

const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // Developer debugging এর জন্য console এ পুরো error দেখানো হয়
  console.error(err);

  // ─── Mongoose: Invalid ObjectId ───────────────────────────────────────────
  // MongoDB তে ভুল format এর ID দিয়ে query করলে CastError হয়
  // উদাহরণ: /api/product/invalid-id — এটা valid ObjectId না
  if (err.name === "CastError") {
    const message = "Resource not found";
    error = {
      message,
      statusCode: 404,
    };
  }

  // ─── Mongoose: Duplicate Key Error ────────────────────────────────────────
  // Unique field এ duplicate value insert করলে এই error হয়
  // উদাহরণ: একই email দিয়ে দুটো account create করার চেষ্টা
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    const message = `${
      field.charAt(0).toUpperCase() + field.slice(1)
    } already exists`;
    error = {
      message,
      statusCode: 400,
    };
  }

  // ─── Mongoose: Validation Error ───────────────────────────────────────────
  // Schema validation fail হলে এই error হয়
  // উদাহরণ: required field missing, maxlength exceed করা ইত্যাদি
  if (err.name === "ValidationError") {
    const message = Object.values(err.errors)
      .map((val) => val.message)
      .join(", ");
    error = {
      message,
      statusCode: 400,
    };
  }

  // ─── JWT: Invalid Token ────────────────────────────────────────────────────
  // Token tamper করা হলে বা ভুল format এ পাঠালে এই error হয়
  if (err.name === "JsonWebTokenError") {
    const message = "Invalid token";
    error = {
      message,
      statusCode: 401,
    };
  }

  // ─── JWT: Expired Token ────────────────────────────────────────────────────
  // Token এর মেয়াদ শেষ হলে এই error হয় — client কে নতুন token নিতে হবে
  if (err.name === "TokenExpiredError") {
    const message = "Token expired";
    error = {
      message,
      statusCode: 401,
    };
  }

  // ─── Final Response ────────────────────────────────────────────────────────
  // statusCode না থাকলে 500 (Internal Server Error) পাঠানো হয়
  // Development mode এ stack trace দেখানো হয় debugging এর জন্য
  res.status(error.statusCode || 500).json({
    success: false,
    message: error.message || "Server Error",
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
};

module.exports = errorHandler;
