import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import "./Dashboard.css";
import { authApi, fetchOrders as fetchOrdersApi, API_BASE } from "./api";

function Dashboard({ user = {}, onLogout, onLogin }) {
  const iframeWrapperRef = useRef(null);
  const [cart, setCart] = useState([]);
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [message, setMessage] = useState("");
  const [activeTab, setActiveTab] = useState("home");
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedEdition, setSelectedEdition] = useState("Standard Edition");
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [shippingAddress, setShippingAddress] = useState({
    fullName: "",
    phone: "",
    line1: "",
    line2: "",
    city: "",
    state: "",
    pincode: "",
    landmark: "",
  });
  const [checkoutStep, setCheckoutStep] = useState(1);
  const [paymentMethod] = useState("free");
  const [isOrdering, setIsOrdering] = useState(false);
  const [createdOrder, setCreatedOrder] = useState(null);
  const [activeOnlineGame, setActiveOnlineGame] = useState(null);

  const SUPPORT_NUMBER = "7778952523";

  const handleCall = () => {
    window.location.href = `tel:${SUPPORT_NUMBER}`;
  };

  const handleImgError = (e) => {
    e.target.src = "https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&q=80&w=1000";
  };

  const categories = useMemo(
    () => [
      "all",
      "PC Games",
      "Action & RPG",
      "Battle Royale",
      "Multiplayer Action",
      "Shooter",
    ],
    []
  );

  const normalizeText = (value = "") =>
    value.toString().toLowerCase().trim();

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const name = normalizeText(p.name);
      const description = normalizeText(p.description);
      const category = normalizeText(p.category || "");
      const platform = normalizeText(p.platform || p.fabric || "");
      const genre = normalizeText(p.genre || p.occasion || "");
      const brand = normalizeText(p.brand || p.publisher || p.developer || "");
      const search = normalizeText(searchTerm);
      const selectedCategory = normalizeText(categoryFilter);

      const matchesCategory =
        selectedCategory === "all" ||
        category.includes(selectedCategory) ||
        platform.includes(selectedCategory) ||
        genre.includes(selectedCategory) ||
        name.includes(selectedCategory);

      const matchesSearch =
        !search ||
        name.includes(search) ||
        description.includes(search) ||
        category.includes(search) ||
        platform.includes(search) ||
        genre.includes(search) ||
        brand.includes(search);

      return matchesCategory && matchesSearch;
    });
  }, [products, searchTerm, categoryFilter]);

  const fetchProducts = useCallback(async () => {
    try {
      const { data } = await authApi.get(`/products`);
      if (Array.isArray(data)) {
        setProducts(data);
      } else if (data && Array.isArray(data.products)) {
        setProducts(data.products);
      } else {
        setProducts([]);
      }
    } catch (err) {
      console.error(err);
      setMessage("⚠️ Failed to load game catalog");
    }
  }, []);

  const fetchOrders = useCallback(async () => {
    if (!user?.email) return;
    try {
      const { data } = await fetchOrdersApi(user.email);
      setOrders(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("fetchOrders error:", err);
    }
  }, [user?.email]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const handleAddressChange = (e) => {
    const { name, value } = e.target;
    setShippingAddress((prev) => ({ ...prev, [name]: value }));
  };

  const updateCartItemEdition = (index, newEdition) => {
    const updatedCart = [...cart];
    updatedCart[index] = { ...updatedCart[index], edition: newEdition, size: newEdition };
    setCart(updatedCart);
  };

  const addToCart = (product, editionOverride) => {
    const edition =
      editionOverride ||
      selectedEdition ||
      (Array.isArray(product.edition) && product.edition[0]) ||
      (Array.isArray(product.size) && product.size[0]) ||
      "Standard Edition";

    const itemToAdd = {
      ...product,
      edition,
      size: edition,
      count: 1,
    };

    setCart((prev) => [...prev, itemToAdd]);
    setMessage(`✅ Added "${product.name}" (${edition}) to cart`);
    setTimeout(() => setMessage(""), 3500);
    return true;
  };

  const removeFromCart = (index) => {
    setCart((prev) => prev.filter((_, idx) => idx !== index));
    setMessage("⚠️ Removed item from cart");
    setTimeout(() => setMessage(""), 3000);
  };

  const totalCartAmount = useMemo(() => {
    return cart.reduce((sum, item) => sum + Number(item.discountPrice || item.price || 0), 0);
  }, [cart]);

  const handleCreateOrder = async () => {
    if (!cart.length) {
      setMessage("⚠️ Cart is empty");
      return;
    }
    if (!user?.email) {
      setMessage("⚠️ Please log in to complete your order");
      onLogin();
      return;
    }
    if (!shippingAddress.fullName || !shippingAddress.phone || !shippingAddress.line1) {
      setMessage("⚠️ Please fill in all required shipping details");
      return;
    }

    try {
      setIsOrdering(true);
      setMessage("");
      const orderPayload = {
        user: {
          name: user.name || shippingAddress.fullName,
          email: user.email,
          phone: shippingAddress.phone,
        },
        items: cart.map((item) => ({
          product: item._id,
          name: item.name,
          price: item.discountPrice || item.price,
          img: item.img,
          size: item.size || item.edition || "Standard Edition",
          edition: item.edition || item.size || "Standard Edition",
          platform: item.platform || item.fabric || "PC / Console",
          brand: item.brand || item.publisher || "GameVault",
          count: item.count || 1,
          isDownloadable: item.isDownloadable !== false && item.category !== "Consoles" && item.category !== "Accessories",
          downloadSize: item.downloadSize || "60 GB",
          downloadUrl: item.downloadUrl || "",
        })),
        shippingAddress,
        paymentMethod,
      };

      const res = await authApi.post(`/checkout/create-order`, orderPayload);
      setCreatedOrder(res.data);
      setCart([]);
      setCheckoutStep(3);
      setMessage("🎉 Order placed successfully!");
      await fetchOrders();
    } catch (err) {
      setMessage("❌ Failed to place order: " + (err.response?.data?.error || err.message));
    } finally {
      setIsOrdering(false);
    }
  };

  const cancelOrder = async (orderId) => {
    if (!orderId) return;
    try {
      await authApi.delete(`/checkout/orders/${orderId}`);
      setMessage("✅ Order cancelled successfully");
      await fetchOrders();
      setTimeout(() => setMessage(""), 3500);
    } catch (err) {
      setMessage("❌ Failed to cancel order: " + (err.response?.data?.error || err.message));
    }
  };

  const handleCopyKey = (key) => {
    if (!key) return;
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(key);
      setMessage(`📋 Digital License Key copied: ${key}`);
    } else {
      setMessage(`🔑 Key: ${key}`);
    }
    setTimeout(() => setMessage(""), 3500);
  };

  const handleDownloadGame = (item) => {
    const gameName = item.name || item.title || "Game";
    const idOrSku = item._id || item.sku || encodeURIComponent(gameName.toLowerCase().replace(/[^a-z0-9]/g, "-"));
    const base = API_BASE ? API_BASE.replace(/\/$/, "") : "";

    let downloadUrl = item.downloadUrl;
    if (item.storageUrl && item.storageUrl.startsWith("http")) {
      downloadUrl = item.storageUrl;
    } else if (downloadUrl && downloadUrl.startsWith("http") && !downloadUrl.includes("downloads.gamevault.io")) {
      // Use direct external link
    } else if (downloadUrl && downloadUrl.startsWith("/api/")) {
      downloadUrl = `${base}${downloadUrl}`;
    } else {
      downloadUrl = `${base}/api/products/download/${encodeURIComponent(item._id || idOrSku)}`;
    }

    const defaultExt = item.fileType || (item.uploadType === "portable_zip" ? ".zip" : ".exe");
    const downloadFileName = item.fileName || `${gameName.replace(/[^a-zA-Z0-9_-]/g, "_")}${defaultExt}`;

    setMessage(`🚀 Initializing high-speed direct download for ${gameName} (${item.downloadSize || "Full Game"})...`);
    try {
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.setAttribute("download", downloadFileName);
      link.setAttribute("target", "_blank");
      link.setAttribute("rel", "noopener noreferrer");
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (e) {
      window.open(downloadUrl, "_blank");
    }
    setTimeout(() => setMessage(""), 4500);
  };

  const toggleIframeFullscreen = () => {
    if (!document.fullscreenElement) {
      if (iframeWrapperRef.current?.requestFullscreen) {
        iframeWrapperRef.current.requestFullscreen();
      } else if (iframeWrapperRef.current?.webkitRequestFullscreen) {
        iframeWrapperRef.current.webkitRequestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  };

  const openProductModal = (p) => {
    setSelectedProduct(p);
    const defaultEdition =
      (Array.isArray(p.edition) && p.edition[0]) ||
      (Array.isArray(p.size) && p.size[0]) ||
      "Standard Edition";
    setSelectedEdition(defaultEdition);
  };

  const renderProductCard = (p) => {
    return (
      <div key={p._id} className="product-card fade-in" onClick={() => openProductModal(p)}>
        <div className="product-logo-container">
          <img
            src={p.logoUrl || p.img}
            alt={p.name}
            className="product-card-square-logo"
            onError={handleImgError}
            crossOrigin="anonymous"
          />
          <div className="platform-tag">{p.platform || p.fabric || "PC (Windows)"}</div>
          {p.version && <div className="card-version-tag">v{p.version}</div>}
          {p.downloadSize && (
            <div className="digital-dl-tag">
              💾 {p.downloadSize}
            </div>
          )}
        </div>

        <div className="product-body">
          <div className="product-genre-row">
            <span className="genre-text">{p.genre || p.occasion || "PC Game"}</span>
            <span className="rating-pill">⭐ {p.ratings || 4.9}</span>
          </div>

          <h4 className="brand-product-title">{p.name || p.title}</h4>

          <div className="price-row free-pricing">
            <span className="free-price-tag">FREE DOWNLOAD</span>
            <span className="free-verified-badge">🛡️ Verified Clean</span>
          </div>

          <div className="game-card-actions">
            <button
              className="free-dl-card-btn full-width-btn"
              title="Download PC Game Program Files"
              onClick={(e) => {
                e.stopPropagation();
                handleDownloadGame(p);
              }}
            >
              📥 Free Download
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderTabContent = () => {
    if (selectedProduct) {
      const editionsList =
        (Array.isArray(selectedProduct.edition) && selectedProduct.edition.length > 0 && selectedProduct.edition) ||
        (Array.isArray(selectedProduct.size) && selectedProduct.size.length > 0 && selectedProduct.size) ||
        ["Standard Edition", "Deluxe Edition"];

      return (
        <div className="modal-overlay" onClick={() => setSelectedProduct(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="back-btn" onClick={() => setSelectedProduct(null)}>
              ← Back to Catalog
            </button>

            <div className="product-details-shell luxe-grid">
              <div className="details-img-wrap logo-display-wrap">
                <img
                  src={selectedProduct.logoUrl || selectedProduct.img}
                  alt={selectedProduct.name}
                  className="modal-square-logo-main"
                  onError={handleImgError}
                  crossOrigin="anonymous"
                />
                <div className="modal-platform-badge">{selectedProduct.platform || selectedProduct.fabric || "PC (Windows)"}</div>
              </div>

              <div className="details-content">
                <button className="close-details" onClick={() => setSelectedProduct(null)}>
                  ✕
                </button>

                <div className="detail-header-flex">
                  <img
                    src={selectedProduct.logoUrl || selectedProduct.img}
                    alt={`${selectedProduct.name} Icon`}
                    className="modal-game-square-logo"
                    onError={handleImgError}
                    crossOrigin="anonymous"
                  />
                  <div className="detail-header-text">
                    <span className="detail-publisher">{selectedProduct.brand || selectedProduct.publisher || selectedProduct.developer || "GameVault Original"}</span>
                    <h2 className="detail-name">{selectedProduct.name}</h2>
                    <div className="modal-badge-row">
                      {selectedProduct.version && (
                        <span className="modal-version-tag">Version {selectedProduct.version}</span>
                      )}
                      <span className="modal-security-tag">🛡️ VirusTotal Clean • 0 Detections</span>
                    </div>
                  </div>
                </div>

                <div className="detail-pricing-box">
                  <span className="free-price-hero">100% FREE TO PLAY</span>
                  <span className="rating-pill">⭐ {selectedProduct.ratings || 4.9} ({selectedProduct.reviews?.toLocaleString() || "120K+"} Players)</span>
                </div>

                <p className="detail-desc">
                  {selectedProduct.description || "Next-gen gaming experience featuring cutting-edge visuals, deep gameplay, and high-replayability."}
                </p>

                <div className="detail-specs">
                  <span>🎮 {selectedProduct.genre || selectedProduct.occasion || "Action RPG"}</span>
                  <span className="dot">•</span>
                  <span>🕹️ {selectedProduct.platform || selectedProduct.fabric || "PC / Console"}</span>
                  <span className="dot">•</span>
                  <span>🛡️ {selectedProduct.rating || "ESRB M (17+)"}</span>
                  <span className="dot">•</span>
                  <span className={selectedProduct.inStock ? "text-success" : "text-error"}>
                    {selectedProduct.inStock ? "⚡ Instant Key / In Stock" : "Temporarily Sold Out"}
                  </span>
                </div>

                {selectedProduct.isDownloadable !== false &&
                  selectedProduct.category !== "Consoles" &&
                  selectedProduct.category !== "Accessories" && (
                    <div className="digital-download-box">
                      <div className="digital-download-box-top">
                        <span className="digital-icon">⚡</span>
                        <div>
                          <strong>
                            {selectedProduct.fileName
                              ? `Download ${selectedProduct.fileName}`
                              : "Instant PC Program Download & Verified Package"}
                          </strong>
                          <p>
                            Direct high-speed streaming with resume support
                            {selectedProduct.version ? ` • Version ${selectedProduct.version}` : ""}
                            {selectedProduct.fileType ? ` • ${selectedProduct.fileType.toUpperCase()}` : ""}
                          </p>
                        </div>
                      </div>
                      <div className="digital-meta-pills">
                        <span className="digital-pill">
                          💾 File Size: <b>{selectedProduct.downloadSize || "Free Game"}</b>
                        </span>
                        {selectedProduct.version && (
                          <span className="digital-pill">
                            🏷️ Version: <b>{selectedProduct.version}</b>
                          </span>
                        )}
                        <span className="digital-pill">🚀 High-Speed Direct Stream</span>
                        <span className="digital-pill">🛡️ Verified Clean & Safe</span>
                      </div>

                      {/* SHA-256 Integrity Verification Badge */}
                      {selectedProduct.fileSha256 && (
                        <div className="sha256-display-pill">
                          <span className="sha-label">🛡️ SHA-256 Checksum:</span>
                          <code className="sha-code">{selectedProduct.fileSha256}</code>
                          <button
                            type="button"
                            className="sha-copy-btn"
                            title="Copy SHA-256 Hash to Clipboard"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigator.clipboard.writeText(selectedProduct.fileSha256);
                              setMessage("📋 SHA-256 Checksum copied to clipboard!");
                              setTimeout(() => setMessage(""), 3500);
                            }}
                          >
                            Copy
                          </button>
                        </div>
                      )}

                      {/* Structured Hardware System Requirements */}
                      {(selectedProduct.requirementsOS ||
                        selectedProduct.requirementsCPU ||
                        selectedProduct.systemRequirements) && (
                        <div className="system-requirements-spec-box">
                          <div className="spec-box-title">
                            <span>🖥️ Hardware System Requirements (PC)</span>
                          </div>
                          <div className="spec-grid-row">
                            <div className="spec-cell">
                              <small>OS</small>
                              <span>{selectedProduct.requirementsOS || "Windows 10 / 11 (64-bit)"}</span>
                            </div>
                            <div className="spec-cell">
                              <small>Processor</small>
                              <span>{selectedProduct.requirementsCPU || "Intel Core i5 / AMD Ryzen 5"}</span>
                            </div>
                            <div className="spec-cell">
                              <small>Memory</small>
                              <span>{selectedProduct.requirementsRAM || "8 GB RAM"}</span>
                            </div>
                            <div className="spec-cell">
                              <small>Graphics</small>
                              <span>{selectedProduct.requirementsGPU || "NVIDIA GTX 1060 / AMD RX 580"}</span>
                            </div>
                            <div className="spec-cell">
                              <small>Storage</small>
                              <span>{selectedProduct.requirementsStorage || selectedProduct.downloadSize || "10 GB Space"}</span>
                            </div>
                          </div>
                          {selectedProduct.systemRequirements && (
                            <div className="spec-notes">
                              <strong>Note:</strong> {selectedProduct.systemRequirements}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                <div className="edition-selector-container">
                  <label className="edition-label">Select Edition:</label>
                  <div className="edition-chips">
                    {editionsList.map((ed) => (
                      <button
                        key={ed}
                        className={selectedEdition === ed ? "edition-chip active" : "edition-chip"}
                        onClick={() => setSelectedEdition(ed)}
                      >
                        {ed}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="modal-sticky-action modal-free-actions">
                  <button
                    className="free-download-hero-btn full-width-btn"
                    onClick={() => {
                      handleDownloadGame(selectedProduct);
                    }}
                  >
                    📥 FREE DOWNLOAD ({selectedProduct.downloadSize || "Full Game"})
                  </button>
                  {selectedProduct.apkDownloadUrl && (
                    <a
                      href={selectedProduct.apkDownloadUrl}
                      className="free-apk-hero-btn"
                      target="_blank"
                      rel="noopener noreferrer"
                      download
                    >
                      📱 DOWNLOAD APK
                    </a>
                  )}
                  <button
                    className="add-library-btn"
                    onClick={() => {
                      addToCart(selectedProduct, selectedEdition);
                      setSelectedProduct(null);
                    }}
                  >
                    ➕ Add to My Games Library
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    switch (activeTab) {
      case "home":
        return (
          <section className="dashboard-home">
            <div className="catalog-header-bar">
              <div>
                <h2>Welcome, {user?.name || "Player 1"} 🎮</h2>
                <p className="section-subtitle">
                  Download PC games directly with high-speed download links. Verified clean & virus-scanned.
                </p>
              </div>
              <div className="hero-actions">
                <button onClick={() => setActiveTab("products")}>🎮 Browse All PC Games</button>
              </div>
            </div>

            <div className="featured-platforms-strip">
              <div
                className="platform-card-pill"
                onClick={() => {
                  setCategoryFilter("Battle Royale");
                  setActiveTab("products");
                }}
              >
                <span>🔥</span> Free Fire & BGMI
              </div>
              <div
                className="platform-card-pill"
                onClick={() => {
                  setCategoryFilter("Multiplayer Action");
                  setActiveTab("products");
                }}
              >
                <span>💣</span> Mini Militia & 2D Combat
              </div>
              <div
                className="platform-card-pill"
                onClick={() => {
                  setCategoryFilter("Shooter");
                  setActiveTab("products");
                }}
              >
                <span>🎯</span> Valorant & Shooters
              </div>
              <div
                className="platform-card-pill"
                onClick={() => {
                  setCategoryFilter("PC Games");
                  setActiveTab("products");
                }}
              >
                <span>💻</span> PC Windows Games
              </div>
            </div>

            <div className="section-title-wrap">
              <h3 className="section-title">🔥 Featured PC Games & Downloads</h3>
              <button className="view-all-link" onClick={() => setActiveTab("products")}>
                View All Free Games →
              </button>
            </div>

            <div className="product-grid">
              {products.slice(0, 8).map(renderProductCard)}
            </div>
          </section>
        );

      case "products":
        return (
          <section className="products">
            <div className="section-header">
              <div>
                <h3 className="section-title">Explore PC Games & Downloads</h3>
                <p className="section-subtitle">
                  Browse 100% free downloadable PC games with high-speed direct downloads and virus scans.
                </p>
              </div>

              <div className="filters">
                <input
                  id="product-search"
                  name="productSearch"
                  type="text"
                  autoComplete="off"
                  placeholder="Search Free Fire, Mini Militia, Valorant, genres..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="search-input"
                />
                <select
                  id="category-filter"
                  name="categoryFilter"
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="search-input"
                >
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat === "all" ? "All Platforms & Genres" : cat}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="category-chips">
              {categories.map((cat) => (
                <button
                  key={cat}
                  className={categoryFilter === cat ? "chip active" : "chip"}
                  onClick={() => setCategoryFilter(cat)}
                >
                  {cat === "all" ? "All" : cat}
                </button>
              ))}
            </div>

            <div className="product-grid">
              {filteredProducts.length ? (
                filteredProducts.map(renderProductCard)
              ) : (
                <div className="empty-state">
                  <h4>No matching games found</h4>
                  <p>Try searching for a different title, console platform, or genre.</p>
                  <button className="chip active" onClick={() => { setSearchTerm(""); setCategoryFilter("all"); }}>
                    Reset Filters
                  </button>
                </div>
              )}
            </div>
          </section>
        );

      case "cart":
        return (
          <section className="cart">
            <h3 className="section-title">Your Gamer Cart ({cart.length} Items)</h3>

            {!cart.length && checkoutStep !== 3 ? (
              <div className="empty-state">
                <p>Your cart is empty. Ready to explore epic games?</p>
                <button className="grid-add-btn" onClick={() => setActiveTab("products")}>
                  Browse Games Now
                </button>
              </div>
            ) : checkoutStep === 3 ? (
              <div className="order-success-screen fade-in">
                <div className="success-icon">🎉</div>
                <h3>Order Confirmed!</h3>
                <p>Thank you for shopping at GameVault. Your order has been placed.</p>
                {createdOrder && (
                  <div className="order-receipt-card">
                    <p><b>Order ID:</b> {createdOrder.order?._id || createdOrder._id}</p>
                    <p><b>Total Amount:</b> ₹{createdOrder.order?.totalAmount || createdOrder.totalAmount}</p>
                    <p><b>Payment:</b> {createdOrder.order?.paymentMethod || paymentMethod}</p>
                    {createdOrder.upiUrl && (
                      <div className="upi-payment-box">
                        <p>Scan & Pay via UPI App:</p>
                        <a href={createdOrder.upiUrl} className="upi-pay-link">
                          Open UPI Payment App
                        </a>
                      </div>
                    )}

                    {(createdOrder.order?.items || createdOrder.items || []).some(
                      (it) => it.isDownloadable !== false && it.category !== "Consoles" && it.category !== "Accessories"
                    ) && (
                      <div className="instant-downloads-success-container">
                        <h4>⚡ Instant Downloads & License Keys Ready</h4>
                        {(createdOrder.order?.items || createdOrder.items || []).map((item, idx) => {
                          const isDl =
                            item.isDownloadable !== false &&
                            item.category !== "Consoles" &&
                            item.category !== "Accessories";
                          if (!isDl) return null;
                          return (
                            <div key={idx} className="instant-dl-row">
                              <div className="instant-dl-info">
                                <strong>🎮 {item.name}</strong>
                                <span className="dl-size-tag">💾 {item.downloadSize || "Digital"}</span>
                                {item.licenseKey && (
                                  <div className="license-key-tag">
                                    <span>KEY:</span>
                                    <code>{item.licenseKey}</code>
                                    <button
                                      type="button"
                                      className="copy-key-mini-btn"
                                      title="Copy Key"
                                      onClick={() => handleCopyKey(item.licenseKey)}
                                    >
                                      📋 Copy
                                    </button>
                                  </div>
                                )}
                              </div>
                              <button
                                type="button"
                                className="download-now-btn"
                                onClick={() => handleDownloadGame(item)}
                              >
                                📥 Download Game ({item.downloadSize || "Installer"})
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
                <div className="success-actions">
                  <button className="next-btn" onClick={() => { setActiveTab("orders"); setCheckoutStep(1); }}>
                    View My Orders
                  </button>
                  <button className="secondary" onClick={() => { setActiveTab("products"); setCheckoutStep(1); }}>
                    Continue Shopping
                  </button>
                </div>
              </div>
            ) : (
              <div className="checkout-grid">
                <div className="cart-list">
                  {/* Step Indicators */}
                  <div className="checkout-steps premium">
                    <span className={checkoutStep === 1 ? "step active" : "step"}>1. Game Editions</span>
                    <span className={checkoutStep === 2 ? "step active" : "step"}>2. Delivery & Payment</span>
                  </div>

                  {/* Step 1: Edition Selection */}
                  {checkoutStep === 1 && (
                    <div className="step-content fade-in">
                      <h4 className="step-title">1. Confirm Game Editions</h4>
                      {cart.map((item, idx) => {
                        const fullProduct = products.find((p) => p._id === item._id) || item;
                        const availableEditions =
                          (Array.isArray(fullProduct.edition) && fullProduct.edition.length > 0 && fullProduct.edition) ||
                          (Array.isArray(fullProduct.size) && fullProduct.size.length > 0 && fullProduct.size) ||
                          ["Standard Edition", "Deluxe Edition", "Collector's Edition"];

                        return (
                          <div key={idx} className="cart-item-stepped">
                            <img
                              src={item.img || "https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&q=80&w=1000"}
                              alt={item.name}
                              onError={handleImgError}
                            />
                            <div className="cart-item-info">
                              <h4>{item.name}</h4>
                              <p className="cart-item-platform">{item.platform || item.fabric || "PC / Console"}</p>
                              <p className="cart-item-price">₹{(item.discountPrice || item.price).toLocaleString()}</p>

                              <div className="size-confirm-grid">
                                {availableEditions.map((ed) => (
                                  <button
                                    key={ed}
                                    className={(item.edition || item.size) === ed ? "size-chip active" : "size-chip"}
                                    onClick={() => updateCartItemEdition(idx, ed)}
                                  >
                                    {ed}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <button className="remove-btn" onClick={() => removeFromCart(idx)}>
                              ✕
                            </button>
                          </div>
                        );
                      })}

                      <div className="cart-summary-bar">
                        <span>Total: <b>₹{totalCartAmount.toLocaleString()}</b></span>
                      </div>

                      <div className="step-actions">
                        <button className="next-btn" onClick={() => setCheckoutStep(2)}>
                          Next: Delivery & Checkout →
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Step 2: Delivery Address & Payment */}
                  {checkoutStep === 2 && (
                    <div className="step-content fade-in">
                      <h4 className="step-title">2. Delivery Address & Gamer Info</h4>
                      <div className="address-section luxury">
                        <div className="input-group">
                          <label>Full Name</label>
                          <input
                            id="shipping-fullName"
                            name="fullName"
                            placeholder="Gamer / Recipient Name"
                            value={shippingAddress.fullName}
                            onChange={handleAddressChange}
                          />
                        </div>
                        <div className="input-group">
                          <label>Mobile Number</label>
                          <input
                            id="shipping-phone"
                            name="phone"
                            placeholder="10-digit Mobile Number"
                            value={shippingAddress.phone}
                            onChange={handleAddressChange}
                          />
                        </div>
                        <div className="input-group full">
                          <label>Delivery Address / Street / House</label>
                          <input
                            id="shipping-line1"
                            name="line1"
                            placeholder="Flat / Building / Street address"
                            value={shippingAddress.line1}
                            onChange={handleAddressChange}
                          />
                        </div>
                        <div className="address-grid-3">
                          <div className="input-group">
                            <label>City</label>
                            <input
                              id="shipping-city"
                              name="city"
                              placeholder="City"
                              value={shippingAddress.city}
                              onChange={handleAddressChange}
                            />
                          </div>
                          <div className="input-group">
                            <label>State</label>
                            <input
                              id="shipping-state"
                              name="state"
                              placeholder="State"
                              value={shippingAddress.state}
                              onChange={handleAddressChange}
                            />
                          </div>
                          <div className="input-group">
                            <label>Pin Code</label>
                            <input
                              id="shipping-pincode"
                              name="pincode"
                              placeholder="Pincode"
                              value={shippingAddress.pincode}
                              onChange={handleAddressChange}
                            />
                          </div>
                        </div>

                        <div className="input-group full">
                          <label>Delivery & Claim Method</label>
                          <div className="payment-options-row">
                            <label className="payment-option-label selected">
                              <input
                                type="radio"
                                name="paymentMethod"
                                value="free"
                                checked={true}
                                readOnly
                              />
                              ⚡ 100% Free Instant Download & Claim (No Payment Required)
                            </label>
                          </div>
                        </div>
                      </div>

                      <div className="cart-summary-bar">
                        <span>Total: <b style={{ color: "#10b981", fontSize: "1.2rem" }}>FREE (₹0)</b></span>
                      </div>

                      <div className="step-actions split">
                        <button className="back-btn" onClick={() => setCheckoutStep(1)}>
                          ← Back to Game List
                        </button>
                        <button
                          className="next-btn"
                          disabled={isOrdering}
                          onClick={handleCreateOrder}
                        >
                          {isOrdering ? "Activating Free Games..." : "Claim & Get Instant Downloads 🚀"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        );

      case "orders":
        return (
          <section className="past-orders">
            <h3 className="section-title">Your Game Orders ({orders.length})</h3>
            {!orders.length ? (
              <div className="empty-state">
                <p>No game orders found for {user?.email || "this account"}.</p>
                <button className="grid-add-btn" onClick={() => setActiveTab("products")}>
                  Explore Games
                </button>
              </div>
            ) : (
              <div className="orders-grid">
                {orders.map((order) => (
                  <div key={order._id} className="order-card">
                    <div className="order-header-row">
                      <span className="order-id-tag">ID: {order._id.slice(-8)}</span>
                      <span className={`order-status-pill status-${order.orderStatus || "pending"}`}>
                        {order.orderStatus || "pending"}
                      </span>
                    </div>

                    <p className="order-meta-info">
                      <b>Date:</b> {order.createdAt ? new Date(order.createdAt).toLocaleDateString() : "-"}
                    </p>
                    <p className="order-meta-info">
                      <b>Payment:</b> {order.paymentMethod?.toUpperCase() || "UPI"} ({order.paymentStatus || "pending"})
                    </p>
                    <p className="order-meta-info">
                      <b>Ship to:</b> {order.shippingAddress?.fullName || ""}, {order.shippingAddress?.city || ""}
                    </p>
                    <p className="order-meta-info">
                      <b>Total:</b> ₹{(order.totalAmount || 0).toLocaleString()}
                    </p>

                    <div className="order-items-list">
                      {(order.items || []).map((item, idx) => {
                        const isDl =
                          item.isDownloadable !== false &&
                          item.category !== "Consoles" &&
                          item.category !== "Accessories";
                        return (
                          <div key={idx} className="order-item-row digital-order-row">
                            <div className="order-item-header">
                              <span className="order-item-name">🎮 {item.name}</span>
                              <span className="item-size-badge">{item.size || item.edition || "Standard"}</span>
                              {isDl && (
                                <span className="dl-badge-pill">💾 {item.downloadSize || "Digital"}</span>
                              )}
                            </div>

                            {isDl && order.orderStatus !== "cancelled" && (
                              <div className="order-digital-actions">
                                {item.licenseKey && (
                                  <div className="license-key-tag">
                                    <span className="key-label">KEY:</span>
                                    <code>{item.licenseKey}</code>
                                    <button
                                      type="button"
                                      className="copy-key-mini-btn"
                                      title="Copy Key"
                                      onClick={() => handleCopyKey(item.licenseKey)}
                                    >
                                      📋 Copy
                                    </button>
                                  </div>
                                )}
                                <button
                                  type="button"
                                  className="download-game-action-btn"
                                  onClick={() => handleDownloadGame(item)}
                                >
                                  📥 Download Game ({item.downloadSize || "Installer"})
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <button
                      className="cancel-order-btn"
                      disabled={["delivered", "cancelled"].includes(order.orderStatus)}
                      onClick={() => cancelOrder(order._id)}
                    >
                      {order.orderStatus === "cancelled" ? "Cancelled" : "Cancel Order"}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        );

      default:
        return null;
    }
  };

  return (
    <>
      {/* Desktop Header */}
      <header className="navbar">
        <div className="logo-wrap" onClick={() => { setActiveTab("home"); setSelectedProduct(null); }}>
          <h1 className="logo">🎮 GameVault</h1>
          <span>PC Games & Downloads</span>
        </div>

        <nav>
          <ul>
            <li
              className={activeTab === "home" ? "active" : ""}
              onClick={() => { setActiveTab("home"); setSelectedProduct(null); }}
            >
              Home
            </li>
            <li
              className={activeTab === "products" ? "active" : ""}
              onClick={() => { setActiveTab("products"); setSelectedProduct(null); }}
            >
              🎮 PC Games
            </li>
            <li
              className={activeTab === "cart" ? "active" : ""}
              onClick={() => { setActiveTab("cart"); setSelectedProduct(null); }}
            >
              📥 Download Queue ({cart.length})
            </li>
            <li
              className={activeTab === "orders" ? "active" : ""}
              onClick={() => { setActiveTab("orders"); setSelectedProduct(null); }}
            >
              ⭐ My Library
            </li>
            {user?.email ? (
              <li className="logout-nav-btn desktop-only" onClick={onLogout}>
                🚪 Logout ({user.name || "Gamer"})
              </li>
            ) : (
              <li className="login-nav-btn desktop-only" onClick={onLogin}>
                ⚡ Gamer Login
              </li>
            )}
          </ul>
        </nav>
      </header>

      {/* Mobile Header (Fixed) */}
      <header className="mobile-header">
        <h1 className="logo" onClick={() => { setActiveTab("home"); setSelectedProduct(null); }}>
          🎮 GameVault PC Games
        </h1>
        <div className="header-actions">
          {user?.email ? (
            <button className="logout-btn top-logout" onClick={onLogout}>
              Logout
            </button>
          ) : (
            <button className="login-btn top-login" onClick={onLogin}>
              Login
            </button>
          )}
        </div>
      </header>

      <div className="dashboard fade-in">
        {renderTabContent()}
        {message && <div className="toast-notification">{message}</div>}

        {/* Floating Support Button - Only on Orders Page */}
        {activeTab === "orders" && (
          <div className="fab-support" onClick={handleCall}>
            <span className="fab-icon">🎧</span>
            <span className="fab-text">Gamer Support</span>
          </div>
        )}
      </div>

      {/* Mobile Bottom Navigation (Always Visible) */}
      <nav className="mobile-nav">
        <button
          className={activeTab === "home" ? "active" : ""}
          onClick={() => { setActiveTab("home"); setSelectedProduct(null); }}
        >
          <span>🏠</span> Home
        </button>
        <button
          className={activeTab === "products" ? "active" : ""}
          onClick={() => {
            setCategoryFilter("all");
            setActiveTab("products");
            setSelectedProduct(null);
          }}
        >
          <span>🎮</span> PC Games
        </button>
        <button
          className={activeTab === "cart" ? "active" : ""}
          onClick={() => { setActiveTab("cart"); setSelectedProduct(null); }}
        >
          <span>📥</span> Queue ({cart.length})
        </button>
        <button
          className={activeTab === "orders" ? "active" : ""}
          onClick={() => { setActiveTab("orders"); setSelectedProduct(null); }}
        >
          <span>⭐</span> Library
        </button>
      </nav>

      {/* 🌐 Online Game Player Modal */}
      {activeOnlineGame && (
        <div className="online-player-modal-overlay" onClick={() => setActiveOnlineGame(null)}>
          <div className="online-player-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="online-player-header">
              <div className="online-player-title">
                <span className="live-dot">● LIVE NOW</span>
                <h3>🎮 {activeOnlineGame.name}</h3>
                <span className="online-player-pill">{activeOnlineGame.genre || "Free Game"}</span>
              </div>
              <div className="online-player-actions">
                <button
                  type="button"
                  className="fullscreen-native-btn"
                  onClick={toggleIframeFullscreen}
                  title="Play in Fullscreen"
                >
                  ⛶ Fullscreen
                </button>
                {activeOnlineGame.playOnlineUrl && (
                  <a
                    href={activeOnlineGame.playOnlineUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="fullscreen-external-btn"
                  >
                    ↗ Open Full Tab
                  </a>
                )}
                <button className="close-player-btn" onClick={() => setActiveOnlineGame(null)}>
                  ✕
                </button>
              </div>
            </div>

            <div className="online-iframe-wrapper" ref={iframeWrapperRef}>
              {activeOnlineGame.playOnlineUrl ? (
                <>
                  <iframe
                    src={activeOnlineGame.playOnlineUrl}
                    title={activeOnlineGame.name}
                    className="game-iframe"
                    allow="autoplay; fullscreen; gamepad; accelerometer; gyroscope; keyboard; xr-spatial-tracking"
                    allowFullScreen
                  />
                  <div className="iframe-hint-bar">
                    <span>⚡ Playing {activeOnlineGame.name} Online</span>
                    <a
                      href={activeOnlineGame.playOnlineUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="external-tab-link"
                    >
                      Click here to Play Fullscreen in New Tab ↗
                    </a>
                  </div>
                </>
              ) : (
                <div className="online-fallback-box">
                  <h4>Ready to Play {activeOnlineGame.name}</h4>
                  <p>Download and start playing directly on your device:</p>
                  <button
                    className="play-btn-large"
                    onClick={() => handleDownloadGame(activeOnlineGame)}
                  >
                    📥 Free Download ({activeOnlineGame.downloadSize || "Free"})
                  </button>
                </div>
              )}
            </div>

            <div className="online-player-footer">
              <div className="footer-left">
                <span>👥 {activeOnlineGame.playersOnline || "Active Players Online"}</span>
                <span>💾 Size: {activeOnlineGame.downloadSize || "Free"}</span>
                <span>🕹️ Platform: {activeOnlineGame.platform || "Multi-Platform"}</span>
              </div>
              <div className="footer-right">
                <button
                  className="download-footer-btn"
                  onClick={() => handleDownloadGame(activeOnlineGame)}
                >
                  📥 Download Installer
                </button>
                {activeOnlineGame.apkDownloadUrl && (
                  <a
                    href={activeOnlineGame.apkDownloadUrl}
                    className="download-apk-btn"
                    target="_blank"
                    rel="noopener noreferrer"
                    download
                  >
                    📱 Download APK
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default Dashboard;
