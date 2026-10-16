/**
 * ============================================================
 * config/database.js — MongoDB Database Connection
 * ============================================================
 * এই ফাইলটি MongoDB এর সাথে সংযোগ স্থাপন করে।
 *
 * কাজের ধারা:
 *  - .env ফাইলের MONGODB_URI ব্যবহার করে mongoose.connect() করে
 *  - সংযোগ সফল হলে connected host নাম console এ দেখায়
 *  - সংযোগ ব্যর্থ হলে error log করে এবং process.exit(1) দিয়ে সার্ভার বন্ধ করে
 *  - disconnected হলে পুনরায় reconnect event log করে
 *  - SIGINT signal (Ctrl+C) পেলে connection gracefully বন্ধ করে
 * ============================================================
 */

const mongoose = require("mongoose");

/**
 * connectDB — MongoDB connection স্থাপন করে
 */
let isMigrated = false;

const connectDB = async () => {
  if (mongoose.connection.readyState >= 1) {
    return mongoose.connection;
  }
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error("MONGODB_URI environment variable is missing. Please configure it in your Vercel Project Settings or local .env file.");
    }
    const conn = await mongoose.connect(process.env.MONGODB_URI);

    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);

    if (!isMigrated) {
      isMigrated = true;
      runMigration().catch(err => console.error("Migration warning:", err));
    }

    return conn;
  } catch (error) {
    console.error("❌ Database connection error:", error.message);
    throw error;
  }
};

/**
 * runMigration — পুরোনো phone_1 ইনডেক্স ড্রপ করে নতুন কম্পোজিট ইনডেক্স তৈরি করে
 * এবং পুরোনো শপ অর্ডারের সাথে কাস্টমার লিংক করে।
 */
const runMigration = async () => {
  try {
    if (!mongoose.connection || !mongoose.connection.db) {
      console.warn("⚠️ Database connection not ready for migration. Skipping migration.");
      return;
    }

    console.log("🔄 Starting database indexes and data migration...");

    // 1. Drop the old unique 'phone_1' index if it exists on customers collection
    const collections = await mongoose.connection.db.listCollections({ name: "customers" }).toArray();
    if (collections.length > 0) {
      const indexes = await mongoose.connection.db.collection("customers").indexes();
      const hasPhoneUniqueIndex = indexes.some(idx => idx.name === "phone_1" && idx.unique);
      if (hasPhoneUniqueIndex) {
        console.log("🗑️ Dropping old unique index 'phone_1'...");
        await mongoose.connection.db.collection("customers").dropIndex("phone_1");
        console.log("✅ Successfully dropped old 'phone_1' index.");
      }
    }

    // 2. Ensure indexes are built (Mongoose will auto-create the new index on name+phone)
    const Customer = mongoose.models.Customer || require("../models/Customer");
    await Customer.syncIndexes();
    console.log("✅ Successfully synchronized Customer indexes.");

    // 3. Migrate existing shop orders to link with a Customer document
    const Order = mongoose.models.Order || require("../models/Order");
    const shopOrdersWithoutCustomer = await Order.find({
      orderType: "shop",
      customer: { $exists: false }
    });

    if (shopOrdersWithoutCustomer.length > 0) {
      console.log(`📦 Found ${shopOrdersWithoutCustomer.length} shop orders without customer link. Migrating...`);
      for (const order of shopOrdersWithoutCustomer) {
        const name = (order.customerName || "Walk-in Customer").trim();
        const phone = (order.phone || "N/A").trim();

        // Find existing customer with exact phone & name (case-insensitive)
        let cust = await Customer.findOne({
          phone: phone,
          name: { $regex: new RegExp(`^${name}$`, "i") }
        });

        if (!cust) {
          try {
            cust = await Customer.create({
              name: name,
              phone: phone,
              password: "N/A"
            });
          } catch (e) {
            // In case of race condition or duplicate key, fetch existing
            cust = await Customer.findOne({ phone: phone });
          }
        }

        if (cust) {
          await Order.updateOne({ _id: order._id }, { $set: { customer: cust._id } });
        }
      }
      console.log(`✅ Successfully migrated all ${shopOrdersWithoutCustomer.length} shop orders.`);
    } else {
      console.log("✅ No shop orders without customer link found.");
    }

    // 4. Ensure legacy warehouse fields in products are migrated to shop and unset
    const productsCollection = mongoose.connection.db.collection("products");
    // 4. Ensure canonical locations (display, shopStock, warehouse) and clean up legacy shop / storeRoom
    const legacyProducts = await productsCollection.countDocuments({
      $or: [
        { "locations.shop": { $exists: true } },
        { "locations.storeRoom": { $exists: true } },
        { "variation.locations.shop": { $exists: true } },
        { "variation.locations.storeRoom": { $exists: true } }
      ]
    });
    if (legacyProducts > 0) {
      console.log(`📦 Found ${legacyProducts} products with legacy location fields. Migrating to shopStock and warehouse...`);
      const cursor = productsCollection.find({
        $or: [
          { "locations.shop": { $exists: true } },
          { "locations.storeRoom": { $exists: true } },
          { "variation.locations.shop": { $exists: true } },
          { "variation.locations.storeRoom": { $exists: true } }
        ]
      });
      while (await cursor.hasNext()) {
        const prod = await cursor.next();
        if (Array.isArray(prod.variation)) {
          prod.variation.forEach((v) => {
            if (v.locations) {
              const d = Number(v.locations.display || 0);
              const sh = Number(v.locations.shopStock !== undefined ? v.locations.shopStock : (v.locations.shop || 0));
              const w = Number(v.locations.warehouse !== undefined ? v.locations.warehouse : (v.locations.storeRoom || 0));
              v.locations = { display: d, shopStock: sh, warehouse: w };
            }
          });
        }
        if (prod.locations) {
          const rd = Number(prod.locations.display || 0);
          const rsh = Number(prod.locations.shopStock !== undefined ? prod.locations.shopStock : (prod.locations.shop || 0));
          const rw = Number(prod.locations.warehouse !== undefined ? prod.locations.warehouse : (prod.locations.storeRoom || 0));
          prod.locations = { display: rd, shopStock: rsh, warehouse: rw };
        }
        await productsCollection.updateOne(
          { _id: prod._id },
          {
            $set: {
              variation: prod.variation,
              ...(prod.locations ? { locations: prod.locations } : {})
            }
          }
        );
      }
      await productsCollection.updateMany(
        {},
        {
          $unset: {
            "locations.shop": "",
            "locations.storeRoom": "",
            "variation.$[].locations.shop": "",
            "variation.$[].locations.storeRoom": ""
          }
        }
      );
      console.log(`✅ Finished migrating legacy location fields to shopStock and warehouse.`);
    }
  } catch (err) {
    console.error("❌ Error during database migration:", err);
  }
};

// ─── Connection Event Listeners ──────────────────────────────────────────────

// MongoDB হঠাৎ disconnect হলে log করা হয় (network issue ইত্যাদিতে হতে পারে)
mongoose.connection.on("disconnected", () => {
  console.log("❌ MongoDB disconnected");
});

// MongoDB পুনরায় সংযুক্ত হলে log করা হয়
mongoose.connection.on("reconnected", () => {
  console.log("✅ MongoDB reconnected");
});

// ─── Graceful Shutdown ────────────────────────────────────────────────────────
// সার্ভার Ctrl+C বা process kill দিয়ে বন্ধ করলে MongoDB connection clean ভাবে বন্ধ হয়
process.on("SIGINT", async () => {
  try {
    await mongoose.connection.close();
    console.log("📴 MongoDB connection closed through app termination");
    process.exit(0);
  } catch (error) {
    console.error("Error closing database connection:", error);
    process.exit(1);
  }
});

connectDB.runMigration = runMigration;
module.exports = connectDB;
