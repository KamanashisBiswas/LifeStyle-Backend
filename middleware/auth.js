/**
 * ============================================================
 * middleware/auth.js — Authentication & Authorization Middleware
 * ============================================================
 * এই ফাইলে তিনটি গুরুত্বপূর্ণ middleware আছে:
 *
 *  1. authenticate(req, res, next)
 *     → Admin/Employee এর JWT token verify করে।
 *     → Token valid হলে req.user এ user info যুক্ত করে।
 *     → Admin dashboard এর protected routes এ ব্যবহার হয়।
 *
 *  2. authenticateCustomer(req, res, next)
 *     → Customer অথবা Admin/Employee — যেকোনো একজনের token verify করে।
 *     → Customer হলে → req.customer এ info যুক্ত করে।
 *     → Admin/Employee হলে → req.user এ info যুক্ত করে।
 *     → Order, Return ইত্যাদি routes এ ব্যবহার হয়।
 *
 *  3. authorize(...roles)
 *     → authenticate() এর পরে ব্যবহার করা হয়।
 *     → নির্দিষ্ট role এর user কে access দেয়।
 *     → উদাহরণ: authorize("admin") — শুধু admin access পাবে।
 *
 *  4. optionalAuth(req, res, next)
 *     → Token থাকলে req.user set করে, না থাকলেও error দেয় না।
 *     → Public routes এ ব্যবহার হয় যেখানে logged-in user extra সুবিধা পায়।
 *
 * JWT token পাঠানোর নিয়ম:
 *   Header: Authorization: Bearer <token>
 * ============================================================
 */

const jwt = require("jsonwebtoken");
const asyncHandler = require("../utils/asyncHandler");
const Customer = require("../models/Customer");
const User = require("../models/User");
const JWTUtil = require("../utils/jwt");

// ─── authenticate — Admin/Employee JWT Verification ──────────────────────────
/**
 * authenticate — Admin ও Employee এর token verify করে
 * Token valid হলে req.user = { id, email, role, name } সেট করে
 * Protected admin routes এ ব্যবহার হয়
 */
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.header("Authorization");
    const token = JWTUtil.extractBearerToken(authHeader);

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Access denied. No token provided.",
      });
    }

    // Verify token
    const decoded = JWTUtil.verifyToken(token);

    // Get user from database
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Token is invalid. User not found.",
      });
    }

    // Add user info to request object with dynamic permissions
    const { getEffectivePermissionsForUser } = require("../controllers/roleController");
    const permissions = await getEffectivePermissionsForUser(user);

    req.user = {
      _id: user._id,
      id: user._id,
      email: user.email,
      role: user.role,
      name: user.name,
      permissions: permissions || [],
    };

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Token is invalid or expired.",
      error: error.message,
    });
  }
};

/**
 * @desc    Generic authentication middleware for both Customers and Users.
 *          This function replaces the old 'protect' and 'authenticateCustomer'.
 * @access  Private
 */
const authenticateCustomer = asyncHandler(async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    try {
      // 1. Get token from header
      token = req.headers.authorization.split(" ")[1];

      // 2. Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // 3. Find the user in Customer model first
      const customer = await Customer.findById(decoded.id).select("-password");

      if (customer) {
        // If found as a customer, attach to req.customer and proceed
        req.customer = customer;
        return next();
      }

      // 4. If not found as a customer, check in User model
      const user = await User.findById(decoded.id).select("-password");

      if (user) {
        // If found as a user, attach to req.user and proceed
        req.user = user;
        return next();
      }

      // 5. If not found in either model, deny access
      return res
        .status(401)
        .json({ message: "Not authorized, user not found" });
    } catch (error) {
      console.error("Token verification failed:", error.message);
      return res.status(401).json({ message: "Not authorized, token failed" });
    }
  }

  if (!token) {
    return res.status(401).json({ message: "Not authorized, no token" });
  }
});

// ─── authorize — Role-based Access Control ───────────────────────────────────
/**
 * authorize(...roles) — নির্দিষ্ট role এর user কে access দেয়
 * authenticate() এর পরে ব্যবহার করতে হবে
 *
 * উদাহরণ ব্যবহার (route এ):
 *   router.delete("/:id", authenticate, authorize("admin"), deleteCategory);
 *   → শুধু admin মুছতে পারবে
 *
 * @param {...string} roles - allowed roles (যেমন: "admin", "employee", "salesman")
 */
// Authorize specific roles or permission keys
const authorize = (...rolesOrPermissions) => {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Access denied. Authentication required.",
      });
    }

    // 1. Super admin always has full bypass
    if (req.user.role === "admin") {
      return next();
    }

    const items = [...rolesOrPermissions];
    const permKeys = items.filter((item) => typeof item === "string" && item.includes("."));
    const roleItems = items.filter((item) => typeof item === "string" && !item.includes("."));

    // 2. Dynamic permission check (Priority)
    const userPermissions = req.user.permissions || [];
    if (permKeys.length > 0) {
      const hasPermission = permKeys.some((p) => userPermissions.includes(p));
      if (hasPermission) {
        return next();
      }
      return res.status(403).json({
        success: false,
        message: "Access denied. Insufficient permissions.",
      });
    }

    // 3. Fallback: Role-based check only when NO permission keys are specified
    if (roleItems.includes(req.user.role)) {
      return next();
    }

    return res.status(403).json({
      success: false,
      message: "Access denied. Insufficient permissions.",
    });
  };
};

// ─── optionalAuth — Optional Authentication ──────────────────────────────────
/**
 * optionalAuth — Token থাকলে user info সেট করে, না থাকলেও চলতে দেয়
 * Public routes এ যেখানে logged-in user বিশেষ সুবিধা পেতে পারে সেখানে ব্যবহার হয়
 * Token invalid হলেও error দেয় না, শুধু req.user undefined থাকে
 */
// Optional authentication (doesn't fail if no token)
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.header("Authorization");
    const token = JWTUtil.extractBearerToken(authHeader);

    if (token) {
      const decoded = JWTUtil.verifyToken(token);
      const user = await User.findById(decoded.id);

      if (user) {
        req.user = {
          id: user._id,
          email: user.email,
          role: user.role,
          name: user.name,
        };
      }
    }

    next();
  } catch (error) {
    // Continue without authentication if token is invalid
    next();
  }
};

// ─── Module Exports ───────────────────────────────────────────────────────────
module.exports = {
  authenticate, // Admin/Employee JWT verification
  authenticateCustomer, // Customer + Admin/Employee JWT verification (dual model)
  authorize, // Role-based access control
  optionalAuth, // Optional token check (no error if missing)
};
