/**
 * ============================================================
 * middleware/validation.js — Request Validation Handler
 * ============================================================
 * এই middleware express-validator এর validation result পরীক্ষা করে।
 *
 * কাজের ধারা:
 *  1. Route এ validation rules define করা হয় (validations/ folder এ)
 *  2. Route handler এ handleValidation middleware add করা হয়
 *  3. handleValidation validation errors থাকলে 400 response পাঠায়
 *  4. Validation error হলে আপলোড করা ছবি Cloudinary থেকে মুছে ফেলা হয়
 *  5. Validation pass হলে next() দিয়ে controller এ চলে যায়
 *
 * ব্যবহারের উদাহরণ (route এ):
 *   router.post("/", categoryUpload.single("image"), categoryValidation, handleValidation, createCategory);
 *
 * Error response format:
 *   { success: false, message: "Validation failed", errors: [{ field, message, value }] }
 * ============================================================
 */

const { validationResult } = require("express-validator");
const {
  extractPublicIdFromUrl,
  deleteImageFromCloudinary,
} = require("../config/cloudinary");

/**
 * handleValidation — express-validator validation result check করে
 * যদি error থাকে → uploaded image মুছে দেয় এবং 400 response পাঠায়
 * যদি error না থাকে → next() call করে controller এ পাঠায়
 */
const handleValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    // Validation fail হলে upload হওয়া ছবি Cloudinary থেকে মুছে ফেলা হয়
    // এতে Cloudinary তে garbage images জমা হবে না
    if (req.file && req.file.path) {
      const publicId = extractPublicIdFromUrl(req.file.path);
      if (publicId) {
        deleteImageFromCloudinary(publicId); // async delete, await করার দরকার নেই
      }
    }
    const errArray = errors.array();
    const firstMsg = errArray[0]?.msg || "Validation failed";

    return res.status(400).json({
      success: false,
      message: firstMsg,
      errors: errArray.map((error) => ({
        field: error.path || error.param, // কোন field এ error
        message: error.msg, // error message
        value: error.value, // যে value দেওয়া হয়েছে
      })),
    });
  }
  next(); // সব validation pass — controller এ যাও
};

module.exports = {
  handleValidation,
};
