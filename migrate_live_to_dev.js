/**
 * ============================================================
 * migrate_live_to_dev.js — Safe Migration Script
 * ============================================================
 * Migrates data from Live Database backup into Dev/Target Database.
 * 
 * Rules applied:
 * 1. Preserves Dev Admin and User logins (Admin keeps dev password/name
 *    with Live's ObjectId to preserve references to Live collections).
 * 2. Merges Dev additional users (manager, employee, salesmen).
 * 3. Populates missing Product variation fields (locations: { display, shopStock, warehouse })
 *    safely without modifying original backup files.
 * 4. Syncs counters so new orders/products increment smoothly past Live's sequence numbers.
 * 5. Re-converts 24-char hex strings and ISO date strings back into proper BSON ObjectIds & Dates.
 * ============================================================
 */

require("dotenv").config();
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");

const TARGET_MONGO_URI =
  process.env.MONGODB_URI ||
  "mongodb+srv://kamanashis:bVqUCGloGyQR53j2@cluster0.wg8xgkc.mongodb.net/shoppers-livestyle?retryWrites=true&w=majority&appName=Cluster0";

const LIVE_BACKUP_DIR = path.resolve(__dirname, "..", "mongodb-backup", "live-database");
const DEV_BACKUP_DIR = path.resolve(__dirname, "..", "mongodb-backup", "development-test-database");

// Fields that should NOT be converted to ObjectId even if they match 24-char hex
const STRING_ONLY_FIELDS = new Set([
  "password",
  "barcode",
  "productId",
  "sku",
  "invoiceNo",
  "code",
  "phone",
  "nid",
  "email",
  "batchId",
  "purchaseId",
  "deviceId"
]);

function reviveDocument(val, key = null, isCounter = false) {
  if (val === null || val === undefined) return val;

  if (typeof val === "string") {
    // Counter collection uses string _ids like "Customer", "Order"
    if (isCounter && key === "_id") {
      return val;
    }

    // Check if it's an ObjectId string (24-hex characters)
    if (!STRING_ONLY_FIELDS.has(key) && /^[0-9a-fA-F]{24}$/.test(val)) {
      return new mongoose.Types.ObjectId(val);
    }

    // Check if it's an ISO Date string
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(val)) {
      const d = new Date(val);
      if (!isNaN(d.getTime())) return d;
    }

    return val;
  }

  if (Array.isArray(val)) {
    return val.map((item) => reviveDocument(item, key, isCounter));
  }

  if (typeof val === "object") {
    const res = {};
    for (const [k, v] of Object.entries(val)) {
      res[k] = reviveDocument(v, k, isCounter);
    }
    return res;
  }

  return val;
}

async function runMigration() {
  console.log("==================================================");
  console.log("   LIVE TO DEV DATABASE MIGRATION SCRIPT");
  console.log("==================================================");
  console.log(`Target Database: ${TARGET_MONGO_URI.replace(/:([^:@]+)@/, ":****@")}`);

  await mongoose.connect(TARGET_MONGO_URI);
  console.log("Connected to Target Database successfully!\n");

  const db = mongoose.connection.db;

  // 1. Prepare merged users
  console.log("Step 1: Preparing Merged Users...");
  const devUsersRaw = JSON.parse(fs.readFileSync(path.join(DEV_BACKUP_DIR, "users.json"), "utf8"));
  const liveUsersRaw = JSON.parse(fs.readFileSync(path.join(LIVE_BACKUP_DIR, "users.json"), "utf8"));

  const devAdmin = devUsersRaw.find((u) => u.email === "admin@example.com");
  const liveAdmin = liveUsersRaw.find((u) => u.email === "admin@example.com");
  const liveSalesman = liveUsersRaw.find((u) => u.email === "john.saleman@example.com");
  const otherDevUsers = devUsersRaw.filter((u) => u.email !== "admin@example.com");

  // Keep liveAdmin._id for foreign-key consistency, but preserve devAdmin's password, name, and details
  const mergedAdmin = {
    ...devAdmin,
    _id: liveAdmin._id,
    name: devAdmin.name,
    password: devAdmin.password,
    role: "admin",
  };

  const finalUsersList = [mergedAdmin, liveSalesman, ...otherDevUsers];
  console.log(`Merged ${finalUsersList.length} users successfully.`);

  // 2. Prepare merged counters
  console.log("\nStep 2: Preparing Counters...");
  const devCountersRaw = JSON.parse(fs.readFileSync(path.join(DEV_BACKUP_DIR, "counters.json"), "utf8"));
  const liveCountersRaw = JSON.parse(fs.readFileSync(path.join(LIVE_BACKUP_DIR, "counters.json"), "utf8"));

  const countersMap = new Map();
  // Start with live counters
  liveCountersRaw.forEach((c) => countersMap.set(c._id, c));
  // Add dev counters if not in live
  devCountersRaw.forEach((c) => {
    if (!countersMap.has(c._id)) {
      countersMap.set(c._id, c);
    }
  });
  const finalCountersList = Array.from(countersMap.values());
  console.log(`Merged ${finalCountersList.length} counters successfully.`);

  // 3. Process each collection
  const backupFiles = fs
    .readdirSync(LIVE_BACKUP_DIR)
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"));

  console.log(`\nStep 3: Migrating ${backupFiles.length} Collections into Target Database...`);

  for (const file of backupFiles) {
    const colName = file.replace(".json", "");
    process.stdout.write(`Migrating collection: [${colName}] ... `);

    let docs = [];

    if (colName === "users") {
      docs = finalUsersList;
    } else if (colName === "counters") {
      docs = finalCountersList;
    } else {
      docs = JSON.parse(fs.readFileSync(path.join(LIVE_BACKUP_DIR, file), "utf8"));
    }

    // Special enhancement for products: Ensure locations object exists in each variation
    if (colName === "products") {
      docs.forEach((prod) => {
        if (Array.isArray(prod.variation)) {
          prod.variation.forEach((v) => {
            if (!v.locations) {
              const stock = typeof v.stock === "number" ? Math.max(0, v.stock) : 0;
              v.locations = {
                display: stock,
                shopStock: 0,
                warehouse: 0,
              };
            }
          });
        }
      });
    }

    // Revive ObjectIds and Dates
    const isCounter = colName === "counters";
    const revivedDocs = docs.map((doc) => reviveDocument(doc, null, isCounter));

    // Clear target collection first
    const targetCollection = db.collection(colName);
    await targetCollection.deleteMany({});

    if (revivedDocs.length > 0) {
      await targetCollection.insertMany(revivedDocs, { ordered: false });
      console.log(`Done (${revivedDocs.length} documents inserted).`);
    } else {
      console.log(`Cleared (0 documents in live).`);
    }
  }

  console.log("\n==================================================");
  console.log("   MIGRATION COMPLETED SUCCESSFULLY!");
  console.log("==================================================");
}

runMigration()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("\nMigration failed with error:", err);
    process.exit(1);
  });
