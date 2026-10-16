/**
 * ============================================================
 * utils/customIdGenerator.js — Custom Sequential ID Generator
 * ============================================================
 * এই utility function sequential custom ID তৈরি করে।
 *
 * উদাহরণ output:
 *  'CAT-00001', 'BRD-00002', 'PRD-00005'
 *
 * বিশেষত্ব (Gap Filling):
 *  → যদি কোনো record মুছে ফেলা হয়, সেই gap এর number আবার ব্যবহার করা হয়।
 *  → Example: CAT-00001, CAT-00002, CAT-00004 আছে।
 *             CAT-00003 মুছে ফেলা হলে পরের new ID হবে CAT-00003 (gap fill)
 *
 * Counter model:
 *  → MongoDB তে Counter collection আছে যা current sequence track করে
 *
 * কোথায় ব্যবহার হয়:
 *  - Product model এর pre-save hook এ (PRD-)
 *  - Customer model এর pre-save hook এ (CUS-)
 *  - OfferDeal controller এ (OFD-)
 *  - অন্যান্য controller গুলো সরাসরি কাউন্ট থেকে ID তৈরি করে
 * ============================================================
 */

const Counter = require("../models/Counter");

/**
 * generateCustomId — Sequential custom ID তৈরি করে (gap filling সহ)
 * @param {string} prefix - ID এর prefix (যেমন: 'PRD', 'CAT', 'CUS')
 * @param {Model} model - Mongoose model (যেমন: Product, Category)
 * @param {string} idField - custom ID এর field name (যেমন: 'productId', 'categoryId')
 * @param {string} counterId - Counter collection এর document ID (যেমন: 'Product')
 * @returns {Promise<string>} Generated ID (যেমন: 'PRD-00001')
 */
const generateCustomId = async (prefix, model, idField, counterId) => {
  // Get all existing serials from DB
  const docs = await model.find({}, { [idField]: 1, _id: 0 });
  const serials = docs
    .map((doc) => {
      const parts = doc[idField]?.split("-");
      return parts && parts[1] ? parseInt(parts[1], 10) : null;
    })
    .filter((num) => num !== null)
    .sort((a, b) => a - b);

  // Find first missing serial (gap)
  let nextSerial = 1;
  for (let i = 0; i < serials.length; i++) {
    if (serials[i] !== i + 1) {
      nextSerial = i + 1;
      break;
    }
    nextSerial = serials.length + 1;
  }

  // Update counter collection
  await Counter.findByIdAndUpdate(
    counterId,
    { seq: nextSerial },
    { upsert: true },
  );

  // Pad the sequence number with leading zeros to a fixed length of 5
  const paddedSeq = String(nextSerial).padStart(5, "0");
  return `${prefix}-${paddedSeq}`;
};

module.exports = { generateCustomId };
