/**
 * ============================================================
 * utils/jwt.js — JSON Web Token (JWT) Utilities
 * ============================================================
 * এই ফাইলে JWT token তৈরি, verify এবং extract করার সব function আছে।
 *
 * JWT কী?
 *  → JSON Web Token — user authentication এর জন্য ব্যবহৃত encrypted token।
 *  → Client login করলে token পায়, পরবর্তী request এ এই token পাঠায়।
 *  → Server token verify করে user কে চেনে।
 *
 * Token এর ধরন:
 *  1. accessToken  → স্বল্পমেয়াদী (JWT_EXPIRE .env থেকে, যেমন: 1d)
 *                   → প্রতিটি protected request এ পাঠাতে হয়
 *  2. refreshToken → দীর্ঘমেয়াদী (JWT_REFRESH_EXPIRE .env থেকে, যেমন: 30d)
 *                   → accessToken মেয়াদ শেষ হলে নতুন accessToken নিতে ব্যবহার হয়
 *
 * .env এ দরকারি variables:
 *  JWT_SECRET, JWT_EXPIRE, JWT_REFRESH_EXPIRE
 * ============================================================
 */

const jwt = require("jsonwebtoken");

// .env থেকে token expiry সময় নেওয়া হচ্ছে
const ACCESS_TOKEN_EXPIRE = process.env.JWT_EXPIRE;
const REFRESH_TOKEN_EXPIRE = process.env.JWT_REFRESH_EXPIRE;

/**
 * generateAccessToken — স্বল্পমেয়াদী access token তৈরি করে
 * Payload এ user id, email ও role থাকে
 * @param {string} id - MongoDB User _id
 * @param {string} email - User email
 * @param {string} role - User role (admin/manager/employee)
 */
function generateAccessToken(id, email, role) {
  return jwt.sign({ id, email, role }, process.env.JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRE,
  });
}

/**
 * generateRefreshToken — দীর্ঘমেয়াদী refresh token তৈরি করে
 * Payload এ শুধু user id থাকে
 * Database এ সেভ করা হয় এবং নতুন accessToken নেওয়ার জন্য ব্যবহার হয়
 * @param {string} id - MongoDB User _id
 */
function generateRefreshToken(id) {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: REFRESH_TOKEN_EXPIRE,
  });
}

/**
 * generateTokenPair — accessToken ও refreshToken একসাথে তৈরি করে
 * Login এ এই function ব্যবহার করা হয়
 * @returns {{ accessToken: string, refreshToken: string }}
 */
function generateTokenPair(id, email, role) {
  return {
    accessToken: generateAccessToken(id, email, role),
    refreshToken: generateRefreshToken(id),
  };
}

/**
 * verifyToken — JWT token verify করে decoded payload return করে
 * Token invalid বা expired হলে error throw করে
 * auth middleware এ ব্যবহার হয়
 * @param {string} token - JWT token string
 * @returns {object} decoded payload { id, email, role }
 */
function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

/**
 * extractBearerToken — Authorization header থেকে token বের করে
 * Header format: "Bearer <token>"
 * @param {string} header - Authorization header value
 * @returns {string|null} token string অথবা null
 */
function extractBearerToken(header) {
  if (!header) return null;
  const parts = header.split(" ");
  if (parts.length === 2 && /^Bearer$/i.test(parts[0])) {
    return parts[1];
  }
  return null;
}

/**
 * generateToken — Customer এর জন্য simple token তৈরি করে (7 দিন মেয়াদী)
 * Backward compatibility এর জন্য রাখা হয়েছে — customerAuthController ব্যবহার করে
 * @param {object} user - Customer document
 */
// Backward compatibility (customerAuthController still calling as a function)
function generateToken(user) {
  return jwt.sign(
    { id: user._id, isAdmin: user.isAdmin },
    process.env.JWT_SECRET,
    { expiresIn: "7d" },
  );
}

module.exports = {
  generateTokenPair, // Admin/Employee login এ ব্যবহার — accessToken + refreshToken
  verifyToken, // auth middleware এ token verify করতে ব্যবহার
  extractBearerToken, // Authorization header থেকে token বের করতে
  generateToken, // Customer login এ ব্যবহার (simple 7d token)
};
