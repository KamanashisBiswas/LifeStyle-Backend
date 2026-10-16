/**
 * ============================================================
 * config/cloudinary.js — Cloudinary Image Upload Configuration
 * ============================================================
 * এই ফাইলে সব ধরনের ছবি আপলোড এর জন্য Cloudinary ও Multer সেটআপ করা হয়েছে।
 *
 * Cloudinary কী?
 *  → একটি cloud-based ইমেজ ও ভিডিও storage সার্ভিস।
 *  → ছবি upload করলে একটি URL পাওয়া যায় যা database এ save করা হয়।
 *
 * Multer কী?
 *  → Node.js এ file upload handle করার middleware।
 *  → HTTP request এর multipart/form-data থেকে file নেয় এবং Cloudinary তে পাঠায়।
 *
 * এখানে কোন কোন ধরনের upload আছে:
 *  - profileUpload      → User এর profile ছবি (lifestyle/profile-images)
 *  - categoryUpload     → Category এর ছবি (lifestyle/categories)
 *  - subCategoryUpload  → SubCategory এর ছবি (lifestyle/subcategories)
 *  - brandUpload        → Brand এর ছবি (lifestyle/brands)
 *  - productUpload      → Product এর ছবি (lifestyle/products)
 *  - offerDealUpload    → Offer/Deal এর ছবি (lifestyle/offer-deals)
 *  - loginImageMemoryUpload → Login page background (memory storage, manually upload)
 *
 * Helper functions:
 *  - deleteImageFromCloudinary(publicId) → Cloudinary থেকে ছবি মুছে ফেলে
 *  - extractPublicIdFromUrl(url)         → Cloudinary URL থেকে public_id বের করে
 *
 * .env এ দরকারি variables:
 *  CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
 * ============================================================
 */

const cloudinary = require("cloudinary").v2;
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const multer = require("multer");

// ─── Cloudinary Configuration ─────────────────────────────────────────────────
// .env থেকে Cloudinary API credentials নেয়া হচ্ছে
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ─── Configure storage for profile images ────────────────────────────────────
// User এর profile ছবি এখানে আপলোড হয়। Folder: lifestyle/profile-images
// File name: profile_{userId}_{timestamp} — unique রাখার জন্য
const profileStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "lifestyle/profile-images", // Separate folder for profile images
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
    transformation: [
      {
        quality: "auto",
        fetch_format: "auto",
      },
    ],
    public_id: (req, file) => {
      // Generate unique filename with user ID and timestamp
      return `profile_${req.user.id}_${Date.now()}`;
    },
  },
});

// Multer configuration for profile images
const profileUpload = multer({
  storage: profileStorage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    // Check if file is an image
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed!"), false);
    }
  },
});

// Configure storage for category images
const categoryStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "lifestyle/categories", // Separate folder for category images
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
    transformation: [
      {
        quality: "auto",
        fetch_format: "auto",
      },
    ],
    public_id: (req, file) => {
      // Sanitize the category name if provided
      let name = "category";

      try {
        if (req.body && req.body.name && typeof req.body.name === "string") {
          name = req.body.name
            .toString()
            .toLowerCase()
            .replace(/&/g, "and")
            .replace(/\s+/g, "_")
            .replace(/[^\w-]+/g, "");
        }
      } catch (error) {
        console.log("Error processing category name for public_id:", error);
        name = "category";
      }

      // Always add timestamp for uniqueness
      const timestamp = Date.now();
      return `category_${name || "item"}_${timestamp}`;
    },
  },
});

// Multer configuration for category images
const categoryUpload = multer({
  storage: categoryStorage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed!"), false);
    }
  },
});

// Configure storage for sub category images
const subCategoryStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "lifestyle/subcategories", // Separate folder for subcategory images
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
    transformation: [
      {
        quality: "auto",
        fetch_format: "auto",
      },
    ],
    public_id: (req, file) => {
      // Sanitize the subcategory name if provided
      let name = "subcategory";

      try {
        if (req.body && req.body.name && typeof req.body.name === "string") {
          name = req.body.name
            .toString()
            .toLowerCase()
            .replace(/&/g, "and")
            .replace(/\s+/g, "_")
            .replace(/[^\w-]+/g, "");
        }
      } catch (error) {
        console.log("Error processing subcategory name for public_id:", error);
        name = "subcategory";
      }

      // Always add timestamp for uniqueness
      const timestamp = Date.now();
      return `subcategory_${name || "item"}_${timestamp}`;
    },
  },
});

// Multer configuration for sub category images
const subCategoryUpload = multer({
  storage: subCategoryStorage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed!"), false);
    }
  },
});

// Brand image storage
const brandStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "lifestyle/brands", // Brand images will go here
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
    transformation: [
      {
        quality: "auto",
        fetch_format: "auto",
      },
    ],
    public_id: (req, file) => {
      // Sanitize the brand name if provided
      let name = "brand";
      try {
        if (req.body && req.body.name && typeof req.body.name === "string") {
          name = req.body.name
            .toString()
            .toLowerCase()
            .replace(/&/g, "and")
            .replace(/\s+/g, "_")
            .replace(/[^\w-]+/g, "");
        }
      } catch (error) {
        name = "brand";
      }
      const timestamp = Date.now();
      return `brand_${name || "item"}_${timestamp}`;
    },
  },
});

const brandUpload = multer({
  storage: brandStorage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed!"), false);
    }
  },
});

// Configure storage for product images
const productStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "lifestyle/products",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
    transformation: [
      {
        quality: "auto",
        fetch_format: "auto",
      },
    ],
    public_id: (req, file) => {
      const timestamp = Date.now();
      const random = Math.floor(Math.random() * 10000);
      return `product_${timestamp}_${random}`;
    },
  },
});

const productUpload = multer({
  storage: productStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed!"), false);
  },
});

// ─── Delete Image from Cloudinary ───────────────────────────────────────────
/**
 * deleteImageFromCloudinary — Cloudinary থেকে ছবি মুছে ফেলে
 * @param {string} publicId - Cloudinary image এর public_id (extractPublicIdFromUrl() দিয়ে বের করা)
 * @returns {object} Cloudinary API response
 */
const deleteImageFromCloudinary = async (publicId) => {
  if (!publicId) return { result: "not found" };
  try {
    const cleanId = publicId.trim();
    console.log("Attempting to delete image with public_id:", cleanId);

    // 1. Primary method: uploader.destroy (Same as Category, Brand, Subcategory)
    let result = await cloudinary.uploader.destroy(cleanId, {
      invalidate: true,
    });
    console.log("Cloudinary uploader.destroy result:", result);

    if (result.result === "ok") {
      console.log("Image successfully deleted from Cloudinary via uploader.destroy");
      return result;
    }

    // 2. Admin API fallback (delete_resources)
    try {
      const apiResult = await cloudinary.api.delete_resources([cleanId], {
        invalidate: true,
      });
      console.log("Cloudinary Admin API delete result:", apiResult);
      if (
        apiResult.deleted &&
        (apiResult.deleted[cleanId] === "deleted" ||
          apiResult.deleted[cleanId] === "ok")
      ) {
        console.log("Image successfully deleted from Cloudinary via Admin API");
        return { result: "ok" };
      }
    } catch (apiErr) {
      console.log("Admin API attempt failed:", apiErr.message);
    }

    // 3. Alt candidates retry for legacy public IDs with extension embedded
    const candidates = [];
    const baseId = cleanId.replace(/\.(png|jpg|jpeg|webp)$/i, "");
    if (baseId && baseId !== cleanId) candidates.push(baseId);

    if (cleanId.includes(".")) {
      const lastDot = cleanId.lastIndexOf(".");
      const ext = cleanId.substring(lastDot + 1);
      const nameNoExt = cleanId.substring(0, lastDot);
      candidates.push(`${nameNoExt}${ext}`);
      candidates.push(`${nameNoExt}_${ext}`);
    }

    for (const altId of candidates) {
      try {
        const altResult = await cloudinary.uploader.destroy(altId, {
          invalidate: true,
        });
        if (altResult.result === "ok") {
          console.log(`Image successfully deleted using altId: "${altId}"`);
          return altResult;
        }
      } catch {
        // ignore
      }
    }

    console.log("Image not found in Cloudinary (may have been deleted already)");
    return { result: "not found" };
  } catch (error) {
    console.error("Error deleting image from Cloudinary:", error);
    return { result: "not found" };
  }
};

// ─── Extract Public ID from Cloudinary URL ───────────────────────────────────
/**
 * extractPublicIdFromUrl — Cloudinary URL থেকে public_id বের করে
 * @param {string} url - Cloudinary image URL
 * @returns {string|null} public_id অথবা null যদি URL invalid হয়
 */
const extractPublicIdFromUrl = (url) => {
  if (!url || typeof url !== "string") return null;
  try {
    const cleanUrl = url.split("?")[0].split("#")[0];
    const decodedUrl = decodeURIComponent(cleanUrl);

    // Find the position where the version ends (after /v followed by numbers/)
    const versionRegex = /\/v\d+\//;
    const versionMatch = decodedUrl.match(versionRegex);

    let afterVersion = "";
    if (versionMatch) {
      afterVersion = decodedUrl.substring(
        decodedUrl.indexOf(versionMatch[0]) + versionMatch[0].length,
      );
    } else if (decodedUrl.includes("/upload/")) {
      const parts = decodedUrl.split("/upload/")[1];
      if (parts) {
        const segments = parts.split("/").filter((s) => !/^v\d+$/.test(s) && !/^(c_|w_|h_|q_|f_|b_|e_|o_|r_|a_|fl_|g_|,)/.test(s) && !s.includes(","));
        afterVersion = segments.join("/");
      }
    }

    if (!afterVersion) return null;

    // Remove the file extension (.jpg, .png, etc.) — EXACTLY as in Category/Brand
    const publicId = afterVersion.replace(/\.[^/.]+$/, "");

    console.log("Extracted public_id:", publicId);
    return publicId;
  } catch (error) {
    console.error("Error extracting public_id from URL:", error);
    return null;
  }
};

// Configure storage for offer deal images
const offerDealStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "lifestyle/offer-deals",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
    transformation: [
      {
        width: 800,
        height: 450,
        crop: "fill",
        quality: "auto",
        fetch_format: "auto",
      },
    ],
    public_id: (req, file) => {
      const timestamp = Date.now();
      return `offer_deal_${timestamp}_${file.originalname.replace(
        /\s+/g,
        "_",
      )}`;
    },
  },
});

const offerDealUpload = multer({
  storage: offerDealStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed!"), false);
  },
});

// ─── Login Image Memory Upload ───────────────────────────────────────────────
// Login page background image আপলোডের জন্য memory storage ব্যবহার করা হচ্ছে।
// এখানে file disk এ বা Cloudinary তে সরাসরি যায় না — buffer হিসেবে RAM এ রাখা হয়।
// Controller নিজে buffer থেকে Cloudinary তে upload করে (stream method)।
const loginImageMemoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed!"), false);
  },
});

// Configure storage for offer campaign banner images
const offerBannerStorage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: "lifestyle/offers",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
    transformation: [
      {
        quality: "auto",
        fetch_format: "auto",
      },
    ],
    public_id: (req, file) => {
      const timestamp = Date.now();
      const random = Math.floor(Math.random() * 10000);
      return `offer_banner_${timestamp}_${random}`;
    },
  },
});

const offerBannerUpload = multer({
  storage: offerBannerStorage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB limit for high-res banners
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed!"), false);
  },
});

// ─── Module Exports ───────────────────────────────────────────────────────────
// এই সব export করা হয় যাতে routes/controllers থেকে multer middleware ব্যবহার করা যায়
module.exports = {
  cloudinary, // Cloudinary SDK instance — carousel controller এ সরাসরি ব্যবহার হয়
  profileUpload, // User profile ছবি upload middleware
  categoryUpload, // Category ছবি upload middleware
  subCategoryUpload, // SubCategory ছবি upload middleware
  brandUpload, // Brand ছবি upload middleware
  productUpload, // Product ছবি upload middleware (multiple fields)
  offerDealUpload, // Offer/Deal ছবি upload middleware
  offerBannerUpload, // Offer campaign banner images upload middleware
  deleteImageFromCloudinary, // Cloudinary থেকে ছবি delete করার helper function
  extractPublicIdFromUrl, // Cloudinary URL থেকে public_id বের করার helper function
  loginImageMemoryUpload, // Login page background ছবি upload middleware (memory buffer)
};
