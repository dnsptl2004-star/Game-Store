import { downloadZip, predictLength } from "client-zip";
import axios from "axios";

const API_BASE = process.env.REACT_APP_API_URL || "";
const MAX_GAME_SIZE_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB
const DEFAULT_PART_SIZE = 64 * 1024 * 1024; // 64 MB
const DEFAULT_CONCURRENCY = 4; // 4 parallel streams to Storj S3 Gateway

/**
 * Validates zip extension and 10 GB maximum size limit
 */
export function validateUploadFile(file, isFolder = false) {
  if (!file) {
    throw new Error("No file or folder selected");
  }

  const name = file.name || "game_package";
  const size = file.size || 0;

  if (!isFolder && !name.toLowerCase().endsWith(".zip")) {
    throw new Error(`Invalid file type "${name}". Only .zip packages are supported.`);
  }

  if (size > MAX_GAME_SIZE_BYTES) {
    const sizeGB = (size / (1024 * 1024 * 1024)).toFixed(2);
    throw new Error(
      `Package size (${sizeGB} GB) exceeds the maximum allowed limit of 10 GB. Please provide a package under 10 GB.`
    );
  }

  return true;
}

/**
 * High-performance zero-memory async generator that reads a web ReadableStream
 * and yields exact fixed-size chunks (e.g. 64 MB) without buffering the full stream.
 */
export async function* readStreamInChunks(readableStream, chunkSize = DEFAULT_PART_SIZE) {
  const reader = readableStream.getReader();
  let buffer = new Uint8Array(chunkSize);
  let bufferOffset = 0;
  let partNumber = 1;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        if (bufferOffset > 0) {
          yield {
            partNumber,
            data: buffer.subarray(0, bufferOffset),
            size: bufferOffset,
          };
        }
        break;
      }

      let valueOffset = 0;
      while (valueOffset < value.length) {
        const bytesNeeded = chunkSize - bufferOffset;
        const bytesToCopy = Math.min(bytesNeeded, value.length - valueOffset);

        buffer.set(value.subarray(valueOffset, valueOffset + bytesToCopy), bufferOffset);
        bufferOffset += bytesToCopy;
        valueOffset += bytesToCopy;

        if (bufferOffset === chunkSize) {
          yield {
            partNumber,
            data: buffer,
            size: chunkSize,
          };
          partNumber++;
          // Allocate fresh buffer for the next chunk so previous chunk can upload concurrently
          buffer = new Uint8Array(chunkSize);
          bufferOffset = 0;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Storj direct chunked resumable uploader
 * Fully streaming with 0 memory bloat (never loads full file/folder into RAM)
 */
export class StorjResumableUploader {
  constructor(options = {}) {
    this.concurrency = options.concurrency || DEFAULT_CONCURRENCY;
    this.maxRetries = options.maxRetries || 5;
    this.onProgress = options.onProgress || (() => {});
    this.onStatus = options.onStatus || (() => {});
    this.onError = options.onError || (() => {});
    this.onSuccess = options.onSuccess || (() => {});
    this.onCorsFallback = options.onCorsFallback || (() => {});

    this.isPaused = false;
    this.isCancelled = false;
    this.uploadId = null;
    this.key = null;
    this.gameId = null;
    this.partSize = DEFAULT_PART_SIZE;
    this.completedParts = [];
    this.totalParts = 0;
    this.totalBytes = 0;
    this.uploadedBytes = 0;
    this.startTime = null;
    this.lastSpeedUpdate = null;
    this.bytesSinceLastUpdate = 0;
    this.storageKey = "";
    this.usingProxy = false;
  }

  getStorageKey(name) {
    return `storj_up_${name}_${this.totalBytes}`;
  }

  saveState() {
    if (!this.storageKey) return;
    try {
      const state = {
        uploadId: this.uploadId,
        key: this.key,
        gameId: this.gameId,
        partSize: this.partSize,
        totalParts: this.totalParts,
        totalBytes: this.totalBytes,
        completedParts: this.completedParts,
        usingProxy: this.usingProxy,
      };
      localStorage.setItem(this.storageKey, JSON.stringify(state));
    } catch (e) {}
  }

  clearState() {
    if (this.storageKey) {
      try {
        localStorage.removeItem(this.storageKey);
      } catch (e) {}
    }
  }

  loadState() {
    if (!this.storageKey) return null;
    try {
      const saved = localStorage.getItem(this.storageKey);
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Starts or resumes an upload (folder or single .zip file)
   */
  async startUpload(file, gameData = {}, isFolder = false, folderFiles = []) {
    this.isPaused = false;
    this.isCancelled = false;
    this.startTime = Date.now();
    this.lastSpeedUpdate = Date.now();
    this.bytesSinceLastUpdate = 0;

    let packageName = file.name || (isFolder ? "game_folder.zip" : "game.zip");
    if (!packageName.toLowerCase().endsWith(".zip")) {
      packageName += ".zip";
    }

    // 1. Calculate size & validate
    if (isFolder && folderFiles && folderFiles.length > 0) {
      this.onStatus("Analyzing folder structure and preparing stream...");
      const zipEntries = folderFiles.map((f) => ({
        name: (f.webkitRelativePath || f.name).replace(/\\/g, "/"),
        input: f,
        size: f.size || 0,
      }));

      let predictedBytes = 0;
      try {
        predictedBytes = Number(predictLength(zipEntries));
      } catch (e) {
        // Safe fallback estimation if predictLength fails
        predictedBytes = folderFiles.reduce((sum, f) => sum + (f.size || 0) + 160, 0) + 4096;
      }

      this.totalBytes = predictedBytes;
      validateUploadFile({ name: packageName, size: this.totalBytes }, isFolder);
      this.storageKey = this.getStorageKey(packageName);

      // Check for resumable upload state
      await this.initOrResumeUpload(packageName, gameData);

      // 2. Stream folder into 64 MB chunks and upload directly in parallel
      this.onStatus(`Streaming folder chunks to Storj (${this.concurrency} parallel streams)...`);
      this.updateProgress(0);

      const zipResponse = downloadZip(zipEntries, { buffers: false });
      const completedPartNumbers = new Set(this.completedParts.map((p) => p.PartNumber));
      const activeWorkers = new Set();

      for await (const chunk of readStreamInChunks(zipResponse.body, this.partSize)) {
        if (this.isCancelled || this.isPaused) break;

        // If resuming and this part was already uploaded previously, skip
        if (completedPartNumbers.has(chunk.partNumber)) {
          continue;
        }

        // Apply backpressure: wait for an active worker to finish before reading more
        if (activeWorkers.size >= this.concurrency) {
          await Promise.race(activeWorkers);
        }

        if (this.isCancelled || this.isPaused) break;

        const chunkBlob = new Blob([chunk.data], { type: "application/octet-stream" });
        const workerPromise = this.uploadPartWithRetry({
          partNumber: chunk.partNumber,
          size: chunk.size,
          blob: chunkBlob,
        });

        activeWorkers.add(workerPromise);
        workerPromise.finally(() => {
          activeWorkers.delete(workerPromise);
        });
      }

      // Wait for all remaining chunk uploads to finish
      await Promise.all(activeWorkers);

    } else {
      // Single .zip file upload (zero-copy browser slicing)
      validateUploadFile(file, false);
      this.totalBytes = file.size;
      this.storageKey = this.getStorageKey(packageName);

      await this.initOrResumeUpload(packageName, gameData);

      const completedPartNumbers = new Set(this.completedParts.map((p) => p.PartNumber));
      const pendingParts = [];

      for (let partNumber = 1; partNumber <= this.totalParts; partNumber++) {
        if (!completedPartNumbers.has(partNumber)) {
          const start = (partNumber - 1) * this.partSize;
          const end = Math.min(start + this.partSize, this.totalBytes);
          pendingParts.push({
            partNumber,
            start,
            end,
            size: end - start,
            blob: file.slice(start, end),
          });
        }
      }

      this.onStatus(`Uploading chunks to Storj (${this.concurrency} parallel streams)...`);
      this.updateProgress(0);

      await this.processQueue(pendingParts);
    }

    if (this.isCancelled) {
      await this.abort();
      return;
    }

    if (this.isPaused) {
      this.onStatus("Upload paused");
      return;
    }

    // 3. Complete multipart upload on Storj
    this.onStatus("Finalizing multipart package on Storj...");
    await axios.post(`${API_BASE}/api/uploads/complete`, {
      uploadId: this.uploadId,
      key: this.key,
      parts: this.completedParts,
      gameId: this.gameId,
      gameData,
    });

    this.clearState();
    this.onStatus("Upload complete! Verifying game package...");

    // 4. Poll status until ready
    await this.pollGameStatus(this.gameId);
  }

  async initOrResumeUpload(filename, gameData) {
    const savedState = this.loadState();

    if (savedState && savedState.uploadId && savedState.totalBytes === this.totalBytes) {
      this.uploadId = savedState.uploadId;
      this.key = savedState.key;
      this.gameId = savedState.gameId;
      this.partSize = savedState.partSize || DEFAULT_PART_SIZE;
      this.totalParts = savedState.totalParts;
      this.completedParts = savedState.completedParts || [];
      this.usingProxy = savedState.usingProxy || false;
      this.uploadedBytes = this.completedParts.reduce((acc, p) => {
        const partIdx = p.PartNumber - 1;
        const start = partIdx * this.partSize;
        const end = Math.min(start + this.partSize, this.totalBytes);
        return acc + (end - start);
      }, 0);
      this.onStatus(`Resuming previous upload (${this.completedParts.length}/${this.totalParts} parts done)...`);
    } else {
      this.onStatus("Initializing multipart stream on Storj Gateway...");
      const initRes = await axios.post(`${API_BASE}/api/uploads/init`, {
        filename,
        size: this.totalBytes,
        title: gameData.title || filename.replace(/\.zip$/i, ""),
        description: gameData.description || "",
        version: gameData.version || "1.0.0",
        systemRequirements: gameData.systemRequirements || "",
        logoUrl: gameData.logoUrl || "",
        coverImage: gameData.coverImage || "",
      });

      this.uploadId = initRes.data.uploadId;
      this.key = initRes.data.key;
      this.gameId = initRes.data.gameId;
      this.partSize = initRes.data.partSize || DEFAULT_PART_SIZE;
      this.totalParts = initRes.data.partCount || Math.ceil(this.totalBytes / this.partSize);
      this.completedParts = [];
      this.uploadedBytes = 0;
      this.saveState();
    }
  }

  async processQueue(pendingParts) {
    const queue = [...pendingParts];
    const workers = [];

    for (let i = 0; i < this.concurrency; i++) {
      workers.push(
        (async () => {
          while (queue.length > 0 && !this.isPaused && !this.isCancelled) {
            const part = queue.shift();
            if (part) {
              await this.uploadPartWithRetry(part);
            }
          }
        })()
      );
    }

    await Promise.all(workers);
  }

  async uploadPartWithRetry(part) {
    let attempt = 0;
    let lastErr = null;

    while (attempt < this.maxRetries && !this.isPaused && !this.isCancelled) {
      attempt++;
      try {
        const etag = await this.uploadSinglePart(part);
        this.completedParts.push({ PartNumber: part.partNumber, ETag: etag });
        this.uploadedBytes += part.size;
        this.saveState();
        this.updateProgress(part.size);
        return etag;
      } catch (err) {
        lastErr = err;
        console.warn(`[UPLOAD] Part ${part.partNumber} attempt ${attempt} failed:`, err.message);

        // If direct browser PUT fails (CORS or network error on Storj gateway), fall back to streaming proxy
        if (!this.usingProxy && (err.message?.includes("CORS") || err.message?.includes("Failed to fetch") || err.name === "TypeError")) {
          console.warn("[UPLOAD] Gateway CORS detected. Switching to streaming server proxy fallback.");
          this.usingProxy = true;
          this.onCorsFallback();
        }

        if (attempt < this.maxRetries) {
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    if (lastErr && !this.isPaused && !this.isCancelled) {
      throw new Error(`Failed part ${part.partNumber} after ${this.maxRetries} attempts: ${lastErr.message}`);
    }
  }

  async uploadSinglePart(part) {
    // If using streaming proxy fallback
    if (this.usingProxy) {
      const res = await axios.put(`${API_BASE}/api/uploads/proxy-part`, part.blob, {
        params: {
          uploadId: this.uploadId,
          key: this.key,
          partNumber: part.partNumber,
        },
        headers: { "Content-Type": "application/octet-stream" },
      });
      return res.data.ETag || res.headers.etag;
    }

    // Direct presigned PUT to Storj Gateway
    const signRes = await axios.post(`${API_BASE}/api/uploads/sign-part`, {
      uploadId: this.uploadId,
      key: this.key,
      partNumber: part.partNumber,
    });

    const presignedUrl = signRes.data.url;

    const putRes = await fetch(presignedUrl, {
      method: "PUT",
      body: part.blob,
      headers: {
        "Content-Type": "application/octet-stream",
      },
    });

    if (!putRes.ok) {
      throw new Error(`Direct PUT failed with HTTP ${putRes.status}`);
    }

    const etag = putRes.headers.get("ETag") || putRes.headers.get("etag");
    if (!etag) {
      return `"${part.partNumber}-${Date.now()}"`;
    }
    return etag;
  }

  updateProgress(newBytes) {
    this.bytesSinceLastUpdate += newBytes;
    const now = Date.now();
    const timeDelta = (now - this.lastSpeedUpdate) / 1000;

    let speedStr = "";
    let etaStr = "";

    if (timeDelta >= 0.5) {
      const bytesPerSec = this.bytesSinceLastUpdate / timeDelta;
      speedStr = `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;

      const remainingBytes = Math.max(0, this.totalBytes - this.uploadedBytes);
      if (bytesPerSec > 0) {
        const remainingSec = Math.round(remainingBytes / bytesPerSec);
        if (remainingSec >= 60) {
          etaStr = `${Math.floor(remainingSec / 60)}m ${remainingSec % 60}s remaining`;
        } else {
          etaStr = `${remainingSec}s remaining`;
        }
      }

      this.lastSpeedUpdate = now;
      this.bytesSinceLastUpdate = 0;
    }

    const percent = this.totalBytes > 0
      ? Math.min(100, Math.round((this.uploadedBytes / this.totalBytes) * 100))
      : 0;

    this.onProgress({
      percent,
      uploadedBytes: this.uploadedBytes,
      totalBytes: this.totalBytes,
      speed: speedStr,
      eta: etaStr,
      partsCompleted: this.completedParts.length,
      totalParts: this.totalParts || Math.ceil(this.totalBytes / this.partSize),
    });
  }

  pause() {
    this.isPaused = true;
    this.onStatus("Upload paused");
  }

  async abort() {
    this.isCancelled = true;
    this.clearState();
    if (this.uploadId && this.key) {
      try {
        await axios.post(`${API_BASE}/api/uploads/abort`, {
          uploadId: this.uploadId,
          key: this.key,
        });
      } catch (e) {}
    }
    this.onStatus("Upload cancelled");
  }

  async pollGameStatus(gameId) {
    let attempts = 0;
    const maxPolls = 180; // 3 minutes

    while (attempts < maxPolls && !this.isCancelled) {
      attempts++;
      try {
        const res = await axios.get(`${API_BASE}/api/games/${gameId}/status`);
        const { status, statusMessage, error, playUrl, downloadUrl } = res.data;

        if (status === "ready") {
          this.onStatus("Game package is verified and ready!");
          this.onSuccess({ gameId, playUrl, downloadUrl });
          return;
        }

        if (status === "failed") {
          throw new Error(error || statusMessage || "Game processing failed");
        }

        this.onStatus(statusMessage || `Processing: ${status}...`);
      } catch (err) {
        if (err.message && err.message.includes("failed")) throw err;
      }

      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

export default StorjResumableUploader;
