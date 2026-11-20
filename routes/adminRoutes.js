import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { exec } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";
import User from "../models/User.js";
import Product from "../models/Product.js";
import Order from "../models/Order.js";
import Address from "../models/Address.js";

const execAsync = promisify(exec);
const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure all uploads subdirectories exist
const baseUploadDir = path.resolve(process.cwd(), "uploads");
const tempUploadDir = path.join(baseUploadDir, "temp");
const gamesUploadDir = path.join(baseUploadDir, "games");
const webglUploadDir = path.join(baseUploadDir, "webgl");
const webglZipsDir = path.join(baseUploadDir, "webgl_zips");

[baseUploadDir, tempUploadDir, gamesUploadDir, webglUploadDir, webglZipsDir].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Multer storage for cover images
const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, baseUploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `cover_${Date.now()}_${Math.random().toString(36).substring(2, 7)}${ext}`);
  },
});
const uploadImage = multer({
  storage: imageStorage,
  limits: { fileSize: 25 * 1024 * 1024 },
});

// Multer storage for chunked upload slices
const chunkStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadId = req.body.uploadId;
    if (!uploadId || !/^[a-zA-Z0-9_-]+$/.test(uploadId)) {
      return cb(new Error("Invalid or missing uploadId"));
    }
    const targetDir = path.join(tempUploadDir, uploadId);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    cb(null, targetDir);
  },
  filename: (req, file, cb) => {
    const chunkIndex = req.body.chunkIndex;
    cb(null, `part_${chunkIndex}`);
  },
});
const uploadChunk = multer({
  storage: chunkStorage,
  limits: { fileSize: 50 * 1024 * 1024 }, // Max 50MB per chunk slice
});

// Multer for direct single file upload (up to 200MB)
const directStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, gamesUploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, "_");
    cb(null, `${base}_${Date.now()}${ext}`);
  },
});
const uploadDirect = multer({
  storage: directStorage,
  limits: { fileSize: 200 * 1024 * 1024 },
});

// Utility to format bytes into readable sizes
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

// Unzip utility using system tar with PowerShell Expand-Archive fallback
async function extractZip(zipPath, destinationDir) {
  if (!fs.existsSync(destinationDir)) {
    fs.mkdirSync(destinationDir, { recursive: true });
  }

  // 1. Try native bsdtar (built into Windows 10/11 & Linux)
  try {
    await execAsync(`tar -xf "${zipPath}" -C "${destinationDir}"`);
    return true;
  } catch (tarErr) {
    console.warn("tar extract failed, falling back to PowerShell Expand-Archive:", tarErr.message);
  }

  // 2. Fallback to PowerShell Expand-Archive
  try {
    const escapedZip = zipPath.replace(/'/g, "''");
    const escapedDest = destinationDir.replace(/'/g, "''");
    await execAsync(`powershell -NoProfile -Command "Expand-Archive -LiteralPath '${escapedZip}' -DestinationPath '${escapedDest}' -Force"`);
    return true;
  } catch (psErr) {
    throw new Error(`Failed to extract game zip archive: ${psErr.message}`);
  }
}

// Search for index.html inside extracted WebGL folder (checks root and up to 3 subdirectories deep)
function findHtml5EntryPoint(dirPath, base = "") {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    // Check root files first
    for (const entry of entries) {
      if (entry.isFile() && /^(index|game)\.html?$/i.test(entry.name)) {
        return path.join(base, entry.name).replace(/\\/g, "/");
      }
    }
    // Search subdirectories (avoid macOS metadata folders)
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== "__MACOSX" && !entry.name.startsWith(".")) {
        const subPath = path.join(dirPath, entry.name);
        const found = findHtml5EntryPoint(subPath, path.join(base, entry.name));
        if (found) return found;
      }
    }
  } catch (err) {
    console.error("Error finding HTML5 entrypoint:", err.message);
  }
  return null;
}

// Streams chunks sequentially, calculates SHA-256 hash, and writes target file
async function assembleChunksAndHash(chunkDir, totalChunks, finalFilePath) {
  const hash = crypto.createHash("sha256");
  const writeStream = fs.createWriteStream(finalFilePath);
  let totalBytes = 0;

  for (let i = 0; i < totalChunks; i++) {
    const chunkFile = path.join(chunkDir, `part_${i}`);
    if (!fs.existsSync(chunkFile)) {
      writeStream.destroy();
      throw new Error(`Missing chunk index ${i} of ${totalChunks}`);
    }
    const chunkBuffer = await fs.promises.readFile(chunkFile);
    hash.update(chunkBuffer);
    totalBytes += chunkBuffer.length;
    await new Promise((resolve, reject) => {
      writeStream.write(chunkBuffer, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  await new Promise((resolve, reject) => {
    writeStream.end((err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  const fileSha256 = hash.digest("hex");
  return { fileSha256, totalBytes };
}

// ----------------------------------------------------
// CHUNKED UPLOAD ROUTES (Supports up to 5 GB files)
// ----------------------------------------------------

// 1. Initialize chunked upload session
router.post("/upload-chunk/init", (req, res) => {
  try {
    const { fileName, fileSize, totalChunks, uploadType, gameTitle } = req.body;
    const cleanName = (fileName || "game_file").replace(/[^a-zA-Z0-9_.-]/g, "_");
    const uploadId = `upload_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const targetDir = path.join(tempUploadDir, uploadId);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    res.json({
      uploadId,
      chunkSize: 10 * 1024 * 1024, // 10 MB recommended chunk size
      fileName: cleanName,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Upload single chunk slice
router.post("/upload-chunk", uploadChunk.single("chunk"), (req, res) => {
  try {
    const { uploadId, chunkIndex, totalChunks } = req.body;
    if (!req.file) {
      return res.status(400).json({ error: "No chunk file received" });
    }

    res.json({
      success: true,
      uploadId,
      chunkIndex: Number(chunkIndex),
      totalChunks: Number(totalChunks),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Check upload progress / status (Resumable upload recovery)
router.post("/upload-chunk/status", (req, res) => {
  try {
    const { uploadId } = req.body;
    if (!uploadId) return res.status(400).json({ error: "uploadId required" });

    const targetDir = path.join(tempUploadDir, uploadId);
    if (!fs.existsSync(targetDir)) {
      return res.json({ uploadedChunks: [] });
    }

    const files = fs.readdirSync(targetDir);
    const uploadedChunks = files
      .filter((f) => f.startsWith("part_"))
      .map((f) => Number(f.replace("part_", "")))
      .sort((a, b) => a - b);

    res.json({ uploadId, uploadedChunks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Complete chunk assembly, compute SHA-256 hash, and unzip if WebGL
router.post("/upload-chunk/complete", async (req, res) => {
  const { uploadId, fileName, totalChunks, uploadType, version, gameTitle } = req.body;

  if (!uploadId || !fileName || !totalChunks) {
    return res.status(400).json({ error: "uploadId, fileName, and totalChunks are required" });
  }

  const chunkDir = path.join(tempUploadDir, uploadId);
  if (!fs.existsSync(chunkDir)) {
    return res.status(404).json({ error: "Upload session not found or already completed" });
  }

  const ext = path.extname(fileName).toLowerCase();
  const rawBase = path.basename(fileName, ext);
  const safeGameTitle = (gameTitle || rawBase).toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  const uniquePrefix = `${safeGameTitle}_${Date.now()}`;
  const finalFileName = `${uniquePrefix}${ext}`;

  try {
    let finalFilePath;
    let targetPublicPath;

    if (uploadType === "webgl_zip") {
      finalFilePath = path.join(webglZipsDir, finalFileName);
      targetPublicPath = `/uploads/webgl_zips/${finalFileName}`;
    } else {
      finalFilePath = path.join(gamesUploadDir, finalFileName);
      targetPublicPath = `/uploads/games/${finalFileName}`;
    }

    // Assemble all slices and compute SHA-256 hash
    console.log(`[Upload] Assembling ${totalChunks} chunks for ${fileName} into ${finalFileName}...`);
    const { fileSha256, totalBytes } = await assembleChunksAndHash(chunkDir, Number(totalChunks), finalFilePath);
    const humanSize = formatBytes(totalBytes);
    console.log(`[Upload] Assembly complete! Size: ${humanSize}, SHA-256: ${fileSha256}`);

    // Clean up temporary chunk directory
    try {
      fs.rmSync(chunkDir, { recursive: true, force: true });
    } catch (cleanErr) {
      console.warn("Could not remove temp chunk dir:", cleanErr.message);
    }

    let webglEntryUrl = "";
    let playOnlineUrl = "";

    // If this is an HTML5 / WebGL game zip, unpack it and find entry index.html
    if (uploadType === "webgl_zip") {
      const slug = safeGameTitle || `game-${Date.now()}`;
      const extractDir = path.join(webglUploadDir, slug);

      console.log(`[WebGL] Unpacking ${finalFileName} into ${extractDir}...`);
      await extractZip(finalFilePath, extractDir);

      const entryFile = findHtml5EntryPoint(extractDir);
      if (!entryFile) {
        console.warn(`[WebGL] Warning: No index.html found in unpacked archive ${finalFileName}`);
      } else {
        webglEntryUrl = `/uploads/webgl/${slug}/${entryFile}`;
        playOnlineUrl = webglEntryUrl;
        console.log(`[WebGL] Entrypoint located: ${webglEntryUrl}`);
      }
    }

    res.json({
      success: true,
      fileName,
      fileType: ext,
      fileSizeBytes: totalBytes,
      downloadSize: humanSize,
      fileSha256,
      version: version || "1.0.0",
      filePath: targetPublicPath,
      webglEntryUrl,
      playOnlineUrl,
      downloadUrl: `/api/products/download/${safeGameTitle || encodeURIComponent(fileName)}`,
      uploadType: uploadType || (uploadType === "webgl_zip" ? "webgl_zip" : ext === ".exe" ? "executable" : "portable_zip"),
    });
  } catch (err) {
    console.error("[Upload Complete Error]:", err);
    res.status(500).json({ error: err.message });
  }
});

// Direct single file upload route for smaller games (< 200 MB)
router.post("/upload-game-direct", uploadDirect.single("gameFile"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No game file uploaded" });

    const { uploadType, version, gameTitle } = req.body;
    const filePath = req.file.path;
    const ext = path.extname(req.file.originalname).toLowerCase();
    const safeGameTitle = (gameTitle || path.basename(req.file.originalname, ext)).toLowerCase().replace(/[^a-z0-9_-]/g, "-");

    // Calculate SHA-256
    const fileBuffer = await fs.promises.readFile(filePath);
    const hash = crypto.createHash("sha256");
    hash.update(fileBuffer);
    const fileSha256 = hash.digest("hex");
    const totalBytes = fileBuffer.length;
    const humanSize = formatBytes(totalBytes);

    let webglEntryUrl = "";
    let playOnlineUrl = "";

    if (uploadType === "webgl_zip" || ext === ".zip") {
      const slug = safeGameTitle || `game-${Date.now()}`;
      const extractDir = path.join(webglUploadDir, slug);
      await extractZip(filePath, extractDir);
      const entryFile = findHtml5EntryPoint(extractDir);
      if (entryFile) {
        webglEntryUrl = `/uploads/webgl/${slug}/${entryFile}`;
        playOnlineUrl = webglEntryUrl;
      }
    }

    res.json({
      success: true,
      fileName: req.file.originalname,
      fileType: ext,
      fileSizeBytes: totalBytes,
      downloadSize: humanSize,
      fileSha256,
      version: version || "1.0.0",
      filePath: `/uploads/games/${path.basename(filePath)}`,
      webglEntryUrl,
      playOnlineUrl,
      downloadUrl: `/api/products/download/${safeGameTitle}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// STANDARD ADMIN METRICS & PRODUCT MANAGEMENT ROUTES
// ----------------------------------------------------

router.get("/summary", async (req, res) => {
  try {
    const [users, products, orders] = await Promise.all([
      User.countDocuments(),
      Product.countDocuments(),
      Order.countDocuments(),
    ]);
    const revenueData = await Order.find({ orderStatus: { $ne: "cancelled" } }).lean();
    const revenue = revenueData.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
    res.json({ users, products, orders, revenue });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/users", async (req, res) => {
  try {
    const users = await User.find().select("-password").sort({ createdAt: -1 }).lean();
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.patch("/users/:id/role", async (req, res) => {
  try {
    const { role } = req.body;
    if (!["user", "admin"].includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }
    const user = await User.findByIdAndUpdate(req.params.id, { $set: { role } }, { new: true });
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/products", async (req, res) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 }).lean();
    res.json(products);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/products", async (req, res) => {
  try {
    const product = await Product.create(req.body);
    res.status(201).json(product);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put("/products/:id", async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!product) return res.status(404).json({ error: "Product not found" });
    res.json(product);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/products/:id", async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ error: "Product not found" });
    res.json({ message: "Game deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/orders", async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 }).lean();
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.patch("/orders/:id/status", async (req, res) => {
  try {
    const { paymentStatus, orderStatus } = req.body;
    const update = {};
    if (paymentStatus !== undefined) update.paymentStatus = paymentStatus;
    if (orderStatus !== undefined) update.orderStatus = orderStatus;
    const order = await Order.findByIdAndUpdate(req.params.id, { $set: update }, { new: true });
    if (!order) return res.status(404).json({ error: "Order not found" });
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/addresses", async (req, res) => {
  try {
    const addresses = await Address.find().sort({ createdAt: -1 }).lean();
    res.json(addresses);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Image / Cover Art upload
router.post("/upload", uploadImage.single("image"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No image file uploaded" });
  }
  const publicPath = `/uploads/${req.file.filename}`;
  res.json({ imageUrl: publicPath });
});

export default router;
