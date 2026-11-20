import React, { useEffect, useState, useCallback } from "react";
import "./AdminDashboard.css";
import { authApi } from "./api";

function AdminDashboard({ user, onLogout }) {
  const [tab, setTab] = useState("summary");
  const [summary, setSummary] = useState({});
  const [users, setUsers] = useState([]);
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState("");

  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatusText, setUploadStatusText] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadSpeed, setUploadSpeed] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);

  const [form, setForm] = useState({
    name: "",
    category: "PC Games",
    price: 0,
    discountPrice: 0,
    isFree: true,
    isOnlinePlayable: false,
    playOnlineUrl: "",
    apkDownloadUrl: "",
    img: "https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&q=80&w=1000",
    description: "",
    platform: "PC (Windows 10/11)",
    genre: "Action & Adventure",
    developer: "",
    publisher: "",
    edition: "Full Game (Standard)",
    size: "Full Game (Standard)",
    brand: "",
    inStock: true,
    isDownloadable: true,
    downloadSize: "",
    downloadUrl: "",
    uploadType: "executable", // executable | portable_zip | webgl_zip | external_url
    fileName: "",
    fileType: "",
    fileSizeBytes: 0,
    fileSha256: "",
    version: "1.0.0",
    filePath: "",
    webglEntryUrl: "",
    storageProvider: "server", // server | s3 | r2 | external
    storageUrl: "",
    requirementsOS: "Windows 10 / 11 (64-bit)",
    requirementsCPU: "Intel Core i5-8400 / AMD Ryzen 5 2600",
    requirementsRAM: "8 GB RAM",
    requirementsGPU: "NVIDIA GeForce GTX 1060 / AMD Radeon RX 580",
    requirementsStorage: "15 GB available space",
    systemRequirements: "Windows 10/11 64-bit, Intel i5 / Ryzen 5, 8GB RAM, GTX 1060, 15 GB Storage",
  });

  const categories = [
    "PC Games",
    "Action & RPG",
    "Battle Royale",
    "Shooter & FPS",
    "Open World",
    "Online Multiplayer",
    "Indie & HTML5",
    "Strategy & Simulation",
    "Racing & Sports",
    "Survival & Horror",
  ];

  const loadSummary = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await authApi.get(`/admin/summary`);
      setSummary(data);
    } catch (err) {
      setMessage("❌ " + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadUsers = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await authApi.get(`/admin/users`);
      setUsers(data);
    } catch (err) {
      setMessage("❌ " + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadProducts = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await authApi.get(`/admin/products`);
      if (Array.isArray(data)) {
        setProducts(data);
      } else if (data && Array.isArray(data.products)) {
        setProducts(data.products);
      } else {
        setProducts([]);
      }
    } catch (err) {
      setMessage("❌ " + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadOrders = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await authApi.get(`/admin/orders`);
      setOrders(data);
    } catch (err) {
      setMessage("❌ " + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "summary") loadSummary();
    if (tab === "products") loadProducts();
    if (tab === "users") loadUsers();
    if (tab === "orders") loadOrders();
  }, [tab, loadSummary, loadProducts, loadUsers, loadOrders]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  };

  const resetForm = () => {
    setEditingId("");
    setSelectedFile(null);
    setUploadProgress(0);
    setUploadStatusText("");
    setUploadSpeed("");
    setForm({
      name: "",
      category: "PC Games",
      price: 0,
      discountPrice: 0,
      isFree: true,
      isOnlinePlayable: false,
      playOnlineUrl: "",
      apkDownloadUrl: "",
      img: "https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&q=80&w=1000",
      description: "",
      platform: "PC (Windows 10/11)",
      genre: "Action & Adventure",
      developer: "",
      publisher: "",
      edition: "Full Game (Standard)",
      size: "Full Game (Standard)",
      brand: "",
      inStock: true,
      isDownloadable: true,
      downloadSize: "",
      downloadUrl: "",
      uploadType: "executable",
      fileName: "",
      fileType: "",
      fileSizeBytes: 0,
      fileSha256: "",
      version: "1.0.0",
      filePath: "",
      webglEntryUrl: "",
      storageProvider: "server",
      storageUrl: "",
      requirementsOS: "Windows 10 / 11 (64-bit)",
      requirementsCPU: "Intel Core i5-8400 / AMD Ryzen 5 2600",
      requirementsRAM: "8 GB RAM",
      requirementsGPU: "NVIDIA GeForce GTX 1060 / AMD Radeon RX 580",
      requirementsStorage: "15 GB available space",
      systemRequirements: "Windows 10/11 64-bit, Intel i5 / Ryzen 5, 8GB RAM, GTX 1060, 15 GB Storage",
    });
  };

  const handleEdit = (product) => {
    setEditingId(product._id);
    const editionStr = Array.isArray(product.edition)
      ? product.edition.join(", ")
      : Array.isArray(product.size)
        ? product.size.join(", ")
        : product.edition || product.size || "Full Game (Standard)";

    setForm({
      name: product.name || "",
      category: product.category || "PC Games",
      price: product.price || 0,
      discountPrice: product.discountPrice || 0,
      isFree: product.isFree !== false,
      isOnlinePlayable: product.isOnlinePlayable || false,
      img: product.img || "",
      description: product.description || "",
      platform: product.platform || product.fabric || "PC (Windows 10/11)",
      genre: product.genre || product.occasion || "Action & Adventure",
      developer: product.developer || "",
      publisher: product.publisher || product.brand || "",
      edition: editionStr,
      size: editionStr,
      brand: product.brand || product.publisher || "",
      inStock: product.inStock !== false,
      isDownloadable: product.isDownloadable !== false,
      downloadSize: product.downloadSize || "",
      downloadUrl: product.downloadUrl || "",
      playOnlineUrl: product.playOnlineUrl || "",
      apkDownloadUrl: product.apkDownloadUrl || "",
      uploadType: product.uploadType || "executable",
      fileName: product.fileName || "",
      fileType: product.fileType || "",
      fileSizeBytes: product.fileSizeBytes || 0,
      fileSha256: product.fileSha256 || "",
      version: product.version || "1.0.0",
      filePath: product.filePath || "",
      webglEntryUrl: product.webglEntryUrl || "",
      storageProvider: product.storageProvider || "server",
      storageUrl: product.storageUrl || "",
      requirementsOS: product.requirementsOS || "Windows 10 / 11 (64-bit)",
      requirementsCPU: product.requirementsCPU || "Intel Core i5-8400 / AMD Ryzen 5 2600",
      requirementsRAM: product.requirementsRAM || "8 GB RAM",
      requirementsGPU: product.requirementsGPU || "NVIDIA GeForce GTX 1060 / AMD Radeon RX 580",
      requirementsStorage: product.requirementsStorage || "15 GB available space",
      systemRequirements:
        product.systemRequirements ||
        "Windows 10/11 64-bit, Intel i5 / Ryzen 5, 8GB RAM, GTX 1060, 15 GB Storage",
    });
    setTab("products");
  };

  const submitProduct = async () => {
    try {
      setLoading(true);
      const editionsArray = (form.edition || form.size || "Full Game (Standard)")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const sysReqFormatted =
        form.systemRequirements ||
        `${form.requirementsOS}, CPU: ${form.requirementsCPU}, RAM: ${form.requirementsRAM}, GPU: ${form.requirementsGPU}, Storage: ${form.requirementsStorage}`;

      const payload = {
        ...form,
        price: Number(form.price) || 0,
        discountPrice: form.discountPrice ? Number(form.discountPrice) : 0,
        edition: editionsArray,
        size: editionsArray,
        brand: form.publisher || form.brand || form.developer || "GameVault",
        fabric: form.platform || "PC (Windows 10/11)",
        occasion: form.genre || "Action & Adventure",
        systemRequirements: sysReqFormatted,
        isFree: Number(form.price) === 0,
        isOnlinePlayable: Boolean(form.playOnlineUrl || form.webglEntryUrl),
      };

      if (editingId && editingId !== "new") {
        await authApi.put(`/admin/products/${editingId}`, payload);
        setMessage("✅ Game updated successfully");
      } else {
        await authApi.post(`/admin/products`, payload);
        setMessage("✅ Game added to GameVault catalog!");
      }

      await loadProducts();
      resetForm();
    } catch (err) {
      setMessage("❌ " + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 25 * 1024 * 1024) {
      setMessage("❌ Cover image too large (max 25MB)");
      return;
    }

    try {
      setLoading(true);
      const formData = new FormData();
      formData.append("image", file);
      const { data } = await authApi.post("/admin/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const apiBase = process.env.REACT_APP_API_URL || "http://localhost:5000";
      const fullUrl = data.imageUrl?.startsWith("http") ? data.imageUrl : `${apiBase}${data.imageUrl}`;
      setForm((prev) => ({ ...prev, img: fullUrl }));
      setMessage("✅ Cover image uploaded successfully");
    } catch (err) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setForm((prev) => ({ ...prev, img: reader.result }));
        setMessage("✅ Cover image loaded locally");
      };
      reader.readAsDataURL(file);
    } finally {
      setLoading(false);
    }
  };

  const handleChunkedFileUpload = async (overrideFile) => {
    const file = overrideFile || selectedFile;
    if (!file) {
      setMessage("❌ Please select a game file to upload");
      return;
    }

    const max5GB = 5 * 1024 * 1024 * 1024;
    if (file.size > max5GB) {
      setMessage("❌ File exceeds 5 GB maximum limit");
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setUploadSpeed("0 MB/s");
    setUploadStatusText(`Preparing upload for ${file.name} (${(file.size / (1024 * 1024)).toFixed(1)} MB)...`);

    try {
      const CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB per slice
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
      const currentUploadType = form.uploadType || "executable";

      const { data: initData } = await authApi.post("/admin/upload-chunk/init", {
        fileName: file.name,
        fileSize: file.size,
        totalChunks,
        uploadType: currentUploadType,
        gameTitle: form.name || file.name,
      });

      const { uploadId } = initData;
      let uploadedBytes = 0;
      const startTime = Date.now();

      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        const start = chunkIndex * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunkBlob = file.slice(start, end);

        const formData = new FormData();
        formData.append("uploadId", uploadId);
        formData.append("chunkIndex", chunkIndex);
        formData.append("totalChunks", totalChunks);
        formData.append("chunk", chunkBlob, `part_${chunkIndex}`);

        await authApi.post("/admin/upload-chunk", formData, {
          headers: { "Content-Type": "multipart/form-data" },
        });

        uploadedBytes += chunkBlob.size;
        const percent = Math.round((uploadedBytes / file.size) * 100);
        setUploadProgress(percent);

        const elapsed = (Date.now() - startTime) / 1000;
        const speed = elapsed > 0 ? (uploadedBytes / (1024 * 1024) / elapsed).toFixed(1) : "0";
        setUploadSpeed(`${speed} MB/s`);
        setUploadStatusText(`Uploading chunk ${chunkIndex + 1}/${totalChunks} (${percent}%) - ${speed} MB/s`);
      }

      setUploadStatusText(
        currentUploadType === "webgl_zip"
          ? "Assembling archive & unzipping HTML5/WebGL game..."
          : "Assembling binary & calculating SHA-256 hash..."
      );

      const { data: result } = await authApi.post("/admin/upload-chunk/complete", {
        uploadId,
        fileName: file.name,
        totalChunks,
        uploadType: currentUploadType,
        version: form.version || "1.0.0",
        gameTitle: form.name || file.name,
      });

      setUploadProgress(100);
      setUploadStatusText("✅ Upload & verification complete!");

      const apiBase = process.env.REACT_APP_API_URL || "http://localhost:5000";
      const fullPlayUrl = result.playOnlineUrl
        ? (result.playOnlineUrl.startsWith("http") ? result.playOnlineUrl : `${apiBase}${result.playOnlineUrl}`)
        : form.playOnlineUrl;

      setForm((prev) => ({
        ...prev,
        fileName: result.fileName,
        fileType: result.fileType,
        fileSizeBytes: result.fileSizeBytes,
        downloadSize: result.downloadSize,
        fileSha256: result.fileSha256,
        filePath: result.filePath,
        downloadUrl: result.downloadUrl,
        version: result.version || prev.version,
        isDownloadable: true,
        ...(result.webglEntryUrl
          ? {
              webglEntryUrl: result.webglEntryUrl,
              playOnlineUrl: fullPlayUrl,
              isOnlinePlayable: true,
            }
          : {}),
      }));

      setMessage(
        `🎉 Uploaded ${result.fileName} (${result.downloadSize})! SHA-256: ${result.fileSha256.substring(0, 16)}...`
      );
      setSelectedFile(null);
    } catch (err) {
      console.error("Upload error:", err);
      setMessage("❌ Upload failed: " + (err.response?.data?.error || err.message));
      setUploadStatusText("❌ Upload failed");
    } finally {
      setIsUploading(false);
    }
  };

  const deleteProduct = async (id) => {
    if (!window.confirm("Are you sure you want to remove this game from the catalog?")) return;
    try {
      setLoading(true);
      await authApi.delete(`/admin/products/${id}`);
      setMessage("✅ Game removed");
      await loadProducts();
    } catch (err) {
      setMessage("❌ " + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  const updateUserRole = async (id, role) => {
    try {
      setLoading(true);
      await authApi.patch(`/admin/users/${id}/role`, { role });
      setMessage("✅ User role updated");
      await loadUsers();
    } catch (err) {
      setMessage("❌ " + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  const updateOrderStatus = async (id, statusField, value) => {
    try {
      setLoading(true);
      await authApi.patch(`/admin/orders/${id}/status`, { [statusField]: value });
      setMessage("✅ Order updated");
      await loadOrders();
    } catch (err) {
      setMessage("❌ " + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <h1>🎮 GameVault</h1>
        <p>Admin Command Center</p>

        <button className={tab === "summary" ? "active" : ""} onClick={() => setTab("summary")}>
          <span className="nav-icon">📊</span>
          <span>Analytics</span>
        </button>
        <button className={tab === "products" ? "active" : ""} onClick={() => setTab("products")}>
          <span className="nav-icon">🎮</span>
          <span>Games & Gear</span>
        </button>
        <button className={tab === "users" ? "active" : ""} onClick={() => setTab("users")}>
          <span className="nav-icon">👥</span>
          <span>Gamers ({users.length})</span>
        </button>
        <button className={tab === "orders" ? "active" : ""} onClick={() => setTab("orders")}>
          <span className="nav-icon">📦</span>
          <span>Orders ({orders.length})</span>
        </button>
        <button className="logout-btn" onClick={onLogout}>
          <span className="nav-icon">🚪</span>
          <span>Logout</span>
        </button>
      </aside>

      <main className="admin-content">
        <div className="admin-topbar">
          <div>
            <h2>Commander {user?.name || "Admin"} ⚡</h2>
            <p>{user?.email || "admin@gamevault.com"}</p>
          </div>
          <div className="admin-badge">Admin Privileges Active</div>
        </div>

        {message && <div className="admin-message">{message}</div>}
        {loading && <div className="admin-message loading">Loading GameVault database...</div>}

        {tab === "summary" && (
          <div className="summary-grid">
            <div className="stat-card">
              <h3>👥 Total Gamers</h3>
              <p>{summary.users || 0}</p>
            </div>
            <div className="stat-card">
              <h3>🎮 Games & Gear</h3>
              <p>{summary.products || 0}</p>
            </div>
            <div className="stat-card">
              <h3>📦 Total Orders</h3>
              <p>{summary.orders || 0}</p>
            </div>
            <div className="stat-card highlight">
              <h3>💰 Store Revenue</h3>
              <p>₹{Number(summary.revenue || 0).toLocaleString("en-IN")}</p>
            </div>
          </div>
        )}

        {tab === "products" && (
          <div className="table-card">
            <div className="panel-header luxe-flex">
              <div>
                <h3>Game & Inventory Catalog</h3>
                <p style={{ opacity: 0.7, margin: 0, fontSize: "0.85rem" }}>
                  Manage video game titles, consoles, editions, pricing, and stock.
                </p>
              </div>
              <button
                onClick={() => {
                  resetForm();
                  setEditingId("new");
                }}
                id="btn-add-product"
              >
                + Add New Game
              </button>
            </div>

            {editingId && (
              <div className="admin-edit-modal-box fade-in">
                <div className="modal-header-row">
                  <h4>{editingId === "new" ? "🎮 Add New Game to Store" : "✏️ Edit Game Details & Program Files"}</h4>
                  <button className="close-corner-btn" onClick={resetForm}>✕</button>
                </div>

                <div className="edit-form-grid">
                  <div className="input-group">
                    <label>Game Title *</label>
                    <input
                      name="name"
                      placeholder="e.g. Cyberpunk 2077, Free Fire Arena"
                      value={form.name}
                      onChange={handleChange}
                      required
                    />
                  </div>

                  <div className="input-group">
                    <label>Category</label>
                    <select name="category" value={form.category} onChange={handleChange}>
                      {categories.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="input-group">
                    <label>Platform</label>
                    <input
                      name="platform"
                      placeholder="e.g. PC (Windows 10/11), WebGL, Android"
                      value={form.platform}
                      onChange={handleChange}
                    />
                  </div>

                  <div className="input-group">
                    <label>Genre</label>
                    <input
                      name="genre"
                      placeholder="e.g. Action RPG, Battle Royale, Shooter"
                      value={form.genre}
                      onChange={handleChange}
                    />
                  </div>

                  <div className="input-group">
                    <label>Price (₹) — Set 0 for 100% Free</label>
                    <input
                      name="price"
                      type="number"
                      placeholder="0 for Free to Play"
                      value={form.price}
                      onChange={handleChange}
                    />
                  </div>

                  <div className="input-group">
                    <label>Publisher / Developer</label>
                    <input
                      name="publisher"
                      placeholder="e.g. Garena, Valve, Riot Games"
                      value={form.publisher}
                      onChange={handleChange}
                    />
                  </div>

                  {/* Cover Art Image Box */}
                  <div className="input-group full cover-art-section">
                    <label>Cover Art / Box Image</label>
                    <div className="cover-art-flex">
                      {form.img && (
                        <img
                          src={form.img}
                          alt="Cover Preview"
                          className="cover-preview-img"
                          onError={(e) => {
                            e.target.src = "https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&q=80&w=1000";
                          }}
                        />
                      )}
                      <div className="cover-art-inputs">
                        <input
                          name="img"
                          placeholder="Paste image URL (https://...)"
                          value={form.img}
                          onChange={handleChange}
                        />
                        <div className="file-upload-row">
                          <label className="file-browse-btn">
                            📁 Upload Cover Image from PC
                            <input
                              type="file"
                              accept="image/*"
                              onChange={handleImageUpload}
                              style={{ display: "none" }}
                            />
                          </label>
                          <span className="file-hint">Max 25 MB (JPG, PNG, WebP)</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="input-group full">
                    <label>Game Storyline & Description</label>
                    <textarea
                      name="description"
                      rows={3}
                      placeholder="Gameplay mechanics, storyline, multiplayer modes, key features..."
                      value={form.description}
                      onChange={handleChange}
                    />
                  </div>

                  {/* 🎮 ADVANCED GAME FILE & CHUNKED UPLOADER CARD (Supports up to 5 GB) */}
                  <div className="input-group full game-uploader-card">
                    <div className="uploader-header">
                      <div>
                        <h5>⚡ Game Program File & WebGL Uploader</h5>
                        <p>Upload PC setup installers, portable ZIP/RAR folders, or HTML5/WebGL game archives (Up to 5 GB with chunked resumable upload & SHA-256 verification)</p>
                      </div>
                      <span className="uploader-badge">5 GB Chunked Engine</span>
                    </div>

                    <div className="upload-type-tabs">
                      <button
                        type="button"
                        className={form.uploadType === "executable" ? "type-tab active" : "type-tab"}
                        onClick={() => setForm((p) => ({ ...p, uploadType: "executable" }))}
                      >
                        💻 PC Installer (.exe)
                      </button>
                      <button
                        type="button"
                        className={form.uploadType === "portable_zip" ? "type-tab active" : "type-tab"}
                        onClick={() => setForm((p) => ({ ...p, uploadType: "portable_zip" }))}
                      >
                        📦 Portable Game (.zip / .rar)
                      </button>
                      <button
                        type="button"
                        className={form.uploadType === "webgl_zip" ? "type-tab active" : "type-tab"}
                        onClick={() => setForm((p) => ({ ...p, uploadType: "webgl_zip", isOnlinePlayable: true }))}
                      >
                        🌐 HTML5 / WebGL (.zip)
                      </button>
                      <button
                        type="button"
                        className={form.uploadType === "external_url" ? "type-tab active" : "type-tab"}
                        onClick={() => setForm((p) => ({ ...p, uploadType: "external_url" }))}
                      >
                        ☁️ Cloud URL (R2 / S3)
                      </button>
                    </div>

                    {form.uploadType !== "external_url" ? (
                      <div className="dropzone-box">
                        <input
                          id="game-file-input"
                          type="file"
                          accept={
                            form.uploadType === "executable"
                              ? ".exe,.msi"
                              : form.uploadType === "webgl_zip"
                                ? ".zip"
                                : ".zip,.rar,.7z,.exe"
                          }
                          onChange={(e) => {
                            if (e.target.files[0]) {
                              setSelectedFile(e.target.files[0]);
                            }
                          }}
                          style={{ display: "none" }}
                        />

                        <div className="file-selection-display">
                          {selectedFile ? (
                            <div className="selected-file-info">
                              <span className="file-icon">📄</span>
                              <div>
                                <strong>{selectedFile.name}</strong>
                                <span>{(selectedFile.size / (1024 * 1024)).toFixed(2)} MB ({selectedFile.type || "Program File"})</span>
                              </div>
                              <button
                                type="button"
                                className="change-file-btn"
                                onClick={() => document.getElementById("game-file-input").click()}
                                disabled={isUploading}
                              >
                                Change
                              </button>
                            </div>
                          ) : (
                            <div
                              className="drag-prompt"
                              onClick={() => document.getElementById("game-file-input").click()}
                            >
                              <span className="upload-cloud-icon">☁️</span>
                              <strong>Click to choose a Game Program File</strong>
                              <span>
                                {form.uploadType === "executable" && "Accepts Windows setup installers (.exe, .msi)"}
                                {form.uploadType === "portable_zip" && "Accepts portable game directories (.zip, .rar, .7z)"}
                                {form.uploadType === "webgl_zip" && "Accepts Unity WebGL, Godot, or Phaser builds (.zip with index.html)"}
                              </span>
                            </div>
                          )}
                        </div>

                        {selectedFile && !isUploading && (
                          <div className="upload-trigger-row">
                            <button
                              type="button"
                              className="btn-start-upload"
                              onClick={() => handleChunkedFileUpload()}
                            >
                              🚀 Upload Game via 5 GB Chunked Engine
                            </button>
                          </div>
                        )}

                        {/* Animated Live Progress Bar */}
                        {isUploading && (
                          <div className="progress-container fade-in">
                            <div className="progress-meta-row">
                              <span className="status-text">{uploadStatusText}</span>
                              <span className="speed-text">{uploadSpeed}</span>
                            </div>
                            <div className="progress-track">
                              <div
                                className="progress-fill"
                                style={{ width: `${uploadProgress}%` }}
                              />
                            </div>
                            <div className="progress-percent-label">{uploadProgress}% Complete</div>
                          </div>
                        )}
                      </div>
                    ) : (
                      /* Cloud URL Input for Cloudflare R2 / S3 */
                      <div className="cloud-url-box fade-in">
                        <div className="input-group full">
                          <label>Direct Cloud Storage Download Link (Cloudflare R2 / Amazon S3 / CDN)</label>
                          <input
                            name="storageUrl"
                            placeholder="https://pub-xxxx.r2.dev/games/my-game-installer.exe"
                            value={form.storageUrl}
                            onChange={handleChange}
                          />
                        </div>
                      </div>
                    )}

                    {/* Verified Metadata Card */}
                    {(form.fileSha256 || form.fileName) && (
                      <div className="verified-meta-box fade-in">
                        <div className="meta-badge-title">
                          <span>🛡️ Verified Game Program Package</span>
                          <span className="sha-verified-pill">✓ SHA-256 Computed</span>
                        </div>
                        <div className="meta-grid">
                          <div>
                            <small>File Name:</small>
                            <strong>{form.fileName || "game_setup.exe"}</strong>
                          </div>
                          <div>
                            <small>Size:</small>
                            <strong>{form.downloadSize || "N/A"}</strong>
                          </div>
                          <div>
                            <small>Version:</small>
                            <input
                              name="version"
                              className="small-meta-input"
                              value={form.version}
                              onChange={handleChange}
                              placeholder="v1.0.0"
                            />
                          </div>
                          <div>
                            <small>Format:</small>
                            <strong>{form.fileType?.toUpperCase() || ".EXE"}</strong>
                          </div>
                        </div>
                        <div className="sha-row">
                          <small>SHA-256 Hash:</small>
                          <code>{form.fileSha256 || "Pending upload..."}</code>
                        </div>
                        {form.webglEntryUrl && (
                          <div className="webgl-entry-row">
                            <small>WebGL Entrypoint:</small>
                            <a
                              href={form.playOnlineUrl || form.webglEntryUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="webgl-preview-link"
                            >
                              ▶ Test Play Online: {form.webglEntryUrl} ↗
                            </a>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 🖥️ SYSTEM REQUIREMENTS BUILDER */}
                  <div className="input-group full system-requirements-card">
                    <div className="requirements-header">
                      <h5>🖥️ System Requirements Specification</h5>
                      <p>Specify the hardware specifications required to run this game smoothly on PC</p>
                    </div>

                    <div className="sys-req-grid">
                      <div>
                        <label>Operating System</label>
                        <input
                          name="requirementsOS"
                          placeholder="e.g. Windows 10 / 11 (64-bit)"
                          value={form.requirementsOS}
                          onChange={handleChange}
                        />
                      </div>
                      <div>
                        <label>Processor / CPU</label>
                        <input
                          name="requirementsCPU"
                          placeholder="e.g. Intel Core i5-8400 / AMD Ryzen 5 2600"
                          value={form.requirementsCPU}
                          onChange={handleChange}
                        />
                      </div>
                      <div>
                        <label>Memory / RAM</label>
                        <input
                          name="requirementsRAM"
                          placeholder="e.g. 8 GB RAM / 16 GB"
                          value={form.requirementsRAM}
                          onChange={handleChange}
                        />
                      </div>
                      <div>
                        <label>Graphics Card / GPU</label>
                        <input
                          name="requirementsGPU"
                          placeholder="e.g. NVIDIA GTX 1060 (6GB) / AMD RX 580"
                          value={form.requirementsGPU}
                          onChange={handleChange}
                        />
                      </div>
                      <div>
                        <label>Storage Required</label>
                        <input
                          name="requirementsStorage"
                          placeholder="e.g. 15 GB available space"
                          value={form.requirementsStorage}
                          onChange={handleChange}
                        />
                      </div>
                      <div>
                        <label>Storage Provider</label>
                        <select
                          name="storageProvider"
                          value={form.storageProvider}
                          onChange={handleChange}
                        >
                          <option value="server">Local GameVault Server</option>
                          <option value="r2">Cloudflare R2 Bucket</option>
                          <option value="s3">Amazon AWS S3 Bucket</option>
                          <option value="external">External CDN</option>
                        </select>
                      </div>
                    </div>

                    <div className="sys-req-preview">
                      <small>Combined Requirements Summary:</small>
                      <input
                        name="systemRequirements"
                        value={form.systemRequirements}
                        onChange={handleChange}
                        placeholder="OS: Windows 10/11, CPU: Intel i5, RAM: 8GB..."
                      />
                    </div>
                  </div>

                  {/* Play Online & Mobile Links */}
                  <div className="input-group">
                    <label>Play Online URL (Web Browser Game Link)</label>
                    <input
                      name="playOnlineUrl"
                      placeholder="e.g. /games/mini-militia.html or /uploads/webgl/my-game/index.html"
                      value={form.playOnlineUrl}
                      onChange={handleChange}
                    />
                  </div>

                  <div className="input-group">
                    <label>Android APK Download URL (Optional)</label>
                    <input
                      name="apkDownloadUrl"
                      placeholder="https://..."
                      value={form.apkDownloadUrl}
                      onChange={handleChange}
                    />
                  </div>

                  <div className="input-group full flex-row-gap">
                    <label className="checkbox-label">
                      <input
                        name="inStock"
                        type="checkbox"
                        checked={form.inStock}
                        onChange={handleChange}
                      />
                      Active & Listed in Catalog
                    </label>

                    <label className="checkbox-label">
                      <input
                        name="isDownloadable"
                        type="checkbox"
                        checked={form.isDownloadable}
                        onChange={handleChange}
                      />
                      ⚡ PC Program File Downloadable
                    </label>

                    <label className="checkbox-label">
                      <input
                        name="isOnlinePlayable"
                        type="checkbox"
                        checked={form.isOnlinePlayable}
                        onChange={handleChange}
                      />
                      🌐 In-Browser HTML5 / WebGL Playable
                    </label>
                  </div>
                </div>

                <div className="form-action-row">
                  <button className="primary-action-btn" onClick={submitProduct} disabled={isUploading}>
                    {editingId === "new" ? "Save & Publish Game" : "Update Game & Files"}
                  </button>
                  <button className="secondary" onClick={resetForm} disabled={isUploading}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Cover</th>
                    <th>Game Title & Platform</th>
                    <th>Genre & Developer</th>
                    <th>Delivery & Size</th>
                    <th>Price</th>
                    <th>Stock</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) =>
                    editingId === p._id ? (
                      <tr key={p._id} className="edit-row fade-in">
                        <td data-label="Cover">
                          <img
                            src={form.img || p.img}
                            alt=""
                            className="admin-product-thumb"
                            onError={(e) => {
                              e.target.src =
                                "https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&q=80&w=1000";
                            }}
                          />
                          <input
                            id={`edit-file-${p._id}`}
                            type="file"
                            accept="image/*"
                            onChange={handleImageUpload}
                            style={{ display: "none" }}
                          />
                          <button
                            onClick={() => document.getElementById(`edit-file-${p._id}`).click()}
                            className="small-action-btn luxe-block"
                          >
                            Upload
                          </button>
                        </td>
                        <td data-label="Game Title">
                          <input
                            name="name"
                            value={form.name}
                            onChange={handleChange}
                            className="input-full m-bottom-4"
                          />
                          <input
                            name="platform"
                            value={form.platform}
                            onChange={handleChange}
                            className="input-full"
                          />
                        </td>
                        <td data-label="Genre & Developer">
                          <input
                            name="genre"
                            value={form.genre}
                            onChange={handleChange}
                            className="input-full m-bottom-4"
                          />
                          <input
                            name="publisher"
                            value={form.publisher}
                            onChange={handleChange}
                            className="input-full"
                          />
                        </td>
                        <td data-label="Delivery">
                          <input
                            name="downloadSize"
                            value={form.downloadSize}
                            onChange={handleChange}
                            placeholder="Size (e.g. 85 GB)"
                            className="input-small m-bottom-4"
                          />
                          <label className="checkbox-label" style={{ fontSize: "0.75rem" }}>
                            <input
                              name="isDownloadable"
                              type="checkbox"
                              checked={form.isDownloadable}
                              onChange={handleChange}
                            />
                            ⚡ Downloadable
                          </label>
                        </td>
                        <td data-label="Price">
                          <input
                            name="price"
                            type="number"
                            value={form.price}
                            onChange={handleChange}
                            className="input-small m-bottom-4"
                          />
                          <input
                            name="discountPrice"
                            type="number"
                            placeholder="Sale ₹"
                            value={form.discountPrice}
                            onChange={handleChange}
                            className="input-small"
                          />
                        </td>
                        <td data-label="Stock">
                          <input
                            name="inStock"
                            type="checkbox"
                            checked={form.inStock}
                            onChange={handleChange}
                          />
                        </td>
                        <td data-label="Actions">
                          <div className="new-row-actions">
                            <button onClick={submitProduct}>Update</button>
                            <button className="secondary" onClick={resetForm}>
                              Cancel
                            </button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      <tr key={p._id}>
                        <td data-label="Cover">
                          <img
                            src={p.img}
                            alt={p.name}
                            className="admin-product-thumb"
                            crossOrigin="anonymous"
                            onError={(e) => {
                              e.target.src =
                                "https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&q=80&w=1000";
                            }}
                          />
                        </td>
                        <td data-label="Game Title">
                          <strong>{p.name}</strong>
                          <br />
                          <span className="platform-admin-badge">
                            {p.platform || p.fabric || "PC / Console"}
                          </span>
                        </td>
                        <td data-label="Genre & Developer">
                          <span>{p.genre || p.occasion || "Video Game"}</span>
                          <br />
                          <span style={{ fontSize: "0.8rem", opacity: 0.7 }}>
                            {p.publisher || p.developer || p.brand || "GameVault"}
                          </span>
                        </td>
                        <td data-label="Delivery">
                          {p.isDownloadable !== false && p.category !== "Consoles" && p.category !== "Accessories" ? (
                            <span
                              className="platform-admin-badge"
                              style={{
                                background: "rgba(0, 240, 255, 0.15)",
                                color: "#00f0ff",
                                borderColor: "rgba(0, 240, 255, 0.4)",
                              }}
                            >
                              ⚡ {p.downloadSize || "60 GB"}
                            </span>
                          ) : (
                            <span
                              className="platform-admin-badge"
                              style={{ background: "rgba(255, 255, 255, 0.08)", color: "#cbd5e1" }}
                            >
                              📦 Hardware
                            </span>
                          )}
                        </td>
                        <td data-label="Price">
                          <strong>₹{(p.discountPrice || p.price).toLocaleString()}</strong>
                          {p.discountPrice && p.discountPrice < p.price && (
                            <div style={{ textDecoration: "line-through", opacity: 0.5, fontSize: "0.8rem" }}>
                              ₹{p.price.toLocaleString()}
                            </div>
                          )}
                        </td>
                        <td data-label="Stock">{p.inStock ? "🟢 In Stock" : "🔴 Sold Out"}</td>
                        <td data-label="Actions">
                          <div className="table-btn-group">
                            <button onClick={() => handleEdit(p)}>Edit</button>
                            <button className="secondary" onClick={() => deleteProduct(p._id)}>
                              Del
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "users" && (
          <div className="table-card">
            <h3>Registered Gamers ({users.length})</h3>
            <table>
              <thead>
                <tr>
                  <th>Gamer Tag / Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Joined Date</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u._id}>
                    <td data-label="Name">
                      <strong>🎮 {u.name}</strong>
                    </td>
                    <td data-label="Email">{u.email}</td>
                    <td data-label="Role">
                      <select
                        value={u.role}
                        onChange={(e) => updateUserRole(u._id, e.target.value)}
                        className={`role-select ${u.role === "admin" ? "role-admin" : "role-user"}`}
                      >
                        <option value="user">Gamer (user)</option>
                        <option value="admin">Commander (admin)</option>
                      </select>
                    </td>
                    <td data-label="Joined">
                      {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === "orders" && (
          <div className="table-card">
            <h3>Customer Game Orders ({orders.length})</h3>
            <table>
              <thead>
                <tr>
                  <th>Gamer & Order ID</th>
                  <th>Items & Editions</th>
                  <th>Shipping Address</th>
                  <th>Payment</th>
                  <th>Order Status</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o._id} className="order-row">
                    <td data-label="Gamer">
                      <strong>{o.user?.name || "Gamer"}</strong>
                      <br />
                      <span style={{ opacity: 0.7, fontSize: "0.85rem" }}>{o.user?.email || "-"}</span>
                      <div className="order-id-label">ID: {o._id.slice(-8)}</div>
                    </td>
                    <td data-label="Items">
                      <div className="order-items-mini">
                        {(o.items || []).map((item, idx) => (
                          <div key={idx} className="admin-order-item">
                            <span className="game-bullet">🎮</span>
                            <div className="admin-item-info">
                              <b>{item.name}</b>
                              <span className="admin-size-badge">
                                {item.edition || item.size || "Standard"}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td data-label="Address">
                      <div className="address-block">
                        <strong>{o.shippingAddress?.fullName || "-"}</strong>
                        <div>{o.shippingAddress?.phone}</div>
                        <div>{o.shippingAddress?.line1}</div>
                        <div>
                          {o.shippingAddress?.city}, {o.shippingAddress?.state} - {o.shippingAddress?.pincode}
                        </div>
                      </div>
                    </td>
                    <td data-label="Payment">
                      <div>{o.paymentMethod?.toUpperCase() || "UPI"}</div>
                      <select
                        className="status-select"
                        value={o.paymentStatus || "pending"}
                        onChange={(e) => updateOrderStatus(o._id, "paymentStatus", e.target.value)}
                      >
                        <option value="pending">pending</option>
                        <option value="paid">paid</option>
                        <option value="failed">failed</option>
                      </select>
                    </td>
                    <td data-label="Status">
                      <select
                        className="status-select"
                        value={o.orderStatus || "pending"}
                        onChange={(e) => updateOrderStatus(o._id, "orderStatus", e.target.value)}
                      >
                        <option value="pending">pending</option>
                        <option value="confirmed">confirmed</option>
                        <option value="shipped">shipped</option>
                        <option value="delivered">delivered</option>
                        <option value="cancelled">cancelled</option>
                      </select>
                    </td>
                    <td data-label="Total">
                      <strong>₹{(o.totalAmount || 0).toLocaleString()}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}

export default AdminDashboard;
