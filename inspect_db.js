const mongoose = require("mongoose");
require("dotenv").config();

const Order = require("./models/Order");
const Product = require("./models/Product");

async function check() {
  await mongoose.connect(process.env.MONGODB_URI);

  const product = await Product.findOne({ productId: "PRD-00233" }).lean();
  const prodIdStr = String(product._id);
  const prodObjId = new mongoose.Types.ObjectId(prodIdStr);

  const rawDb = mongoose.connection.db;
  const anyOrderRaw = await rawDb.collection("orders").findOne({
    $and: [
      {
        $or: [
          { customer: new mongoose.Types.ObjectId("6989ac8325cd091f94e29d58") },
          { phone: "01943597896" },
        ]
      },
      {
        $or: [
          { "products.productId": prodObjId },
          { "products.productId": prodIdStr },
          { "products.productIdCode": product.productId },
          { "products.name": new RegExp(`^${product.name.trim()}$`, "i") },
        ]
      }
    ]
  });

  console.log("Found with rawDb:", anyOrderRaw?.orderId);

  await mongoose.disconnect();
}

check().catch(console.error);
