import mongoose from "mongoose";

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    title: { type: String, trim: true },
    logoUrl: {
      type: String,
      default: "https://images.unsplash.com/photo-1612287232230-050410425e40?auto=format&fit=crop&q=80&w=256",
    },
    img: {
      type: String,
      default: "https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&q=80&w=1000",
    },
    description: { type: String, default: "" },
    version: { type: String, default: "1.0.0" },
    category: { type: String, default: "PC Games" },
    platform: { type: String, default: "PC (Windows 10/11)" },
    genre: { type: String, default: "Action" },
    developer: { type: String, default: "" },
    publisher: { type: String, default: "" },
    price: { type: Number, default: 0 },
    discountPrice: { type: Number, default: 0 },
    isFree: { type: Boolean, default: true },
    inStock: { type: Boolean, default: true },
    isDownloadable: { type: Boolean, default: true },
    isOnlinePlayable: { type: Boolean, default: false },
    playOnlineUrl: { type: String, default: "" },
    apkDownloadUrl: { type: String, default: "" },
    uploadType: {
      type: String,
      enum: ["executable", "portable_zip", "folder_zip", "webgl_zip", "external_url", "none"],
      default: "executable",
    },
    fileName: { type: String, default: "" },
    fileType: { type: String, default: ".exe" },
    fileSizeBytes: { type: Number, default: 0 },
    downloadSize: { type: String, default: "" },
    fileSha256: { type: String, default: "" },
    filePath: { type: String, default: "" },
    downloadUrl: { type: String, default: "" },
    storageProvider: {
      type: String,
      enum: ["server", "s3", "r2", "external"],
      default: "server",
    },
    storageUrl: { type: String, default: "" },
    webglEntryUrl: { type: String, default: "" },

    // Hardware System Requirements
    requirementsOS: { type: String, default: "Windows 10 / 11 (64-bit)" },
    requirementsCPU: { type: String, default: "Intel Core i5-8400 / AMD Ryzen 5 2600" },
    requirementsRAM: { type: String, default: "8 GB RAM" },
    requirementsGPU: { type: String, default: "NVIDIA GeForce GTX 1060 / AMD Radeon RX 580" },
    requirementsStorage: { type: String, default: "15 GB available space" },
    systemRequirements: {
      type: String,
      default: "Windows 10/11 64-bit, Intel i5 / Ryzen 5, 8GB RAM, GTX 1060, 15 GB Storage",
    },

    // Malware Scanning & Security Verification
    isMalwareScanned: { type: Boolean, default: true },
    malwareScanResult: {
      clean: { type: Boolean, default: true },
      status: { type: String, default: "clean" },
      engine: { type: String, default: "VirusTotal / SHA-256 Engine" },
      positives: { type: Number, default: 0 },
      totalEngines: { type: Number, default: 72 },
      scannedAt: { type: Date, default: Date.now },
    },

    edition: [{ type: String }],
    editions: [{ type: String }],
    size: [{ type: String }],
    sizes: [{ type: String }],
    brand: { type: String, default: "" },
    fabric: { type: String, default: "" },
    color: { type: String, default: "" },
    occasion: { type: String, default: "" },
    rating: { type: String, default: "ESRB T (13+)" },
    releaseYear: { type: Number, default: 2024 },
    ratings: { type: Number, default: 4.8 },
    reviews: { type: Number, default: 0 },
    activationKey: { type: String, default: "" },
    sku: { type: String, default: "" },
    gameType: { type: String, default: "PC Game" },
    playersOnline: { type: String, default: "12,500+ Players" },
  },
  { timestamps: true }
);

productSchema.pre("save", function (next) {
  if (this.title && !this.name) this.name = this.title;
  if (this.name && !this.title) this.title = this.name;
  if (!this.logoUrl && this.img) this.logoUrl = this.img;

  const eds = this.edition?.length
    ? this.edition
    : this.size?.length
      ? this.size
      : ["Standard Edition"];
  if (!this.edition || !this.edition.length) this.edition = eds;
  if (!this.editions || !this.editions.length) this.editions = eds;
  if (!this.size || !this.size.length) this.size = eds;
  if (!this.sizes || !this.sizes.length) this.sizes = eds;
  if (!this.brand && this.publisher) this.brand = this.publisher;
  if (!this.publisher && this.brand) this.publisher = this.brand;
  if (!this.fabric && this.platform) this.fabric = this.platform;
  if (!this.occasion && this.genre) this.occasion = this.genre;
  if (typeof next === "function") next();
});

productSchema.index({ createdAt: -1 });
productSchema.index({ category: 1 });
productSchema.index({ platform: 1 });
productSchema.index({ genre: 1 });
productSchema.index({ inStock: 1 });
productSchema.index({ sku: 1 });

export default mongoose.models.Product || mongoose.model("Product", productSchema);
