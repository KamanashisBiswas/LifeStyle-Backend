require("dotenv").config();
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");

const MONGO_URI =
  process.argv[2] ||
  process.env.MONGODB_URI ||
  "mongodb+srv://kamanashis:bVqUCGloGyQR53j2@cluster0.wg8xgkc.mongodb.net/shoppers-livestyle?retryWrites=true&w=majority&appName=Cluster0";

const folderName =
  process.argv[3] || process.env.BACKUP_FOLDER || "development-test-database";

const OUTPUT_DIR = path.resolve(__dirname, "..", "mongodb-backup", folderName);

async function exportAllCollections() {
  console.log("Connecting to MongoDB...");
  try {
    await mongoose.connect(MONGO_URI);
    console.log("MongoDB connection successful!");

    const db = mongoose.connection.db;

    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
      console.log(`Created output directory: ${OUTPUT_DIR}`);
    }

    const collections = await db.listCollections().toArray();
    console.log(`Found ${collections.length} collections in database.`);

    const summary = [];

    for (const col of collections) {
      const colName = col.name;
      console.log(`Exporting collection: ${colName}...`);

      const documents = await db.collection(colName).find({}).toArray();
      const filePath = path.join(OUTPUT_DIR, `${colName}.json`);

      fs.writeFileSync(filePath, JSON.stringify(documents, null, 2), "utf-8");

      const stats = fs.statSync(filePath);
      const sizeKB = (stats.size / 1024).toFixed(2);

      summary.push({
        collection: colName,
        count: documents.length,
        size: `${sizeKB} KB`,
        file: `${colName}.json`,
      });
      console.log(`✓ ${colName}: ${documents.length} documents saved (${sizeKB} KB)`);
    }

    // Write a summary index file as well
    const indexFilePath = path.join(OUTPUT_DIR, "_backup_summary.json");
    fs.writeFileSync(
      indexFilePath,
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          database: "shoppers-livestyle",
          totalCollections: collections.length,
          collections: summary,
        },
        null,
        2
      ),
      "utf-8"
    );

    console.log("\n==========================================");
    console.log("Backup complete! All collections downloaded.");
    console.log(`Destination folder: ${OUTPUT_DIR}`);
    console.log("==========================================");
    console.table(summary);
  } catch (err) {
    console.error("Error during database export:", err);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB.");
  }
}

exportAllCollections();
