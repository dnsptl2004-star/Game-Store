import express from "express";
import mongoose from "mongoose";
import Order from "../models/Order.js";
import Address from "../models/Address.js";

const router = express.Router();

// ✅ GET USER ORDERS (Supports both /orders and /orders/:email for Express 5 compatibility)
const handleGetOrders = async (req, res) => {
  try {
    const email = req.params.email || req.query.email;
    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }
    const orders = await Order.find({ "user.email": email })
      .sort({ createdAt: -1 })
      .lean();

    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

router.get("/orders", handleGetOrders);
router.get("/orders/:email", handleGetOrders);

// ✅ CREATE ORDER
router.post("/create-order", async (req, res) => {
  try {
    const { user, items = [], shippingAddress, paymentMethod = "upi" } = req.body;

    if (!items.length) {
      return res.status(400).json({ error: "Cart is empty" });
    }

    const processedItems = items.map((item) => {
      const isDl = item.isDownloadable !== false && item.category !== "Accessories" && item.category !== "Consoles";
      const randomHex = () => Math.random().toString(36).substring(2, 6).toUpperCase();
      const licenseKey = isDl ? (item.licenseKey || `GV-${randomHex()}-${randomHex()}-${randomHex()}`) : "";
      const downloadSlug = encodeURIComponent((item.name || "game").toLowerCase().replace(/[^a-z0-9]/g, "-"));
      const downloadUrl = isDl ? (item.downloadUrl || `https://downloads.gamevault.io/games/${downloadSlug}-installer.exe`) : "";

      return {
        ...item,
        isDownloadable: isDl,
        downloadUrl,
        downloadSize: item.downloadSize || "65 GB",
        licenseKey,
        size: Array.isArray(item.size)
          ? item.size[0] || "Standard Edition"
          : item.size || item.edition || "Standard Edition",
        edition:
          item.edition ||
          (Array.isArray(item.size) ? item.size[0] : item.size) ||
          "Standard Edition",
      };
    });

    const totalAmount = processedItems.reduce(
      (sum, item) => sum + Number(item.price || 0),
      0
    );

    const newOrder = new Order({
      user,
      items: processedItems,
      shippingAddress,
      paymentMethod,
      totalAmount,
      paymentStatus: paymentMethod === "cod" ? "pending" : "pending",
      orderStatus: "pending",
    });

    await newOrder.save();

    const upiUrl =
      paymentMethod === "upi"
        ? `upi://pay?pa=gamevault@upi&pn=GameVault&am=${totalAmount}&cu=INR`
        : null;

    res.json({
      order: newOrder,
      ...newOrder.toObject(),
      upiUrl,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ CONFIRM UPI PAYMENT
router.post("/confirm-upi", async (req, res) => {
  try {
    const { orderId, paymentReference } = req.body;

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ error: "Order not found" });

    order.paymentStatus = "paid";
    order.paymentReference = paymentReference;
    order.orderStatus = "confirmed";

    await order.save();

    res.json({ message: "Payment confirmed", order });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ CANCEL ORDER
router.delete("/orders/:id", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: "Invalid order id" });
    }

    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    if (order.orderStatus === "delivered") {
      return res.status(400).json({ error: "Delivered orders cannot be cancelled" });
    }

    if (order.orderStatus === "cancelled") {
      return res.status(400).json({ error: "Order already cancelled" });
    }

    order.orderStatus = "cancelled";
    order.paymentStatus = "cancelled";

    await order.save();

    res.json({ message: "Order cancelled successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ GET ADDRESSES
router.get("/addresses/:email", async (req, res) => {
  try {
    const data = await Address.find({ userEmail: req.params.email })
      .sort({ createdAt: -1 })
      .lean();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ CREATE ADDRESS
router.post("/addresses", async (req, res) => {
  try {
    const address = await Address.create(req.body);
    res.json(address);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
