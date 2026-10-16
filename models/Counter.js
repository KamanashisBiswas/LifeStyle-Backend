/**
 * ============================================================
 * models/Counter.js — Sequential ID Counter Model
 * ============================================================
 * প্রতিটি model ঊর বর্তমান sequence number সাভ করে রাখে।
 * customIdGenerator.js এই model ব্যবহার করে ID track করতে।
 *
 * উদাহরণ document:
 *  { _id: "Category", seq: 5 }  → মানে Category ঊর বর্তমান counter = 5
 *
 * সতর্ক থাকুন:
 *  এই collection সরাসরি edit করলে ID generation break হতে পারে।
 * ============================================================
 */

const mongoose = require("mongoose");

// Counter schema — _id = model name, seq = current sequence number
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // Model name, e.g., 'Variation', 'Category'
  seq: { type: Number, default: 0 },
});

module.exports = mongoose.model("Counter", counterSchema);
