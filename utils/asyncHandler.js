/**
 * ============================================================
 * utils/asyncHandler.js — Async Error Handler Wrapper
 * ============================================================
 * এই utility function টি async controller function গুলোকে wrap করে।
 *
 * সমস্যা:
 *  Express নিজে async function এর error automatically catch করে না।
 *  তাই প্রতিটি controller এ try-catch লিখতে হতো।
 *
 * সমাধান:
 *  asyncHandler() দিয়ে controller wrap করলে,
 *  যেকোনো async error automatically next(error) হয়ে
 *  errorHandler middleware এ চলে যায়।
 *
 * ব্যবহারের উদাহরণ:
 *   const createCategory = asyncHandler(async (req, res) => {
 *     // এখানে throw করলে বা await fail করলে
 *     // errorHandler middleware handle করবে
 *   });
 *
 * @param {Function} fn - async controller function
 * @returns {Function} Express middleware function
 * ============================================================
 */
const asyncHandler = (fn) => (req, res, next) => {
  // fn() return করা Promise resolve হলে সব ঠিক আছে
  // reject হলে (error throw) → next(error) → errorHandler middleware
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;
