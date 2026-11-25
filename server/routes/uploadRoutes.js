import express from "express";
import { v4 as uuidv4 } from "uuid";
import storage, { MAX_GAME_SIZE_BYTES, USER_QUOTA_BYTES, PART_SIZE_BYTES } from "../storage.js";
import Game from "../models/Game.js";
import User from "../models/User.js";
import { protect } from "../middleware/auth.js";
import processingQueue from "../worker.js";

const router = express.Router();

// Helper middleware for auth (allows admin/token or fallback for testing)
const optionalOrProtect = (req, res, next) => {
  if (req.headers.authorization) {
    return protect(req, res, next);
  }
  // In development/local admin testing, assign default admin
  req.user = { id: "admin", email: "admin@gamevault.local", role: "admin" };
  next();
};

/**
 * POST /uploads/init
 * Authenticates user, checks size against MAX_GAME_SIZE_GB (10 GB) and USER_QUOTA_GB (50 GB),
 * initializes S3 multipart upload with key "zips/{gameId}.zip" directly for bit-perfect download package.
 */
router.post("/init", optionalOrProtect, async (req, res) => {
  try {
    const { filename, size, title, description, version, systemRequirements, logoUrl, coverImage, genre } = req.body;

    // Validate filename & extension
    if (!filename || !filename.toLowerCase().endsWith(".zip")) {
      return res.status(400).json({ error: "Invalid file type. Only .zip archives are supported." });
    }

    const declaredSize = Number(size) || 0;
    if (declaredSize <= 0) {
      return res.status(400).json({ error: "Invalid or missing file size." });
    }

    // 10 GB limit validation
    if (declaredSize > MAX_GAME_SIZE_BYTES) {
      return res.status(400).json({
        error: `File size (${(declaredSize / (1024 * 1024 * 1024)).toFixed(2)} GB) exceeds the maximum allowed limit of 10 GB.`,
      });
    }

    // Check user quota (50 GB)
    const userEmail = req.user?.email || "admin@gamevault.local";
    let user = await User.findOne({ $or: [{ email: userEmail }, { _id: req.user?.id }] });
    const currentQuota = user?.usedQuotaBytes || 0;

    if (currentQuota + declaredSize > USER_QUOTA_BYTES) {
      return res.status(400).json({
        error: `Upload would exceed your storage quota of 50 GB. Currently used: ${(currentQuota / (1024 * 1024 * 1024)).toFixed(2)} GB.`,
      });
    }

    const uploadId = uuidv4();
    const gameId = req.body.gameId || uuidv4();
    const key = `zips/${gameId}.zip`;

    // Initialize multipart upload on Storj / S3 directly at zips/{gameId}.zip
    const initResult = await storage.initMultipartUpload(key);

    const partSize = PART_SIZE_BYTES; // 64 MB
    const partCount = Math.ceil(declaredSize / partSize);

    if (partCount > 10000) {
      await storage.abortMultipartUpload(key, initResult.uploadId);
      return res.status(400).json({ error: "File requires more than 10,000 parts. Increase PART_SIZE_MB." });
    }

    // Save initial game record
    const game = await Game.findOneAndUpdate(
      { id: gameId },
      {
        id: gameId,
        title: title || filename.replace(/\.zip$/i, ""),
        description: description || "",
        version: version || "1.0.0",
        systemRequirements: systemRequirements || "Windows 10/11 64-bit, 8GB RAM",
        logoUrl: logoUrl || "",
        coverImage: coverImage || "",
        ownerId: userEmail,
        sizeBytes: declaredSize,
        status: "uploading",
        statusMessage: "Uploading chunks directly to storage...",
        progressPercent: 0,
        uploadId: initResult.uploadId,
        zipKey: key,
      },
      { upsert: true, new: true }
    );

    res.status(200).json({
      success: true,
      uploadId: initResult.uploadId,
      gameId: game.id,
      key,
      partSize,
      partCount,
      totalSize: declaredSize,
    });
  } catch (err) {
    console.error("[UPLOAD INIT ERROR]", err.message);
    res.status(500).json({ error: "Failed to initialize upload: " + err.message });
  }
});

/**
 * POST /uploads/sign-part
 * Generates presigned UploadPart URL per partNumber (expires in 1 hour)
 */
router.post("/sign-part", optionalOrProtect, async (req, res) => {
  try {
    const { uploadId, key, partNumber } = req.body;

    if (!uploadId || !key || !partNumber) {
      return res.status(400).json({ error: "Missing uploadId, key, or partNumber" });
    }

    const url = await storage.getPresignedPartUrl(key, uploadId, Number(partNumber), 3600);
    res.status(200).json({
      success: true,
      url,
      partNumber: Number(partNumber),
    });
  } catch (err) {
    console.error("[SIGN PART ERROR]", err.message);
    res.status(500).json({ error: "Failed to generate presigned part URL: " + err.message });
  }
});

/**
 * PUT /uploads/proxy-part
 * Streaming proxy fallback for when browser direct PUT hits CORS on Storj gateway
 */
router.put("/proxy-part", optionalOrProtect, async (req, res) => {
  try {
    const uploadId = req.query.uploadId || req.headers["x-upload-id"];
    const key = req.query.key || req.headers["x-key"];
    const partNumber = req.query.partNumber || req.headers["x-part-number"];
    const contentLength = Number(req.headers["content-length"]) || undefined;

    if (!uploadId || !key || !partNumber) {
      return res.status(400).json({ error: "Missing uploadId, key, or partNumber for proxy upload" });
    }

    // Stream directly into Storj part without buffering in memory
    const etag = await storage.uploadPartStream(key, uploadId, Number(partNumber), req, contentLength);

    res.setHeader("ETag", etag);
    res.status(200).json({
      success: true,
      ETag: etag,
      partNumber: Number(partNumber),
    });
  } catch (err) {
    console.error("[PROXY PART ERROR]", err.message);
    res.status(500).json({ error: "Streaming proxy failed: " + err.message });
  }
});

/**
 * POST /uploads/complete
 * Receives [{PartNumber, ETag}], calls CompleteMultipartUpload, enqueues processing job
 */
router.post("/complete", optionalOrProtect, async (req, res) => {
  try {
    const { uploadId, key, parts, gameId, gameData = {} } = req.body;

    if (!uploadId || !key || !Array.isArray(parts) || parts.length === 0) {
      return res.status(400).json({ error: "Missing uploadId, key, or valid parts array" });
    }

    // Complete multipart upload on Storj
    await storage.completeMultipartUpload(key, uploadId, parts);

    // Update game status to verifying
    const game = await Game.findOne({ $or: [{ id: gameId }, { uploadId }] });
    if (game) {
      game.status = "verifying";
      game.statusMessage = "Upload completed. Verifying game package security...";
      game.progressPercent = 10;
      game.zipKey = key;
      if (gameData.title) game.title = gameData.title;
      if (gameData.description) game.description = gameData.description;
      if (gameData.version) game.version = gameData.version;
      if (gameData.logoUrl) game.logoUrl = gameData.logoUrl;
      if (gameData.coverImage) game.coverImage = gameData.coverImage;
      if (gameData.systemRequirements) game.systemRequirements = gameData.systemRequirements;
      await game.save();
    }

    // Enqueue background processing extraction job
    const effectiveGameId = game ? game.id : gameId || uuidv4();
    processingQueue
      .enqueue({
        gameId: effectiveGameId,
        uploadId,
        key,
        title: game?.title || gameData.title || "Game Package",
        ownerId: req.user?.email || "admin@gamevault.local",
        sizeBytes: game?.sizeBytes || 0,
        metadata: gameData,
      })
      .catch((err) => {
        console.error(`[BACKGROUND WORKER ERROR] Game ${effectiveGameId} error:`, err.message);
      });

    res.status(200).json({
      success: true,
      gameId: effectiveGameId,
      status: "verifying",
      message: "Upload completed. Package verification enqueued.",
    });
  } catch (err) {
    console.error("[UPLOAD COMPLETE ERROR]", err.message);
    res.status(500).json({ error: "Failed to complete upload: " + err.message });
  }
});

/**
 * POST /uploads/abort
 * Aborts a multipart upload
 */
router.post("/abort", optionalOrProtect, async (req, res) => {
  try {
    const { uploadId, key } = req.body;
    if (uploadId && key) {
      await storage.abortMultipartUpload(key, uploadId);
      await Game.findOneAndUpdate({ uploadId }, { status: "failed", error: "Upload aborted by user" });
    }
    res.status(200).json({ success: true, message: "Upload aborted" });
  } catch (err) {
    console.warn("[UPLOAD ABORT WARN]", err.message);
    res.status(200).json({ success: true, warning: err.message });
  }
});

export default router;
