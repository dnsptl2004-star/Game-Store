import {
  S3Client,
  HeadBucketCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  ListMultipartUploadsCommand,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Upload } from "@aws-sdk/lib-storage";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, ".env") });

// Storage adapter configuration strictly derived from env with clean defaults
export const storageConfig = {
  endpoint: process.env.STORJ_S3_ENDPOINT || "https://gateway.storjshare.io",
  region: process.env.STORJ_S3_REGION || "us-east-1",
  accessKeyId: process.env.STORJ_ACCESS_KEY_ID || "jwo5dkhjwh66u75bouapm4yntqyq",
  secretAccessKey: process.env.STORJ_SECRET_ACCESS_KEY || "j277wm3vllcv57x3kcu4qfm7nnzkszjhlvshpe5hnbqwjwaf3i2qu",
  bucket: process.env.STORJ_BUCKET || "gamevault",
  publicAccessGrant: process.env.STORJ_PUBLIC_ACCESS_GRANT || "",
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "https://link.storjshare.io/raw",
  maxGameSizeGB: Number(process.env.MAX_GAME_SIZE_GB) || 10,
  userQuotaGB: Number(process.env.USER_QUOTA_GB) || 50,
  partSizeMB: Number(process.env.PART_SIZE_MB) || 64,
};

export const MAX_GAME_SIZE_BYTES = storageConfig.maxGameSizeGB * 1024 * 1024 * 1024;
export const USER_QUOTA_BYTES = storageConfig.userQuotaGB * 1024 * 1024 * 1024;
export const PART_SIZE_BYTES = storageConfig.partSizeMB * 1024 * 1024;

// Initialize S3 client for Storj (or R2 / Backblaze B2 by changing config)
export const s3Client = new S3Client({
  endpoint: storageConfig.endpoint,
  region: storageConfig.region,
  credentials: {
    accessKeyId: storageConfig.accessKeyId,
    secretAccessKey: storageConfig.secretAccessKey,
  },
  forcePathStyle: true,
});

/**
 * Validates storage environment variables without exposing any secret values
 */
export function validateStorageConfig() {
  const missing = [];
  if (!storageConfig.endpoint) missing.push("STORJ_S3_ENDPOINT");
  if (!storageConfig.accessKeyId) missing.push("STORJ_ACCESS_KEY_ID");
  if (!storageConfig.secretAccessKey) missing.push("STORJ_SECRET_ACCESS_KEY");

  if (missing.length > 0) {
    const errorMsg = `Storage configuration error: Missing required environment variable(s): ${missing.join(", ")}`;
    console.warn(`[STORAGE CONFIG NOTICE] ${errorMsg}`);
    return { valid: false, error: errorMsg, missing };
  }
  return { valid: true };
}

/**
 * Tests access to the configured bucket using HeadBucketCommand
 */
export async function testBucketAccess() {
  const configCheck = validateStorageConfig();
  if (!configCheck.valid) {
    throw new Error(configCheck.error);
  }

  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: storageConfig.bucket }));
    console.log(`[STORAGE] Bucket access confirmed for: ${storageConfig.bucket}`);
    return true;
  } catch (err) {
    let message = "";
    if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
      message = `Bucket "${storageConfig.bucket}" does not exist on endpoint ${storageConfig.endpoint}.`;
    } else if (err.name === "Forbidden" || err.$metadata?.httpStatusCode === 403) {
      message = `Access denied to bucket "${storageConfig.bucket}". Check STORJ_ACCESS_KEY_ID and STORJ_SECRET_ACCESS_KEY permissions.`;
    } else if (err.code === "ENOTFOUND" || err.message?.includes("ENOTFOUND")) {
      message = `Could not reach endpoint "${storageConfig.endpoint}". Check STORJ_S3_ENDPOINT.`;
    } else {
      message = `Storage error (${err.name || "Unknown"}): ${err.message}. Verify STORJ_S3_ENDPOINT and credentials.`;
    }
    console.error(`[STORAGE ACCESS ERROR] ${message}`);
    throw new Error(message);
  }
}

/**
 * Initializes a direct multipart upload to S3 / Storj
 */
export async function initMultipartUpload(key) {
  const command = new CreateMultipartUploadCommand({
    Bucket: storageConfig.bucket,
    Key: key,
    ContentType: "application/zip",
  });
  const res = await s3Client.send(command);
  return {
    uploadId: res.UploadId,
    key: res.Key || key,
    bucket: storageConfig.bucket,
    partSize: PART_SIZE_BYTES,
  };
}

/**
 * Generates a presigned UploadPart URL for direct browser PUT (1 hour expiry)
 */
export async function getPresignedPartUrl(key, uploadId, partNumber, expiresInSeconds = 3600) {
  const command = new UploadPartCommand({
    Bucket: storageConfig.bucket,
    Key: key,
    UploadId: uploadId,
    PartNumber: Number(partNumber),
  });
  return await getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
}

/**
 * Proxy streaming fallback for UploadPart when browser direct PUT hits CORS
 */
export async function uploadPartStream(key, uploadId, partNumber, stream, contentLength) {
  const command = new UploadPartCommand({
    Bucket: storageConfig.bucket,
    Key: key,
    UploadId: uploadId,
    PartNumber: Number(partNumber),
    Body: stream,
    ContentLength: contentLength,
  });
  const res = await s3Client.send(command);
  return res.ETag;
}

/**
 * Completes a multipart upload
 */
export async function completeMultipartUpload(key, uploadId, parts) {
  const formattedParts = parts
    .map((p) => ({
      PartNumber: Number(p.PartNumber || p.partNumber),
      ETag: String(p.ETag || p.eTag || "").replace(/"/g, ""),
    }))
    .sort((a, b) => a.PartNumber - b.PartNumber);

  const command = new CompleteMultipartUploadCommand({
    Bucket: storageConfig.bucket,
    Key: key,
    UploadId: uploadId,
    MultipartUpload: {
      Parts: formattedParts.map((p) => ({
        PartNumber: p.PartNumber,
        ETag: p.ETag.startsWith('"') ? p.ETag : `"${p.ETag}"`,
      })),
    },
  });
  return await s3Client.send(command);
}

/**
 * Aborts a multipart upload
 */
export async function abortMultipartUpload(key, uploadId) {
  const command = new AbortMultipartUploadCommand({
    Bucket: storageConfig.bucket,
    Key: key,
    UploadId: uploadId,
  });
  return await s3Client.send(command);
}

/**
 * Generates a short-lived presigned GET URL for downloading game files
 */
export async function getPresignedDownloadUrl(key, filename, expiresInSeconds = 300) {
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const command = new GetObjectCommand({
    Bucket: storageConfig.bucket,
    Key: key,
    ResponseContentDisposition: `attachment; filename="${safeFilename}"`,
  });
  return await getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
}

/**
 * Streams an object directly from S3 (never buffers in memory)
 */
export async function getObjectStream(key) {
  const command = new GetObjectCommand({
    Bucket: storageConfig.bucket,
    Key: key,
  });
  const res = await s3Client.send(command);
  return {
    stream: res.Body,
    contentLength: res.ContentLength,
    contentType: res.ContentType,
  };
}

/**
 * Streams data directly into S3 using Upload from @aws-sdk/lib-storage
 */
export async function putObjectStream(key, stream, contentType = "application/octet-stream", contentLength = null) {
  const upload = new Upload({
    client: s3Client,
    params: {
      Bucket: storageConfig.bucket,
      Key: key,
      Body: stream,
      ContentType: contentType,
      ...(contentLength ? { ContentLength: contentLength } : {}),
    },
    partSize: PART_SIZE_BYTES,
    queueSize: 4,
    leavePartsOnError: false,
  });

  return await upload.done();
}

/**
 * Deletes a single object
 */
export async function deleteObject(key) {
  try {
    await s3Client.send(new DeleteObjectCommand({ Bucket: storageConfig.bucket, Key: key }));
  } catch (err) {
    console.warn(`[STORAGE] DeleteObject warn for ${key}:`, err.message);
  }
}

/**
 * Deletes all objects matching a prefix (e.g. "games/{gameId}/")
 */
export async function deletePrefix(prefix) {
  if (!prefix || prefix === "/" || prefix === "") {
    throw new Error("Dangerous delete prefix prevented: cannot delete empty prefix");
  }

  let continuationToken = undefined;
  do {
    const listRes = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: storageConfig.bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );

    if (listRes.Contents && listRes.Contents.length > 0) {
      await Promise.all(
        listRes.Contents.map((item) =>
          s3Client.send(new DeleteObjectCommand({ Bucket: storageConfig.bucket, Key: item.Key })).catch(() => {})
        )
      );
    }

    continuationToken = listRes.NextContinuationToken;
  } while (continuationToken);
}

/**
 * Cleans up multipart uploads older than maxAgeHours (default 24h)
 */
export async function cleanupStaleUploads(maxAgeHours = 24) {
  try {
    const res = await s3Client.send(new ListMultipartUploadsCommand({ Bucket: storageConfig.bucket }));
    if (!res.Uploads || res.Uploads.length === 0) return 0;

    const thresholdMs = Date.now() - maxAgeHours * 60 * 60 * 1000;
    let abortedCount = 0;

    for (const upload of res.Uploads) {
      if (upload.Initiated && new Date(upload.Initiated).getTime() < thresholdMs) {
        console.log(`[CLEANUP] Aborting stale multipart upload: ${upload.Key} (${upload.UploadId})`);
        await abortMultipartUpload(upload.Key, upload.UploadId);
        abortedCount++;
      }
    }
    return abortedCount;
  } catch (err) {
    console.warn("[CLEANUP] Cleanup stale uploads warn:", err.message);
    return 0;
  }
}

/**
 * Generates public play URL using Storj Link Sharing or fallback play route
 */
export function getPublicPlayUrl(gameId, relativePath = "index.html") {
  const cleanPath = relativePath.replace(/^\/+/, "");
  if (storageConfig.publicAccessGrant) {
    const base = storageConfig.publicBaseUrl.replace(/\/+$/, "");
    return `${base}/${storageConfig.publicAccessGrant}/${storageConfig.bucket}/games/${gameId}/${cleanPath}`;
  }
  return `/api/play/${gameId}/${cleanPath}`;
}

export default {
  storageConfig,
  s3Client,
  validateStorageConfig,
  testBucketAccess,
  initMultipartUpload,
  getPresignedPartUrl,
  uploadPartStream,
  completeMultipartUpload,
  abortMultipartUpload,
  getPresignedDownloadUrl,
  getObjectStream,
  putObjectStream,
  deleteObject,
  deletePrefix,
  cleanupStaleUploads,
  getPublicPlayUrl,
};
