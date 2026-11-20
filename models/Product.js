import mongoose from "mongoose";

const productSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    category: { type: String, default: "Action & RPG" },
    price: { type: Number, default: 0 },
    discountPrice: { type: Number, default: 0 },
    isFree: { type: Boolean, default: true },
    isOnlinePlayable: { type: Boolean, default: true },
    playOnlineUrl: { type: String, default: "" },
    apkDownloadUrl: { type: String, default: "" },
    gameType: { type: String, default: "Free to Play" },
    playersOnline: { type: String, default: "15,400+ Online" },
    sku: { type: String, default: "" },
    img: { type: String, default: "https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&q=80&w=1000" },
    description: { type: String, default: "" },
    platform: { type: String, default: "Multi-Platform" },
    genre: { type: String, default: "Action" },
    developer: { type: String, default: "" },
    publisher: { type: String, default: "" },
    rating: { type: String, default: "ESRB M (17+)" },
    releaseYear: { type: Number, default: 2024 },
    edition: [{ type: String }],
    editions: [{ type: String }],
    size: [{ type: String }],
    sizes: [{ type: String }],
    brand: { type: String, default: "" },
    fabric: { type: String, default: "" },
    color: { type: String, default: "" },
    occasion: { type: String, default: "" },
    inStock: { type: Boolean, default: true },
    isDownloadable: { type: Boolean, default: true },
    downloadUrl: { type: String, default: "" },
    downloadSize: { type: String, default: "60 GB" },
    systemRequirements: { type: String, default: "Windows 10/11 64-bit, Intel i5/AMD Ryzen 5, 16GB RAM, DirectX 12, 70 GB SSD" },
    requirementsOS: { type: String, default: "Windows 10 / 11 (64-bit)" },
    requirementsCPU: { type: String, default: "Intel Core i5 / AMD Ryzen 5" },
    requirementsRAM: { type: String, default: "8 GB RAM" },
    requirementsGPU: { type: String, default: "GTX 1060 / AMD RX 580" },
    requirementsStorage: { type: String, default: "10 GB available space" },
    uploadType: { type: String, enum: ["executable", "portable_zip", "webgl_zip", "external_url", "none"], default: "none" },
    fileName: { type: String, default: "" },
    fileType: { type: String, default: "" },
    fileSizeBytes: { type: Number, default: 0 },
    fileSha256: { type: String, default: "" },
    version: { type: String, default: "1.0.0" },
    filePath: { type: String, default: "" },
    webglEntryUrl: { type: String, default: "" },
    storageProvider: { type: String, enum: ["server", "s3", "r2", "external"], default: "server" },
    storageUrl: { type: String, default: "" },
    activationKey: { type: String, default: "" },
    ratings: { type: Number, default: 4.8 },
    reviews: { type: Number, default: 0 },
  },
  { timestamps: true }
);

productSchema.pre("save", function (next) {
  const eds = this.edition?.length ? this.edition : (this.size?.length ? this.size : ["Standard Edition"]);
  if (!this.edition || !this.edition.length) this.edition = eds;
  if (!this.editions || !this.editions.length) this.editions = eds;
  if (!this.size || !this.size.length) this.size = eds;
  if (!this.sizes || !this.sizes.length) this.sizes = eds;
  if (!this.brand && this.publisher) this.brand = this.publisher;
  if (!this.publisher && this.brand) this.publisher = this.brand;
  if (!this.fabric && this.platform) this.fabric = this.platform;
  if (!this.occasion && this.genre) this.occasion = this.genre;
  next();
});

productSchema.index({ createdAt: -1 });
productSchema.index({ category: 1 });
productSchema.index({ platform: 1 });
productSchema.index({ genre: 1 });
productSchema.index({ inStock: 1 });

export default mongoose.models.Product || mongoose.model("Product", productSchema);
