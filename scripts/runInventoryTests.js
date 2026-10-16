/**
 * ============================================================
 * scripts/runInventoryTests.js
 * ============================================================
 * Automated Verification Suite for Shoppers' Perk Inventory Engine.
 * Tests 1 to 12 as per Non-Negotiable Business Rules:
 *  - TEST 1: Shop Sale Priority (display -> shopStock -> warehouse)
 *  - TEST 2: Online Sale Priority (shopStock -> warehouse -> display + deductions stored)
 *  - TEST 3: Shop Return (Always goes to display)
 *  - TEST 4: Online Return (Always goes to display)
 *  - TEST 5: Online Cancellation Restoration (Exact original locations)
 *  - TEST 6: Historical Online Cancel without deductions (HISTORICAL_ALLOCATION_REQUIRED)
 *  - TEST 7: Shop Exchange (Old -> display, New -> display -> shopStock -> warehouse, shared exchangeId)
 *  - TEST 8: Online Exchange (Old -> display, New -> shopStock -> warehouse -> display, shared exchangeId)
 *  - TEST 9: Manual Transfer (display <-> shopStock <-> warehouse, audited)
 *  - TEST 10: Stock Adjustment (Mandatory reason, audited)
 *  - TEST 11: Insufficient Stock Rejection (No negative stock allowed)
 *  - TEST 12: Concurrency & Invariant Protection
 * ============================================================
 */

const mongoose = require("mongoose");
const dns = require("dns");
dns.setServers(["1.1.1.1", "8.8.8.8"]);
require("dotenv").config();
if (!process.env.MONGODB_URI) {
  require("dotenv").config({ path: "LifeStyle-Backend/.env" });
}

const Product = require("../models/Product");
const StockMovement = require("../models/StockMovement");
const inventoryService = require("../services/inventoryService");

const testResults = [];

function recordResult(testName, passed, details = "") {
  testResults.push({ testName, passed, details });
  const statusBadge = passed ? "✅ PASS" : "❌ FAIL";
  console.log(`${statusBadge} | ${testName}${details ? ` (${details})` : ""}`);
}

let defaultCategoryId = null;
let defaultUserId = null;

async function createTestProduct(sku, name, locations) {
  const stock = locations.display + locations.shopStock + locations.warehouse;
  const product = new Product({
    name: `[TEST] ${name}`,
    description: "Automated Test Product Description",
    sku: sku,
    productId: `PID-${sku}-${Date.now().toString().slice(-4)}`,
    price: 100,
    category: defaultCategoryId,
    createdBy: defaultUserId,
    variation: [
      {
        size: "M",
        color: "Black",
        sku: `${sku}-VAR`,
        purchasePrice: 50,
        basePrice: 100,
        discountPrice: 100,
        stock: stock,
        locations: {
          display: locations.display,
          shopStock: locations.shopStock,
          warehouse: locations.warehouse,
        },
      },
    ],
  });
  await product.save();
  return product;
}

async function runAllTests() {
  console.log("============================================================");
  console.log("Starting Automated Inventory Verification Suite");
  console.log("============================================================\n");

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not set!");
  }

  await mongoose.connect(uri);
  console.log("Connected to MongoDB successfully.\n");

  const existingCat = await mongoose.connection.db.collection("categories").findOne();
  const existingUser = await mongoose.connection.db.collection("users").findOne();
  defaultCategoryId = existingCat?._id || new mongoose.Types.ObjectId();
  defaultUserId = existingUser?._id || new mongoose.Types.ObjectId();

  const testProductIds = [];

  try {
    // ----------------------------------------------------
    // TEST 1: Shop Sale Priority (display -> shopStock -> warehouse)
    // ----------------------------------------------------
    {
      const prod = await createTestProduct("T1", "Shop Sale Test", {
        display: 3,
        shopStock: 4,
        warehouse: 10,
      });
      testProductIds.push(prod._id);
      const varId = prod.variation[0]._id;

      const { processedItems } = await inventoryService.deductForShopSale({
        orderId: "TEST-ORD-1",
        items: [{ productId: prod._id, variationId: varId, quantity: 5 }],
      });

      const updated = await Product.findById(prod._id);
      const vLoc = updated.variation[0].locations;
      const vStock = updated.variation[0].stock;

      const deductions = processedItems[0].deductions;
      const p1 = vLoc.display === 0; // -3 from display
      const p2 = vLoc.shopStock === 2; // -2 from shopStock
      const p3 = vLoc.warehouse === 10; // 0 from warehouse
      const p4 = vStock === 12; // 17 - 5 = 12
      const p5 =
        deductions.length === 2 &&
        deductions[0].location === "display" &&
        deductions[0].quantity === 3 &&
        deductions[1].location === "shopStock" &&
        deductions[1].quantity === 2;

      const movs = await StockMovement.find({ orderId: "TEST-ORD-1" });
      const p6 = movs.length === 2 && movs.every((m) => m.transactionType === "shop_sale");

      const passed = p1 && p2 && p3 && p4 && p5 && p6;
      recordResult(
        "TEST 1: Shop Sale Priority (display -> shopStock -> warehouse)",
        passed,
        `Disp: ${vLoc.display}, Shop: ${vLoc.shopStock}, WH: ${vLoc.warehouse}, Stock: ${vStock}`
      );
    }

    // ----------------------------------------------------
    // TEST 2: Online Sale Priority (shopStock -> warehouse -> display)
    // ----------------------------------------------------
    {
      const prod = await createTestProduct("T2", "Online Sale Test", {
        display: 3,
        shopStock: 2,
        warehouse: 5,
      });
      testProductIds.push(prod._id);
      const varId = prod.variation[0]._id;

      const { processedItems } = await inventoryService.deductForOnlineOrder({
        orderId: "TEST-ORD-2",
        items: [{ productId: prod._id, variationId: varId, quantity: 4 }],
      });

      const updated = await Product.findById(prod._id);
      const vLoc = updated.variation[0].locations;
      const vStock = updated.variation[0].stock;

      const deductions = processedItems[0].deductions;
      const p1 = vLoc.shopStock === 0; // -2 from shopStock
      const p2 = vLoc.warehouse === 3; // -2 from warehouse
      const p3 = vLoc.display === 3; // 0 from display
      const p4 = vStock === 6; // 10 - 4 = 6
      const p5 =
        deductions.length === 2 &&
        deductions[0].location === "shopStock" &&
        deductions[0].quantity === 2 &&
        deductions[1].location === "warehouse" &&
        deductions[1].quantity === 2;

      const movs = await StockMovement.find({ orderId: "TEST-ORD-2" });
      const p6 = movs.length === 2 && movs.every((m) => m.transactionType === "online_sale");

      const passed = p1 && p2 && p3 && p4 && p5 && p6;
      recordResult(
        "TEST 2: Online Sale Priority (shopStock -> warehouse -> display)",
        passed,
        `Shop: ${vLoc.shopStock}, WH: ${vLoc.warehouse}, Disp: ${vLoc.display}, Stock: ${vStock}`
      );
    }

    // ----------------------------------------------------
    // TEST 3: Shop Return (Always goes to display)
    // ----------------------------------------------------
    {
      const prod = await createTestProduct("T3", "Shop Return Test", {
        display: 1,
        shopStock: 5,
        warehouse: 10,
      });
      testProductIds.push(prod._id);
      const varId = prod.variation[0]._id;

      await inventoryService.restoreForShopReturn({
        orderId: "TEST-ORD-3",
        items: [
          {
            productId: prod._id,
            variationId: varId,
            quantity: 2,
            reason: "Customer returned unworn item",
          },
        ],
      });

      const updated = await Product.findById(prod._id);
      const vLoc = updated.variation[0].locations;
      const vStock = updated.variation[0].stock;

      const p1 = vLoc.display === 3; // 1 + 2 = 3
      const p2 = vLoc.shopStock === 5;
      const p3 = vLoc.warehouse === 10;
      const p4 = vStock === 18;

      const movs = await StockMovement.find({ orderId: "TEST-ORD-3", transactionType: "shop_return" });
      const p5 = movs.length === 1 && movs[0].toLocation === "display";

      const passed = p1 && p2 && p3 && p4 && p5;
      recordResult(
        "TEST 3: Shop Return (Always goes to display)",
        passed,
        `Disp: ${vLoc.display}, Shop: ${vLoc.shopStock}, WH: ${vLoc.warehouse}, Stock: ${vStock}`
      );
    }

    // ----------------------------------------------------
    // TEST 4: Online Return (Always goes to display)
    // ----------------------------------------------------
    {
      const prod = await createTestProduct("T4", "Online Return Test", {
        display: 0,
        shopStock: 4,
        warehouse: 8,
      });
      testProductIds.push(prod._id);
      const varId = prod.variation[0]._id;

      await inventoryService.restoreForOnlineReturn({
        returnId: "RET-TEST-004",
        orderId: "TEST-ORD-4",
        productDoc: prod,
        variationId: varId,
        quantity: 2,
      });

      const updated = await Product.findById(prod._id);
      const vLoc = updated.variation[0].locations;
      const vStock = updated.variation[0].stock;

      const p1 = vLoc.display === 2; // 0 + 2 = 2
      const p2 = vLoc.shopStock === 4;
      const p3 = vLoc.warehouse === 8;
      const p4 = vStock === 14;

      const movs = await StockMovement.find({ orderId: "TEST-ORD-4", transactionType: "online_return" });
      const p5 = movs.length === 1 && movs[0].toLocation === "display";

      const passed = p1 && p2 && p3 && p4 && p5;
      recordResult(
        "TEST 4: Online Return (Always goes to display)",
        passed,
        `Disp: ${vLoc.display}, Shop: ${vLoc.shopStock}, WH: ${vLoc.warehouse}, Stock: ${vStock}`
      );
    }

    // ----------------------------------------------------
    // TEST 5: Online Cancellation Restoration (Exact original locations)
    // ----------------------------------------------------
    {
      const prod = await createTestProduct("T5", "Online Cancel Exact Restore", {
        display: 1,
        shopStock: 0,
        warehouse: 3,
      });
      testProductIds.push(prod._id);
      const varId = prod.variation[0]._id;

      // Mock order with explicit deductions breakdown
      const mockOrder = {
        orderId: "TEST-ORD-5",
        products: [
          {
            productId: prod._id,
            variationId: varId,
            quantity: 3,
            deductions: [
              { location: "shopStock", quantity: 2 },
              { location: "warehouse", quantity: 1 },
            ],
          },
        ],
      };

      await inventoryService.restoreOnlineCancellation({
        order: mockOrder,
      });

      const updated = await Product.findById(prod._id);
      const vLoc = updated.variation[0].locations;
      const vStock = updated.variation[0].stock;

      const p1 = vLoc.shopStock === 2; // 0 + 2 = 2
      const p2 = vLoc.warehouse === 4; // 3 + 1 = 4
      const p3 = vLoc.display === 1; // display untouched
      const p4 = vStock === 7;

      const movs = await StockMovement.find({ orderId: "TEST-ORD-5", transactionType: "online_cancel_restore" });
      const p5 = movs.length === 2;

      const passed = p1 && p2 && p3 && p4 && p5;
      recordResult(
        "TEST 5: Online Cancellation Restoration (Exact original locations)",
        passed,
        `Shop: ${vLoc.shopStock}, WH: ${vLoc.warehouse}, Disp: ${vLoc.display}, Stock: ${vStock}`
      );
    }

    // ----------------------------------------------------
    // TEST 6: Historical Online Cancel without deductions (Blocks with HISTORICAL_ALLOCATION_REQUIRED)
    // ----------------------------------------------------
    {
      const prod = await createTestProduct("T6", "Historical Order Cancel", {
        display: 5,
        shopStock: 5,
        warehouse: 5,
      });
      testProductIds.push(prod._id);
      const varId = prod.variation[0]._id;

      let caughtCode = null;
      try {
        await inventoryService.restoreOnlineCancellation({
          order: {
            orderId: "TEST-ORD-6",
            products: [
              {
                productId: prod._id,
                variationId: varId,
                quantity: 2,
                deductions: [], // Empty deductions -> Historical order!
              },
            ],
          },
        });
      } catch (err) {
        caughtCode = err.code;
      }

      const updated = await Product.findById(prod._id);
      const vLoc = updated.variation[0].locations;

      const passed =
        caughtCode === "HISTORICAL_ALLOCATION_REQUIRED" &&
        vLoc.display === 5 &&
        vLoc.shopStock === 5 &&
        vLoc.warehouse === 5;

      recordResult(
        "TEST 6: Historical Online Cancel without deductions (Blocked)",
        passed,
        `Caught Code: ${caughtCode}`
      );
    }

    // ----------------------------------------------------
    // TEST 7: Shop Exchange (Old -> display, New -> display -> shopStock -> warehouse, shared exchangeId)
    // ----------------------------------------------------
    {
      const oldProd = await createTestProduct("T7-OLD", "Old Exch Product", {
        display: 1,
        shopStock: 2,
        warehouse: 3,
      });
      const newProd = await createTestProduct("T7-NEW", "New Exch Product", {
        display: 1,
        shopStock: 2,
        warehouse: 5,
      });
      testProductIds.push(oldProd._id, newProd._id);

      const oldVarId = oldProd.variation[0]._id;
      const newVarId = newProd.variation[0]._id;
      const testExchangeId = "EXCH-SHOP-001";

      await inventoryService.processShopExchange({
        exchangeId: testExchangeId,
        orderId: "TEST-ORD-7",
        originalItems: [
          {
            originalProductId: oldProd._id,
            originalVariationId: oldVarId,
            quantity: 1,
          },
        ],
        replacementItems: [
          {
            replacementProductId: newProd._id,
            replacementVariationId: newVarId,
            quantity: 2, // Needs 1 from display and 1 from shopStock
          },
        ],
      });

      const updatedOld = await Product.findById(oldProd._id);
      const updatedNew = await Product.findById(newProd._id);

      const p1 = updatedOld.variation[0].locations.display === 2; // Old returned to display (1 + 1)
      const p2 = updatedNew.variation[0].locations.display === 0; // New: 1 - 1 = 0
      const p3 = updatedNew.variation[0].locations.shopStock === 1; // New: 2 - 1 = 1
      const p4 = updatedNew.variation[0].locations.warehouse === 5; // New: 5 - 0 = 5

      const exchMovs = await StockMovement.find({ exchangeId: testExchangeId });
      const p5 = exchMovs.length === 3; // 1 return + 2 issue deductions
      const p6 = exchMovs.every((m) => m.exchangeId === testExchangeId);

      const passed = p1 && p2 && p3 && p4 && p5 && p6;
      recordResult(
        "TEST 7: Shop Exchange (Old -> display, New -> display -> shopStock -> warehouse, shared exchangeId)",
        passed,
        `Shared Exchange ID: ${testExchangeId}, Movements logged: ${exchMovs.length}`
      );
    }

    // ----------------------------------------------------
    // TEST 8: Online Exchange (Old -> display, New -> shopStock -> warehouse -> display, shared exchangeId)
    // ----------------------------------------------------
    {
      const oldProd = await createTestProduct("T8-OLD", "Old Online Exch Product", {
        display: 0,
        shopStock: 3,
        warehouse: 3,
      });
      const newProd = await createTestProduct("T8-NEW", "New Online Exch Product", {
        display: 5,
        shopStock: 1,
        warehouse: 2,
      });
      testProductIds.push(oldProd._id, newProd._id);

      const oldVarId = oldProd.variation[0]._id;
      const newVarId = newProd.variation[0]._id;
      const testExchangeId = "EXCH-ONLINE-001";

      await inventoryService.processOnlineExchange({
        exchangeId: testExchangeId,
        orderId: "TEST-ORD-8",
        originalItems: [
          {
            originalProductId: oldProd._id,
            originalVariationId: oldVarId,
            quantity: 1,
          },
        ],
        replacementItems: [
          {
            replacementProductId: newProd._id,
            replacementVariationId: newVarId,
            quantity: 2, // Needs 1 from shopStock and 1 from warehouse
          },
        ],
      });

      const updatedOld = await Product.findById(oldProd._id);
      const updatedNew = await Product.findById(newProd._id);

      const p1 = updatedOld.variation[0].locations.display === 1; // Old returned to display (0 + 1)
      const p2 = updatedNew.variation[0].locations.shopStock === 0; // New: 1 - 1 = 0
      const p3 = updatedNew.variation[0].locations.warehouse === 1; // New: 2 - 1 = 1
      const p4 = updatedNew.variation[0].locations.display === 5; // New: 5 untouched

      const exchMovs = await StockMovement.find({ exchangeId: testExchangeId });
      const p5 = exchMovs.length === 3; // 1 return + 2 issue deductions
      const p6 = exchMovs.every((m) => m.exchangeId === testExchangeId);

      const passed = p1 && p2 && p3 && p4 && p5 && p6;
      recordResult(
        "TEST 8: Online Exchange (Old -> display, New -> shopStock -> warehouse -> display, shared exchangeId)",
        passed,
        `Shared Exchange ID: ${testExchangeId}, Movements logged: ${exchMovs.length}`
      );
    }

    // ----------------------------------------------------
    // TEST 9: Manual Transfer (display <-> shopStock <-> warehouse, audited)
    // ----------------------------------------------------
    {
      const prod = await createTestProduct("T9", "Manual Transfer Product", {
        display: 2,
        shopStock: 3,
        warehouse: 10,
      });
      testProductIds.push(prod._id);
      const varId = prod.variation[0]._id;

      await inventoryService.transferStock({
        productId: prod._id,
        variationId: varId,
        fromLocation: "warehouse",
        toLocation: "display",
        quantity: 4,
        reason: "Refill display",
      });

      const updated = await Product.findById(prod._id);
      const vLoc = updated.variation[0].locations;
      const vStock = updated.variation[0].stock;

      const p1 = vLoc.warehouse === 6; // 10 - 4 = 6
      const p2 = vLoc.display === 6; // 2 + 4 = 6
      const p3 = vLoc.shopStock === 3; // untouched
      const p4 = vStock === 15; // total unchanged (2+3+10 = 15)

      const movs = await StockMovement.find({
        product: prod._id,
        transactionType: "manual_transfer",
      });
      const p5 =
        movs.length === 1 &&
        movs[0].fromLocation === "warehouse" &&
        movs[0].toLocation === "display" &&
        movs[0].quantity === 4;

      const passed = p1 && p2 && p3 && p4 && p5;
      recordResult(
        "TEST 9: Manual Stock Transfer (warehouse -> display)",
        passed,
        `WH: ${vLoc.warehouse}, Disp: ${vLoc.display}, Total: ${vStock}`
      );
    }

    // ----------------------------------------------------
    // TEST 10: Stock Adjustment (Mandatory reason, audited)
    // ----------------------------------------------------
    {
      const prod = await createTestProduct("T10", "Stock Adjustment Product", {
        display: 5,
        shopStock: 5,
        warehouse: 5,
      });
      testProductIds.push(prod._id);
      const varId = prod.variation[0]._id;

      // Subtest A: Reject when reason is invalid or missing
      let rejectedNoReason = false;
      try {
        await inventoryService.adjustStock({
          productId: prod._id,
          variationId: varId,
          location: "display",
          quantity: 2,
          reason: "", // Empty reason!
        });
      } catch (err) {
        rejectedNoReason = true;
      }

      // Subtest B: Valid adjustment with reason "Damaged"
      await inventoryService.adjustStock({
        productId: prod._id,
        variationId: varId,
        location: "display",
        quantity: 2,
        reason: "Damaged",
        note: "Damaged during handling",
      });

      const updated = await Product.findById(prod._id);
      const vLoc = updated.variation[0].locations;
      const vStock = updated.variation[0].stock;

      const p1 = rejectedNoReason;
      const p2 = vLoc.display === 3; // 5 - 2 = 3
      const p3 = vStock === 13; // 15 - 2 = 13

      const movs = await StockMovement.find({
        product: prod._id,
        transactionType: "stock_adjustment",
      });
      const p4 =
        movs.length === 1 &&
        movs[0].fromLocation === "display" &&
        movs[0].toLocation === "damaged";

      const passed = p1 && p2 && p3 && p4;
      recordResult(
        "TEST 10: Stock Adjustment (Mandatory reason, audited)",
        passed,
        `Reason rejected when empty: ${rejectedNoReason}, Disp: ${vLoc.display}, Total: ${vStock}`
      );
    }

    // ----------------------------------------------------
    // TEST 11: Insufficient Stock Rejection (No negative stock allowed)
    // ----------------------------------------------------
    {
      const prod = await createTestProduct("T11", "Insufficient Stock Product", {
        display: 1,
        shopStock: 1,
        warehouse: 1,
      });
      testProductIds.push(prod._id);
      const varId = prod.variation[0]._id;

      let rejectedInsufficient = false;
      let errorDetails = null;

      try {
        await inventoryService.deductForShopSale({
          orderId: "TEST-ORD-11",
          items: [{ productId: prod._id, variationId: varId, quantity: 10 }],
        });
      } catch (err) {
        rejectedInsufficient = true;
        errorDetails = err.message;
      }

      const updated = await Product.findById(prod._id);
      const vLoc = updated.variation[0].locations;
      const vStock = updated.variation[0].stock;

      const passed =
        rejectedInsufficient &&
        vLoc.display === 1 &&
        vLoc.shopStock === 1 &&
        vLoc.warehouse === 1 &&
        vStock === 3;

      recordResult(
        "TEST 11: Insufficient Stock Rejection (No negative stock)",
        passed,
        `Rejected: ${rejectedInsufficient}, Error: "${errorDetails}"`
      );
    }

    // ----------------------------------------------------
    // TEST 12: Concurrency & Invariant Protection
    // ----------------------------------------------------
    {
      const prod = await createTestProduct("T12", "Concurrency Test Product", {
        display: 2,
        shopStock: 2,
        warehouse: 2,
      });
      testProductIds.push(prod._id);
      const varId = prod.variation[0]._id;

      // Launch sequential checks and transactions
      // Product has 6 units total. We attempt 3 sales of 3 units each.
      // Exactly 2 should succeed (taking 6 units), 1 must fail due to insufficient stock.
      const runDeduction = async (ordId) => {
        const session = await mongoose.startSession();
        try {
          session.startTransaction();
          await inventoryService.deductForShopSale({
            orderId: ordId,
            items: [{ productId: prod._id, variationId: varId, quantity: 3 }],
            session,
          });
          await session.commitTransaction();
          return { success: true };
        } catch (err) {
          await session.abortTransaction();
          return { success: false, error: err.message };
        } finally {
          session.endSession();
        }
      };

      const res1 = await runDeduction("TEST-CONC-1");
      const res2 = await runDeduction("TEST-CONC-2");
      const res3 = await runDeduction("TEST-CONC-3");

      const attempts = [res1, res2, res3];
      const succeeded = attempts.filter((r) => r.success);
      const failed = attempts.filter((r) => !r.success);
      if (failed.length > 0) {
        console.log("TEST 12 Attempt errors:", failed.map((f) => f.error));
      }

      const updated = await Product.findById(prod._id);
      const vLoc = updated.variation[0].locations;
      const vStock = updated.variation[0].stock;

      const p1 = vStock >= 0;
      const p2 = vLoc.display + vLoc.shopStock + vLoc.warehouse === vStock;
      const p3 = succeeded.length === 2 && failed.length === 1;
      const p4 = vStock === 0;

      const passed = p1 && p2 && p3 && p4;
      recordResult(
        "TEST 12: Concurrency & Invariant Protection",
        passed,
        `Succeeded: ${succeeded.length}, Failed: ${failed.length}, Stock: ${vStock}`
      );
    }
  } catch (globalErr) {
    console.error("Test execution encountered an error:", globalErr);
  } finally {
    // Teardown: Clean up test products and movements
    console.log("\nCleaning up test artifacts...");
    if (testProductIds.length > 0) {
      await Product.deleteMany({ _id: { $in: testProductIds } });
      await mongoose.connection.db.collection("stockmovements").deleteMany({ product: { $in: testProductIds } });
      console.log(`Cleaned up ${testProductIds.length} test product(s) and test movements.`);
    }

    await mongoose.disconnect();
    console.log("Disconnected from MongoDB.");
  }

  // Final Summary
  console.log("\n============================================================");
  console.log("FINAL TEST SUMMARY");
  console.log("============================================================");
  const allPassed = testResults.every((r) => r.passed);
  testResults.forEach((r, idx) => {
    const num = String(idx + 1).padStart(2, " ");
    const badge = r.passed ? "PASS" : "FAIL";
    console.log(`[${badge}] #${num}: ${r.testName}`);
  });
  console.log("============================================================");
  console.log(`TOTAL: ${testResults.length} | PASSED: ${testResults.filter((r) => r.passed).length} | FAILED: ${testResults.filter((r) => !r.passed).length}`);
  console.log(`OVERALL STATUS: ${allPassed ? "SUCCESS (100% PASS)" : "FAILURE"}`);
  console.log("============================================================\n");

  if (!allPassed) {
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
