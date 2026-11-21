import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";

const gameSchema = new mongoose.Schema(
  {
    id: { type: String, default: () => uuidv4(), unique: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    ownerId: { type: String, default: "admin", index: true },
    entryFile: { type: String, default: "index.html" },
    fileCount: { type: Number, default: 0 },
    sizeBytes: { type: Number, default: 0 },
    uncompressedSizeBytes: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["uploading", "verifying", "extracting", "ready", "failed"],
      default: "uploading",
      index: true,
    },
    statusMessage: { type: String, default: "" },
    progressPercent: { type: Number, default: 0 },
    s3Prefix: { type: String, default: "" },
    zipKey: { type: String, default: "" },
    uploadId: { type: String, default: "" },
    logoUrl: { type: String, default: "" },
    coverImage: { type: String, default: "" },
    version: { type: String, default: "1.0.0" },
    systemRequirements: { type: String, default: "Windows 10/11 64-bit, 8GB RAM, DirectX 11" },
    playUrl: { type: String, default: "" },
    downloadUrl: { type: String, default: "" },
    error: { type: String, default: "" },
  },
  { timestamps: true, bufferCommands: false }
);

export default mongoose.models.Game || mongoose.model("Game", gameSchema);
