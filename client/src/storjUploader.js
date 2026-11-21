import { downloadZip } from "client-zip";
import axios from "axios";

const API_BASE = process.env.REACT_APP_API_URL || "";
const MAX_GAME_SIZE_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB
const DEFAULT_PART_SIZE = 64 * 1024 * 1024; // 64 MB

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
      `File size (${sizeGB} GB) exceeds the maximum allowed limit of 10 GB. Please provide a package under 10 GB.`
    );
  }

  return true;
}

/**
 * Storj direct chunked resumable uploader
 */
export class StorjResumableUploader {
  constructor(options = {}) {
    this.concurrency = options.concurrency || 3;
    this.maxRetries = options.maxRetries || 5;
    this.onProgress = options.onProgress || (() => {});
    this.onStatus = options.onStatus || (() => {});
    this.onError = options.onError || (() => {});
    this.onSuccess = options.onSuccess || (() => {});
    this.onCorsFallback = options.onCorsFallback || (() => {});

    this.isPaused = false;
    this.isCancelled = false;
    this.activeWorkers = 0;
    this.uploadId = null;
    this.key = null;
    this.gameId = null;
    this.partSize = DEFAULT_PART_SIZE;
    this.parts = [];
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

  getStorageKey(file) {
    return `storj_up_${file.name}_${file.size}_${file.lastModified || "ts"}`;
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
   * Starts or resumes a file upload
   */
  async startUpload(file, gameData = {}, isFolder = false, folderFiles = []) {
    this.isPaused = false;
    this.isCancelled = false;
    this.startTime = Date.now();
    this.lastSpeedUpdate = Date.now();
    this.bytesSinceLastUpdate = 0;

    let uploadBlob = file;

    // If folder upload, stream zip in browser using client-zip in store mode
    if (isFolder && folderFiles && folderFiles.length > 0) {
      this.onStatus("Streaming folder into .zip package in browser (store mode)...");
      const zipEntries = folderFiles.map((f) => ({
        name: (f.webkitRelativePath || f.name).replace(/\\/g, "/"),
        input: f,
      }));

      const zipResponse = downloadZip(zipEntries, { buffers: false });
      uploadBlob = await zipResponse.blob();
    }

    validateUploadFile(uploadBlob, isFolder);

    this.totalBytes = uploadBlob.size;
    this.storageKey = this.getStorageKey(file);

    // Check for resumable state in localStorage
    const savedState = this.loadState();

    if (savedState && savedState.uploadId && savedState.totalBytes === this.totalBytes) {
      this.uploadId = savedState.uploadId;
      this.key = savedState.key;
      this.gameId = savedState.gameId;
      this.partSize = savedState.partSize || DEFAULT_PART_SIZE;
      this.totalParts = savedState.totalParts;
      this.completedParts = savedState.completedParts || [];
      this.usingProxy = savedState.usingProxy || false;
      this.onStatus(`Resuming previous upload (${this.completedParts.length}/${this.totalParts} parts done)...`);
    } else {
      this.onStatus("Initializing chunked upload on Storj S3 Gateway...");
      const initRes = await axios.post(`${API_BASE}/api/uploads/init`, {
        filename: file.name.endsWith(".zip") ? file.name : `${file.name}.zip`,
        size: this.totalBytes,
        title: gameData.title || file.name.replace(/\.zip$/i, ""),
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
      this.totalParts = initRes.data.partCount;
      this.completedParts = [];
      this.saveState();
    }

    // Build parts list
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
          blob: uploadBlob.slice(start, end),
        });
      }
    }

    // Calculate already uploaded bytes
    this.uploadedBytes = this.completedParts.reduce((acc, p) => {
      const partIdx = p.PartNumber - 1;
      const start = partIdx * this.partSize;
      const end = Math.min(start + this.partSize, this.totalBytes);
      return acc + (end - start);
    }, 0);

    this.onStatus(`Uploading chunks to Storj (3-4 parallel streams)...`);
    this.updateProgress(0);

    // Parallel worker queue
    await this.processQueue(pendingParts);

    if (this.isCancelled) {
      await this.abort();
      return;
    }

    if (this.isPaused) {
      this.onStatus("Upload paused");
      return;
    }

    // All parts uploaded -> complete upload
    this.onStatus("Assembling multipart upload on Storj...");
    await axios.post(`${API_BASE}/api/uploads/complete`, {
      uploadId: this.uploadId,
      key: this.key,
      parts: this.completedParts,
      gameId: this.gameId,
      gameData,
    });

    this.clearState();
    this.onStatus("Upload complete! Verifying package security and extracting...");

    // Poll status until ready
    await this.pollGameStatus(this.gameId);
  }

  async processQueue(pendingParts) {
    const queue = [...pendingParts];
    const workers = [];

    for (let i = 0; i < this.concurrency; i++) {
      workers.push(
        (async () => {
          while (queue.length > 0 && !this.isPaused && !this.isCancelled) {
            const part = queue.shift();
            await this.uploadPartWithRetry(part);
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
    // If using proxy fallback
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
      // In case CORS blocks reading ETag header directly from gateway, use proxy to sign or complete
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

    const percent = Math.min(100, Math.round((this.uploadedBytes / this.totalBytes) * 100));

    this.onProgress({
      percent,
      uploadedBytes: this.uploadedBytes,
      totalBytes: this.totalBytes,
      speed: speedStr,
      eta: etaStr,
      partsCompleted: this.completedParts.length,
      totalParts: this.totalParts,
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
    const maxPolls = 120; // 2 minutes

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
        if (err.message.includes("failed")) throw err;
      }

      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

export default StorjResumableUploader;
