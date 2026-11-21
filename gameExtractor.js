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
const createZipStream = (options = { store: true }) => {
  if (archiverPkg.ZipArchive) return new archiverPkg.ZipArchive(options);
  if (typeof archiverPkg === "function") return archiverPkg("zip", options);
  if (archiverPkg.create) return archiverPkg.create("zip", options);
  throw new Error("Unable to initialize zip stream");
};

// Security & Zip-Bomb Constants
const MAX_UNCOMPRESSED_BYTES = 20 * 1024 * 1024 * 1024; // 20 GB
const MAX_FILE_COUNT = 100000; // 100,000 files
const MAX_RATIO = 100; // 100:1 compression ratio
const FORBIDDEN_EXT_REGEX = /\.(exe|sh|bat|cmd|php|phtml|vbs|ps1|com|scr|msi)$/i;
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
 * Checks if entry is an executable or dangerous script
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
export async function verifyZipArchive(tmpKey, compressedSizeBytes) {
  const { stream } = await storage.getObjectStream(tmpKey);

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

    // 4. Check for forbidden executables
    if (isForbiddenExecutable(rawPath)) {
      entry.autodrain();
      throw new Error(`Security rejection: Executable or script file "${rawPath}" is not permitted`);
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
    // All entries are inside candidate/
    wrapperPrefix = candidate + "/";
  }

  // Verify that index.html exists at the unwrapped root
  const hasIndexHtml = nonJunkEntries.some((p) => {
    const relative = wrapperPrefix ? p.slice(wrapperPrefix.length) : p;
    return relative.toLowerCase() === "index.html";
  });

  if (!hasIndexHtml) {
    throw new Error('Invalid game package: missing required "index.html" at game root');
  }

  return {
    fileCount,
    uncompressedTotal,
    wrapperPrefix,
    validEntries: nonJunkEntries,
  };
}

/**
 * Extracts the verified zip into games/{gameId}/, unwrapping top-level wrapper
 */
export async function extractAndDeployGame(gameId, tmpKey, verification) {
  const { wrapperPrefix } = verification;
  const gamePrefix = `games/${gameId}/`;

  // Remove previous version if re-uploading
  await storage.deletePrefix(gamePrefix);

  const { stream } = await storage.getObjectStream(tmpKey);
  const zipParse = stream.pipe(unzipper.Parse({ forceStream: true }));

  const extractedKeys = [];
  let extractedCount = 0;

  for await (const entry of zipParse) {
    const rawPath = entry.path;
    const type = entry.type;

    if (type === "Directory" || isJunk(rawPath) || isForbiddenExecutable(rawPath) || isZipSlip(rawPath)) {
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
  const cleanZipKey = `zips/${gameId}.zip`;
  await storage.deleteObject(cleanZipKey);

  const archive = createZipStream({ store: true });
  const passThrough = new PassThrough();
  archive.pipe(passThrough);

  const uploadPromise = storage.putObjectStream(cleanZipKey, passThrough, "application/zip");

  for (const item of extractedKeys) {
    const { stream: fileStream } = await storage.getObjectStream(item.s3Key);
    archive.append(fileStream, { name: item.relativePath });
  }

  await archive.finalize();
  await uploadPromise;

  // Clean up temporary upload
  await storage.deleteObject(tmpKey);

  return {
    extractedCount,
    cleanZipKey,
    gamePrefix,
  };
}

/**
 * Full game processing job orchestrator
 */
export async function processGameJob(jobData) {
  const { gameId, uploadId, title, ownerId, sizeBytes, metadata = {} } = jobData;

  const tmpKey = `tmp/${uploadId}.zip`;
  console.log(`[PROCESSOR] Starting processing for game: "${title}" (${gameId})`);

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
    game.error = "";
    await game.save();
  }

  try {
    // 1. Verification Phase
    const verification = await verifyZipArchive(tmpKey, sizeBytes);
    console.log(
      `[PROCESSOR] Verification passed: ${verification.fileCount} files, unwrapping prefix: "${verification.wrapperPrefix}"`
    );

    // 2. Extraction Phase
    game.status = "extracting";
    game.statusMessage = "Extracting files to cloud storage...";
    game.progressPercent = 40;
    await game.save();

    const deployment = await extractAndDeployGame(gameId, tmpKey, verification);
    console.log(`[PROCESSOR] Extracted and deployed ${deployment.extractedCount} files for ${gameId}`);

    // 3. Ready Phase
    const playUrl = storage.getPublicPlayUrl(gameId, "index.html");
    const downloadUrl = `/api/games/${gameId}/download`;

    game.status = "ready";
    game.statusMessage = "Ready to play and download";
    game.progressPercent = 100;
    game.fileCount = deployment.extractedCount;
    game.uncompressedSizeBytes = verification.uncompressedTotal;
    game.entryFile = "index.html";
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
          description: metadata.description || game.description || "Exciting interactive PC & Web game",
          version: metadata.version || game.version,
          logoUrl: metadata.logoUrl || game.logoUrl || "https://images.unsplash.com/photo-1612287232230-050410425e40?auto=format&fit=crop&q=80&w=256",
          img: metadata.coverImage || game.coverImage || metadata.logoUrl || game.logoUrl,
          category: "PC Games",
          platform: "PC (Windows 10/11) & Web",
          genre: metadata.genre || "Action",
          isFree: true,
          inStock: true,
          isDownloadable: true,
          isOnlinePlayable: true,
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
    await storage.deleteObject(tmpKey).catch(() => {});

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
