import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import compression from "compression";

import User from "./models/User.js";
import productRoutes from "./routes/productRoutes.js";
import checkoutRoutes from "./routes/checkoutRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, ".env") });

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "secret123";

// Ensure uploads directories exist
const uploadDirs = [
  path.join(__dirname, "uploads"),
  path.join(__dirname, "server/uploads"),
];
uploadDirs.forEach((dir) => {
  ["", "games", "webgl", "webgl_zips", "temp"].forEach((sub) => {
    const full = path.join(dir, sub);
    if (!fs.existsSync(full)) fs.mkdirSync(full, { recursive: true });
  });
});

const staticOptions = {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".wasm")) {
      res.setHeader("Content-Type", "application/wasm");
    } else if (filePath.endsWith(".data") || filePath.endsWith(".bundle")) {
      res.setHeader("Content-Type", "application/octet-stream");
    } else if (filePath.endsWith(".wasm.gz") || filePath.endsWith(".js.gz") || filePath.endsWith(".data.gz")) {
      res.setHeader("Content-Encoding", "gzip");
    } else if (filePath.endsWith(".wasm.br") || filePath.endsWith(".js.br") || filePath.endsWith(".data.br")) {
      res.setHeader("Content-Encoding", "br");
    }
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
    res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
  },
};

app.use(compression({ level: 6, threshold: 1024 }));
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ limit: "25mb", extended: true }));

// CORS setup
app.use(cors({
  origin: (origin, callback) => {
    callback(null, true);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept", "Origin"]
}));

uploadDirs.forEach((dir) => {
  if (fs.existsSync(dir)) {
    app.use("/uploads", express.static(dir, staticOptions));
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    app: "GameVault API",
    dbState: mongoose.connection.readyState,
    timestamp: new Date().toISOString()
  });
});

// Warmup endpoint
app.get("/warmup", async (req, res) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      await connectDB();
    }
    await User.findOne().limit(1).lean().catch(() => {});
    res.status(200).json({ status: "warmed", timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
  }
});

const makeToken = (user) =>
  jwt.sign({ id: user._id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: "7d" });

// ✅ Auth Routes
app.post("/api/register", async (req, res) => {
  try {
    const { name, username, email, password } = req.body;
    const finalName = name || username;
    if (!finalName || !email || !password) {
      return res.status(400).json({ error: "All fields required" });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({
      name: finalName,
      email,
      password: hashedPassword,
      role: "user",
    });

    res.json({
      message: "Gamer account created successfully",
      token: makeToken(user),
      user: { _id: user._id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    const user = await User.findOne({ email }).lean();
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    res.json({
      message: "Login successful",
      token: makeToken(user),
      user: { _id: user._id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ Mounted Modular API Routes
app.use("/api/products", productRoutes);
app.use("/api/checkout", checkoutRoutes);
app.use("/api/admin", adminRoutes);

// ✅ Serve Client Production Build (Live Single-Port Mode)
const clientBuildDirs = [
  path.join(__dirname, "client/build"),
  path.join(__dirname, "../client/build"),
];

let activeClientBuildDir = null;
for (const dir of clientBuildDirs) {
  if (fs.existsSync(dir) && fs.existsSync(path.join(dir, "index.html"))) {
    activeClientBuildDir = dir;
    break;
  }
}

if (activeClientBuildDir) {
  app.use(express.static(activeClientBuildDir));
  app.use((req, res, next) => {
    if (
      req.method === "GET" &&
      !req.path.startsWith("/api") &&
      !req.path.startsWith("/uploads") &&
      req.path !== "/health" &&
      req.path !== "/warmup"
    ) {
      return res.sendFile(path.join(activeClientBuildDir, "index.html"));
    }
    next();
  });
}

// ✅ 404 Catch-All
app.use((req, res) => {
  res.status(404).json({
    error: "Route not found",
    method: req.method,
    path: req.originalUrl,
  });
});

// Connect to MongoDB with fallbacks
async function connectDB() {
  const uris = [
    process.env.MONGO_URI,
    "mongodb://127.0.0.1:27017/game_store",
    "mongodb://localhost:27017/game_store",
    "mongodb+srv://Dhruv:Dhruv123@cluster0.ddark6d.mongodb.net/game_store?retryWrites=true&w=majority",
  ].filter(Boolean);

  for (const uri of uris) {
    try {
      console.log(`Connecting DB to: ${uri.replace(/:([^@]+)@/, ":****@")}...`);
      await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
      });
      console.log("✅ MongoDB Connected successfully");
      return;
    } catch (err) {
      console.warn(`⚠️ DB connection attempt failed (${uri.split("@").pop() || uri}): ${err.message}`);
    }
  }

  console.warn("⚠️ Warning: Running without active MongoDB connection. Start local mongod or check internet connection.");
}

connectDB().finally(() => {
  app.listen(PORT, () => {
    console.log(`🎮 GameVault Server running on http://localhost:${PORT}`);
  });
});

export default app;
