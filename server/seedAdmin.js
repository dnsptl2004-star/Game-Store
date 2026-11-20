import dotenv from "dotenv";
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import path from "path";
import { fileURLToPath } from "url";
import User from "./models/User.js";

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

async function seedAdmin() {
  let connected = false;

  for (const uri of uris) {
    try {
      console.log(`Connecting to: ${uri.replace(/:([^@]+)@/, ":****@")}...`);
      await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
      });
      connected = true;
      console.log("✅ MongoDB Connected successfully");
      break;
    } catch (err) {
      console.warn(`⚠️ Failed connecting to ${uri.split("@").pop() || uri}: ${err.message}`);
    }
  }

  if (!connected) {
    console.error("❌ Could not connect to any MongoDB instance. Please check your network or local MongoDB service.");
    process.exit(1);
  }

  try {
    const adminEmail = "admin@gmail.com";
    const adminPassword = "123";
    const hashedPassword = await bcrypt.hash(adminPassword, 10);

    const existingUser = await User.findOne({ email: adminEmail });

    if (existingUser) {
      existingUser.name = "GameVault Commander";
      existingUser.password = hashedPassword;
      existingUser.role = "admin";
      await existingUser.save();
      console.log("⚡ GameVault Admin account updated: admin@gmail.com / 123");
    } else {
      await User.create({
        name: "GameVault Commander",
        email: adminEmail,
        password: hashedPassword,
        role: "admin",
      });
      console.log("🎉 GameVault Admin account created: admin@gmail.com / 123");
    }

    process.exit(0);
  } catch (err) {
    console.error("❌ Seed admin error:", err.message);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
  }
}

seedAdmin();
