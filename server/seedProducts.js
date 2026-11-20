import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import Product from "./models/Product.js";
import { freeGames } from "./data/freeGames.js";

export { freeGames };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, "../.env") });
dotenv.config({ path: path.join(__dirname, ".env") });

const uris = Array.from(
  new Set([
    process.env.MONGO_URI,
    "mongodb://127.0.0.1:27017/game_store",
    "mongodb://localhost:27017/game_store",
    "mongodb+srv://Dhruv:Dhruv123@cluster0.ddark6d.mongodb.net/game_store?retryWrites=true&w=majority",
  ])
).filter(Boolean);

const isMain = process.argv[1] && (
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) ||
  process.argv[1].endsWith("seedProducts.js")
);

export async function seedProducts() {
  let connected = false;

  for (const uri of uris) {
    try {
      console.log(`Connecting to: ${uri.replace(/:([^@]+)@/, ":****@")}...`);
      await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
      });
      connected = true;
      console.log("✅ MongoDB Connected successfully for Free Games Seeding");
      break;
    } catch (err) {
      console.warn(`⚠️ Failed connecting to ${uri.split("@").pop() || uri}: ${err.message}`);
    }
  }

  if (!connected) {
    console.error("❌ Could not connect to any MongoDB instance. Please check your network or local MongoDB service.");
    if (isMain) process.exit(1);
    return;
  }

  try {
    console.log("🎮 Seeding 100% Free Games & Online Playable Games into GameVault...");
    await Product.deleteMany({});
    const inserted = await Product.insertMany(freeGames);
    console.log(`🎉 Successfully seeded ${inserted.length} FREE & Online Playable Games into GameVault!`);
    if (isMain) process.exit(0);
  } catch (err) {
    console.error("❌ Seed products error:", err.message);
    if (isMain) process.exit(1);
  } finally {
    if (isMain) {
      await mongoose.connection.close();
    }
  }
}

if (isMain) {
  seedProducts();
}

export default seedProducts;
