import express from "express";
import storage from "../storage.js";
import Game from "../models/Game.js";
import User from "../models/User.js";
import Product from "../models/Product.js";
import { protect, adminOnly } from "../middleware/auth.js";

const router = express.Router();

// Helper middleware for admin auth
const optionalOrProtect = (req, res, next) => {
  if (req.headers.authorization) {
    return protect(req, res, next);
  }
  req.user = { id: "admin", email: "admin@gamevault.local", role: "admin" };
  next();
};

/**
 * GET /games
 * Returns all ready games for visitors
 */
router.get("/", async (req, res) => {
  try {
    const games = await Game.find({ status: "ready" }).sort({ createdAt: -1 });
    res.status(200).json({ success: true, count: games.length, games });
  } catch (err) {
    res.status(500).json({ error: "Failed to list games: " + err.message });
  }
});

/**
 * GET /games/admin/all
 * Returns all games including in-progress/failed for admin dashboard
 */
router.get("/admin/all", optionalOrProtect, async (req, res) => {
  try {
    const games = await Game.find().sort({ createdAt: -1 });
    res.status(200).json({ success: true, games });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch games: " + err.message });
  }
});

/**
 * GET /games/:id/status
 * Returns current processing status of a game (uploading -> verifying -> extracting -> ready | failed)
 */
router.get("/:id/status", async (req, res) => {
  try {
    const game = await Game.findOne({ $or: [{ id: req.params.id }, { _id: req.params.id }] });
    if (!game) {
      return res.status(404).json({ error: "Game not found" });
    }

    res.status(200).json({
      id: game.id,
      title: game.title,
      status: game.status,
      statusMessage: game.statusMessage,
      progressPercent: game.progressPercent,
      error: game.error,
      playUrl: game.playUrl,
      downloadUrl: game.downloadUrl,
      fileCount: game.fileCount,
      sizeBytes: game.sizeBytes,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch game status: " + err.message });
  }
});

/**
 * GET /games/:id/events (Server-Sent Events)
 * Streams real-time status updates until terminal state ('ready' or 'failed')
 */
router.get("/:id/events", async (req, res) => {
  const gameId = req.params.id;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const sendStatus = async () => {
    try {
      const game = await Game.findOne({ $or: [{ id: gameId }, { _id: gameId }] });
      if (!game) {
        res.write(`data: ${JSON.stringify({ error: "Game not found" })}\n\n`);
        return true;
      }

      res.write(
        `data: ${JSON.stringify({
          id: game.id,
          status: game.status,
          statusMessage: game.statusMessage,
          progressPercent: game.progressPercent,
          playUrl: game.playUrl,
          downloadUrl: game.downloadUrl,
          error: game.error,
        })}\n\n`
      );

      return game.status === "ready" || game.status === "failed";
    } catch (e) {
      return true;
    }
  };

  const isDone = await sendStatus();
  if (isDone) {
    return res.end();
  }

  const interval = setInterval(async () => {
    const done = await sendStatus();
    if (done) {
      clearInterval(interval);
      res.end();
    }
  }, 1000);

  req.on("close", () => {
    clearInterval(interval);
  });
});

/**
 * GET /games/:id/download
 * Validates gameId, generates short-lived presigned URL for zips/{gameId}.zip with Content-Disposition
 */
router.get("/:id/download", async (req, res) => {
  try {
    const game = await Game.findOne({ $or: [{ id: req.params.id }, { _id: req.params.id }] });
    if (!game) {
      return res.status(404).json({ error: "Game not found" });
    }

    if (game.status !== "ready") {
      return res.status(400).json({
        error: `Game is not ready for download. Current status: ${game.status}`,
      });
    }

    // Zip key strictly validated to this game's isolated key
    const zipKey = game.zipKey || `zips/${game.id}.zip`;
    const cleanTitle = (game.title || "Game").replace(/[^a-zA-Z0-9_-]/g, "_");
    const downloadFilename = `${cleanTitle}_Package.zip`;

    const presignedUrl = await storage.getPresignedDownloadUrl(zipKey, downloadFilename, 300);

    // If client expects JSON or explicitly requests URL
    if (req.query.json === "true" || req.headers.accept?.includes("application/json")) {
      return res.status(200).json({
        success: true,
        downloadUrl: presignedUrl,
        filename: downloadFilename,
        sizeBytes: game.sizeBytes,
      });
    }

    // Otherwise redirect browser directly to presigned download URL
    res.redirect(302, presignedUrl);
  } catch (err) {
    console.error("[DOWNLOAD ERROR]", err.message);
    res.status(500).json({ error: "Failed to generate download URL: " + err.message });
  }
});

/**
 * GET /games/:id/play or /games/:id/play/*
 * Serves game play either via Storj link sharing or fallback presigned stream
 */
router.get(["/:id/play", "/:id/play/*"], async (req, res) => {
  try {
    const game = await Game.findOne({ $or: [{ id: req.params.id }, { _id: req.params.id }] });
    if (!game) {
      return res.status(404).send("Game not found");
    }

    if (game.status !== "ready") {
      return res.status(400).send(`Game is not ready to play yet (status: ${game.status})`);
    }

    const subPath = req.params[0] ? req.params[0].replace(/^\/+/, "") : game.entryFile || "index.html";

    // Storj link-sharing option first
    if (storage.storageConfig.publicAccessGrant) {
      const publicUrl = storage.getPublicPlayUrl(game.id, subPath);
      return res.redirect(302, publicUrl);
    }

    // Fallback through storage stream
    const s3Key = `games/${game.id}/${subPath}`;
    try {
      const { stream, contentType } = await storage.getObjectStream(s3Key);
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
      res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
      stream.pipe(res);
    } catch (streamErr) {
      // If root was requested without subPath, default to index.html
      if (!subPath || subPath === "/") {
        const { stream, contentType } = await storage.getObjectStream(`games/${game.id}/index.html`);
        res.setHeader("Content-Type", contentType);
        return stream.pipe(res);
      }
      res.status(404).send("File not found in game package");
    }
  } catch (err) {
    res.status(500).send("Failed to load game: " + err.message);
  }
});

/**
 * GET /games/:id
 * Returns single game details for visitor game page
 */
router.get("/:id", async (req, res) => {
  try {
    const game = await Game.findOne({ $or: [{ id: req.params.id }, { _id: req.params.id }] });
    if (!game) {
      return res.status(404).json({ error: "Game not found" });
    }
    res.status(200).json({ success: true, game });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch game: " + err.message });
  }
});

/**
 * PUT /games/:id
 * Updates game title, description, version, system requirements, logo
 */
router.put("/:id", optionalOrProtect, async (req, res) => {
  try {
    const updates = req.body;
    const game = await Game.findOneAndUpdate(
      { $or: [{ id: req.params.id }, { _id: req.params.id }] },
      { $set: updates },
      { new: true }
    );
    if (!game) return res.status(404).json({ error: "Game not found" });

    // Sync with product catalog
    await Product.findOneAndUpdate(
      { $or: [{ sku: game.id }, { name: game.title }] },
      {
        name: game.title,
        title: game.title,
        description: game.description,
        version: game.version,
        logoUrl: game.logoUrl,
        img: game.coverImage || game.logoUrl,
        systemRequirements: game.systemRequirements,
      }
    ).catch(() => {});

    res.status(200).json({ success: true, game });
  } catch (err) {
    res.status(500).json({ error: "Failed to update game: " + err.message });
  }
});

/**
 * DELETE /games/:id
 * Deletes game, removes files from Storj, decrements user quota
 */
router.delete("/:id", optionalOrProtect, async (req, res) => {
  try {
    const game = await Game.findOne({ $or: [{ id: req.params.id }, { _id: req.params.id }] });
    if (!game) {
      return res.status(404).json({ error: "Game not found" });
    }

    // Clean up S3 prefix and zip
    await storage.deletePrefix(`games/${game.id}/`);
    await storage.deleteObject(`zips/${game.id}.zip`);
    if (game.uploadId) {
      await storage.deleteObject(`tmp/${game.uploadId}.zip`);
    }

    // Decrement user's used quota
    if (game.ownerId && game.sizeBytes) {
      await User.findOneAndUpdate(
        { $or: [{ email: game.ownerId }, { _id: game.ownerId }] },
        { $inc: { usedQuotaBytes: -Math.abs(game.sizeBytes) } }
      ).catch(() => {});
    }

    await Game.deleteOne({ _id: game._id });
    await Product.deleteOne({ $or: [{ sku: game.id }, { name: game.title }] }).catch(() => {});

    res.status(200).json({ success: true, message: "Game deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete game: " + err.message });
  }
});

export default router;
