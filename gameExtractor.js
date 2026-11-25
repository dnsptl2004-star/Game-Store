import unzipper from "unzipper";
import mime from "mime-types";
import { createRequire } from "module";
import { PassThrough } from "stream";
import storage from "./storage.js";
import Game from "./models/Game.js";
import User from "./models/User.js";
import Product from "./models/Product.js";

const require = createRequire(import.meta.url);
const archiverPkg = require("archiver");

/**
 * Creates an archiver zip stream with ZIP64 enabled to support packages > 4GB
 */
export const createZipStream = (options = {}) => {
  const opts = { forceZip64: true, store: true, zlib: { level: 0 }, ...options };
  if (archiverPkg.ZipArchive) return new archiverPkg.ZipArchive(opts);
  if (typeof archiverPkg === "function") return archiverPkg("zip", opts);
  if (archiverPkg.create) return archiverPkg.create("zip", opts);
  throw new Error("Unable to initialize zip stream");
};

// Security & Zip-Bomb Constants
const MAX_UNCOMPRESSED_BYTES = 20 * 1024 * 1024 * 1024; // 20 GB
const MAX_FILE_COUNT = 100000; // 100,000 files
const MAX_RATIO = 100; // 100:1 compression ratio
const FORBIDDEN_EXT_REGEX = /\.(exe|sh|bat|cmd|php|phtml|vbs|ps1|com|scr|msi)$/i;
const SERVER_SCRIPT_REGEX = /\.(php[0-9]?|phtml|phar|cgi|pl|jsp|asp|aspx)$/i;
const JUNK_REGEX = /(^|\/)(node_modules|\.git|__MACOSX|\.DS_Store|Thumbs\.db|\.env)(\/|$)/i;

/**
 * Checks if path contains path traversal / zip-slip attempts
 */
export function isZipSlip(entryPath) {
  if (!entryPath) return true;
  const normalized = entryPath.replace(/\\/g, "/");
  if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) {
    return true; // Absolute path
  }
  const parts = normalized.split("/");
  let depth = 0;
  for (const part of parts) {
    if (part === "..") {
      depth--;
      if (depth < 0) return true; // Traverse above root
    } else if (part !== "." && part !== "") {
      depth++;
    }
  }
  return false;
}

/**
 * Normalizes entry path and checks if it's junk
 */
function isJunk(entryPath) {
  const normalized = entryPath.replace(/\\/g, "/");
  if (JUNK_REGEX.test(normalized)) return true;
  if (normalized.endsWith("/.env") || normalized === ".env") return true;
  return false;
}

/**
 * Checks if entry is a dangerous executable or script
 */
function isForbiddenExecutable(entryPath) {
  return FORBIDDEN_EXT_REGEX.test(entryPath);
}

/**
 * Determines content type with WebGL and game extensions
 */
function getContentType(filePath) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".wasm")) return "application/wasm";
  if (lower.endsWith(".data") || lower.endsWith(".bundle")) return "application/octet-stream";
  if (lower.endsWith(".js")) return "application/javascript";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html; charset=utf-8";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".css")) return "text/css";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return mime.lookup(filePath) || "application/octet-stream";
}

/**
 * Scans the zip stream to verify security rules, zip bomb limits, wrapper folder, and index.html
 */
export async function verifyZipArchive(zipKey, compressedSizeBytes, options = {}) {
  const isPCGame = options.isPCGame || options.category === "PC Games" || options.uploadType === "portable_zip";
  const { stream } = await storage.getObjectStream(zipKey);

  let fileCount = 0;
  let uncompressedTotal = 0;
  const nonJunkEntries = [];

  const zipParse = stream.pipe(unzipper.Parse({ forceStream: true }));

  for await (const entry of zipParse) {
    const rawPath = entry.path;
    const type = entry.type; // 'File' or 'Directory'

    // 1. Check for Zip-slip
    if (isZipSlip(rawPath)) {
      entry.autodrain();
      throw new Error(`Security rejection: Zip-slip path traversal detected in "${rawPath}"`);
    }

    // 2. Check for Symlinks
    if (type === "SymbolicLink") {
      entry.autodrain();
      throw new Error(`Security rejection: Symbolic links are forbidden in "${rawPath}"`);
    }

    // 3. Skip junk entries
    if (isJunk(rawPath)) {
      entry.autodrain();
      continue;
    }

    if (type === "Directory") {
      entry.autodrain();
      continue;
    }

    // 4. Check for forbidden executables / dangerous scripts
    if (!isPCGame && isForbiddenExecutable(rawPath)) {
      entry.autodrain();
      throw new Error(`Security rejection: Executable or script file "${rawPath}" is not permitted`);
    }

    if (isPCGame && SERVER_SCRIPT_REGEX.test(rawPath)) {
      entry.autodrain();
      throw new Error(`Security rejection: Web script file "${rawPath}" is not permitted`);
    }

    // 5. Track sizes and counts for Zip-bomb check
    fileCount++;
    const entrySize = entry.vars?.uncompressedSize || 0;
    uncompressedTotal += entrySize;

    if (fileCount > MAX_FILE_COUNT) {
      entry.autodrain();
      throw new Error(`Zip-bomb rejection: File count exceeded limit (${MAX_FILE_COUNT.toLocaleString()})`);
    }

    if (uncompressedTotal > MAX_UNCOMPRESSED_BYTES) {
      entry.autodrain();
      throw new Error(`Zip-bomb rejection: Uncompressed size exceeded 20 GB`);
    }

    if (compressedSizeBytes > 0 && uncompressedTotal / compressedSizeBytes > MAX_RATIO) {
      entry.autodrain();
      throw new Error(`Zip-bomb rejection: Compression ratio exceeded 100:1`);
    }

    nonJunkEntries.push(rawPath.replace(/\\/g, "/"));
    entry.autodrain();
  }

  if (fileCount === 0) {
    throw new Error("Zip archive contains no valid files");
  }

  // Detect single top-level wrapper folder
  let wrapperPrefix = "";
  const firstParts = nonJunkEntries.map((p) => p.split("/")[0]);
  const candidate = firstParts[0];
  if (candidate && firstParts.every((p) => p === candidate)) {
    wrapperPrefix = candidate + "/";
  }

  // Check if index.html exists
  const hasIndexHtml = nonJunkEntries.some((p) => {
    const relative = wrapperPrefix ? p.slice(wrapperPrefix.length) : p;
    return relative.toLowerCase() === "index.html";
  });

  if (!isPCGame && !hasIndexHtml) {
    throw new Error('Invalid game package: missing required "index.html" at game root');
  }

  return {
    fileCount,
    uncompressedTotal,
    wrapperPrefix,
    hasIndexHtml,
    isWebGame: hasIndexHtml,
    validEntries: nonJunkEntries,
  };
}

/**
 * Extracts the verified zip into games/{gameId}/, unwrapping top-level wrapper
 */
export async function extractAndDeployGame(gameId, tmpKey, verification) {
  const { wrapperPrefix, hasIndexHtml } = verification;
  const gamePrefix = `games/${gameId}/`;
  const cleanZipKey = `zips/${gameId}.zip`;

  // Remove previous version if re-uploading
  await storage.deletePrefix(gamePrefix);

  const { stream } = await storage.getObjectStream(tmpKey);
  const zipParse = stream.pipe(unzipper.Parse({ forceStream: true }));

  const extractedKeys = [];
  let extractedCount = 0;

  for await (const entry of zipParse) {
    const rawPath = entry.path;
    const type = entry.type;

    if (type === "Directory" || isJunk(rawPath) || isZipSlip(rawPath)) {
      entry.autodrain();
      continue;
    }

    const normalized = rawPath.replace(/\\/g, "/");
    const cleanRelativePath = wrapperPrefix && normalized.startsWith(wrapperPrefix)
      ? normalized.slice(wrapperPrefix.length)
      : normalized;

    if (!cleanRelativePath || cleanRelativePath.endsWith("/")) {
      entry.autodrain();
      continue;
    }

    const s3Key = `${gamePrefix}${cleanRelativePath}`;
    const contentType = getContentType(cleanRelativePath);

    // Stream entry directly into S3 using putObjectStream without memory buffering
    await storage.putObjectStream(s3Key, entry, contentType);
    extractedKeys.push({ s3Key, relativePath: cleanRelativePath });
    extractedCount++;
  }

  // Build clean download zip "zips/{gameId}.zip" containing only this game's unwrapped files
  // If the uploaded file is already clean (no wrapper prefix) and already at cleanZipKey, use it directly
  if (tmpKey === cleanZipKey && !wrapperPrefix) {
    // Already bit-perfect and in place
  } else if (!wrapperPrefix && tmpKey.startsWith("tmp/")) {
    // No wrapper folder: copy directly to cleanZipKey without re-compressing
    try {
      await storage.copyObject(tmpKey, cleanZipKey);
    } catch (e) {
      // If copy fails, fallback to streaming repackage
      await repackageZip(cleanZipKey, extractedKeys);
    }
  } else {
    // Top-level wrapper present: repackage with ZIP64 enabled
    await repackageZip(cleanZipKey, extractedKeys);
  }

  // Clean up temporary upload if separate
  if (tmpKey !== cleanZipKey) {
    await storage.deleteObject(tmpKey).catch(() => {});
  }

  return {
    extractedCount,
    cleanZipKey,
    gamePrefix,
    hasIndexHtml,
  };
}

async function repackageZip(cleanZipKey, extractedKeys) {
  await storage.deleteObject(cleanZipKey).catch(() => {});

  const archive = createZipStream({ store: true, forceZip64: true });
  const passThrough = new PassThrough();
  archive.pipe(passThrough);

  const uploadPromise = storage.putObjectStream(cleanZipKey, passThrough, "application/zip");

  for (const item of extractedKeys) {
    const { stream: fileStream } = await storage.getObjectStream(item.s3Key);
    archive.append(fileStream, { name: item.relativePath });
  }

  await archive.finalize();
  await uploadPromise;
}

/**
 * Full game processing job orchestrator
 */
export async function processGameJob(jobData) {
  const { gameId, uploadId, key, title, ownerId, sizeBytes, metadata = {} } = jobData;

  const targetZipKey = key || `zips/${gameId}.zip`;
  console.log(`[PROCESSOR] Starting processing for game: "${title}" (${gameId}) at ${targetZipKey}`);

  let game = await Game.findOne({ id: gameId });
  if (!game) {
    game = new Game({
      id: gameId,
      title: title || "Untitled Game",
      ownerId: ownerId || "admin",
      sizeBytes: sizeBytes || 0,
      status: "verifying",
      statusMessage: "Verifying package integrity and security...",
      uploadId,
      zipKey: targetZipKey,
      logoUrl: metadata.logoUrl || "",
      coverImage: metadata.coverImage || "",
      description: metadata.description || "",
      version: metadata.version || "1.0.0",
      systemRequirements: metadata.systemRequirements || "Windows 10/11 64-bit, 8GB RAM",
    });
    await game.save();
  } else {
    game.status = "verifying";
    game.statusMessage = "Verifying package integrity and security...";
    game.zipKey = targetZipKey;
    game.error = "";
    await game.save();
  }

  try {
    // Determine if this is a PC game or WebGL game from metadata or title
    const isPC = metadata.category === "PC Games" ||
                 metadata.uploadType === "portable_zip" ||
                 metadata.uploadType === "executable" ||
                 (title && /gta|vice city|pc game/i.test(title));

    // 1. Verification Phase
    const verification = await verifyZipArchive(targetZipKey, sizeBytes, { isPCGame: isPC });
    console.log(
      `[PROCESSOR] Verification passed: ${verification.fileCount} files, WebGL: ${verification.hasIndexHtml}`
    );

    // 2. Extraction Phase
    game.status = "extracting";
    game.statusMessage = verification.hasIndexHtml
      ? "Extracting files for web play and download..."
      : "Verifying PC game files for direct download...";
    game.progressPercent = 40;
    await game.save();

    let deployment;
    if (isPC && !verification.hasIndexHtml) {
      // Direct PC Game package: the upload at targetZipKey is already the bit-perfect download package
      const cleanZipKey = `zips/${gameId}.zip`;
      if (targetZipKey !== cleanZipKey) {
        try {
          await storage.copyObject(targetZipKey, cleanZipKey);
          await storage.deleteObject(targetZipKey).catch(() => {});
        } catch (e) {}
      }
      deployment = {
        extractedCount: verification.fileCount,
        cleanZipKey,
        gamePrefix: `games/${gameId}/`,
        hasIndexHtml: false,
      };
    } else {
      deployment = await extractAndDeployGame(gameId, targetZipKey, verification);
    }

    console.log(`[PROCESSOR] Deployed ${deployment.extractedCount} files for ${gameId}`);

    // 3. Ready Phase
    const playUrl = verification.hasIndexHtml ? storage.getPublicPlayUrl(gameId, "index.html") : "";
    const downloadUrl = `/api/games/${gameId}/download`;

    game.status = "ready";
    game.statusMessage = verification.hasIndexHtml
      ? "Ready to play and download"
      : "Ready for download (PC Game package verified)";
    game.progressPercent = 100;
    game.fileCount = deployment.extractedCount;
    game.uncompressedSizeBytes = verification.uncompressedTotal;
    game.entryFile = verification.hasIndexHtml ? "index.html" : "";
    game.s3Prefix = deployment.gamePrefix;
    game.zipKey = deployment.cleanZipKey;
    game.playUrl = playUrl;
    game.downloadUrl = downloadUrl;
    await game.save();

    // Update user quota
    if (ownerId) {
      await User.findOneAndUpdate(
        { $or: [{ email: ownerId }, { _id: ownerId }] },
        { $inc: { usedQuotaBytes: sizeBytes } }
      ).catch(() => {});
    }

    // Sync/Upsert Product in store catalog
    try {
      await Product.findOneAndUpdate(
        { $or: [{ sku: gameId }, { name: title }] },
        {
          name: title,
          title: title,
          description: metadata.description || game.description || "Exciting interactive game package",
          version: metadata.version || game.version,
          logoUrl: metadata.logoUrl || game.logoUrl || "https://images.unsplash.com/photo-1612287232230-050410425e40?auto=format&fit=crop&q=80&w=256",
          img: metadata.coverImage || game.coverImage || metadata.logoUrl || game.logoUrl,
          category: verification.hasIndexHtml ? "Indie & HTML5" : "PC Games",
          platform: verification.hasIndexHtml ? "PC & Web Browser" : "PC (Windows 10/11)",
          genre: metadata.genre || "Action & Adventure",
          isFree: true,
          inStock: true,
          isDownloadable: true,
          isOnlinePlayable: verification.hasIndexHtml,
          playOnlineUrl: playUrl,
          downloadUrl: downloadUrl,
          storageProvider: "s3",
          storageUrl: deployment.cleanZipKey,
          webglEntryUrl: playUrl,
          fileName: `${title.replace(/[^a-zA-Z0-9_-]/g, "_")}_Package.zip`,
          fileSizeBytes: sizeBytes,
          downloadSize: `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`,
          sku: gameId,
          systemRequirements: metadata.systemRequirements || game.systemRequirements,
        },
        { upsert: true, new: true }
      );
    } catch (prodErr) {
      console.warn("[PROCESSOR] Product catalog sync warning:", prodErr.message);
    }

    console.log(`[PROCESSOR] Game "${title}" (${gameId}) successfully deployed and ready!`);
    return { success: true, gameId, playUrl, downloadUrl };
  } catch (err) {
    console.error(`[PROCESSOR ERROR] Processing failed for game ${gameId}:`, err.message);

    // Cleanup partial files on failure
    await storage.deletePrefix(`games/${gameId}/`).catch(() => {});
    await storage.deleteObject(`zips/${gameId}.zip`).catch(() => {});
    if (targetZipKey !== `zips/${gameId}.zip`) {
      await storage.deleteObject(targetZipKey).catch(() => {});
    }

    game.status = "failed";
    game.statusMessage = err.message;
    game.error = err.message;
    game.progressPercent = 0;
    await game.save();

    throw err;
  }
}

export default {
  verifyZipArchive,
  extractAndDeployGame,
  processGameJob,
};
