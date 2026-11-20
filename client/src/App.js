import React, { useState, useEffect } from "react";
import "./App.css";
import Dashboard from "./Dashboard";
import AdminDashboard from "./AdminDashboard";
import { authApi } from "./api";

function App() {
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
  });
  const [message, setMessage] = useState("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState("login");
  const [loading, setLoading] = useState(false);
  const [, setToken] = useState("");
  const [showAuthModal, setShowAuthModal] = useState(false);

  useEffect(() => {
    const storedUser = localStorage.getItem("user");
    const storedToken = localStorage.getItem("token");

    if (storedUser && storedToken) {
      try {
        const parsedUser = JSON.parse(storedUser);
        setUser(parsedUser);
        setToken(storedToken);
        setIsLoggedIn(true);
      } catch (e) {
        console.error("Failed to parse stored user", e);
      }
    }
  }, []);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const saveSession = (loggedUser, jwtToken) => {
    setUser(loggedUser);
    setToken(jwtToken);
    setIsLoggedIn(true);
    localStorage.setItem("user", JSON.stringify(loggedUser));
    localStorage.setItem("token", jwtToken);
    setShowAuthModal(false);
  };

  const register = async () => {
    if (loading) return;
    
    if (!form.name || !form.email || !form.password) {
      setMessage("Error: Name, email, and password are required");
      return;
    }
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(form.email)) {
      setMessage("Error: Please enter a valid email address");
      return;
    }
    
    setLoading(true);
    setMessage("");
    
    try {
      const res = await authApi.post(`/register`, {
        name: form.name,
        email: form.email,
        password: form.password,
      });

      setMessage(res.data.message || "Gamer account created!");
      saveSession(res.data.user, res.data.token);
    } catch (err) {
      setMessage("Error: " + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  const login = async () => {
    if (loading) return;
    
    if (!form.email || !form.password) {
      setMessage("Error: Email and password are required");
      return;
    }
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(form.email)) {
      setMessage("Error: Please enter a valid email address");
      return;
    }
    
    setLoading(true);
    setMessage("");
    
    try {
      const res = await authApi.post(`/login`, {
        email: form.email,
        password: form.password,
      });

      setMessage(res.data.message || "Login successful");
      saveSession(res.data.user, res.data.token);
    } catch (err) {
      setMessage("Error: " + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    setIsLoggedIn(false);
    setUser(null);
    setToken("");
    setForm({ name: "", email: "", password: "" });
    setMessage("");
    setAuthMode("login");
    localStorage.removeItem("user");
    localStorage.removeItem("token");
  };

  if (isLoggedIn && user?.role === "admin") {
    return <AdminDashboard user={user} onLogout={logout} />;
  }

  return (
    <>
      <Dashboard user={user || {}} onLogout={logout} onLogin={() => setShowAuthModal(true)} />
      
      {showAuthModal && (
        <div className="auth-modal-overlay" onClick={() => setShowAuthModal(false)}>
          <div className="auth-modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="close-modal" onClick={() => setShowAuthModal(false)}>✕</button>
            
            <div className="auth-toggle">
              <button
                className={authMode === "login" ? "active" : ""}
                onClick={() => { setAuthMode("login"); setMessage(""); }}
              >
                Gamer Login
              </button>
              <button
                className={authMode === "register" ? "active" : ""}
                onClick={() => { setAuthMode("register"); setMessage(""); }}
              >
                Create Account
              </button>
            </div>

            <h2>{authMode === "login" ? "Welcome back, Player 1 ⚡" : "Join GameVault"}</h2>
            <p className="auth-subtitle">
              {authMode === "login"
                ? "Sign in to buy video games, track orders, and grab exclusive member deals."
                : "Create your gamer profile to unlock discounts, digital keys, and order pro gear."}
            </p>

            {authMode === "register" && (
              <input
                id="register-name"
                name="name"
                autoComplete="name"
                placeholder="Gamer Tag / Full Name"
                value={form.name}
                onChange={handleChange}
                className="input-field"
              />
            )}

            <input
              id="auth-email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="Email Address"
              value={form.email}
              onChange={handleChange}
              className="input-field"
            />

            <input
              id="auth-password"
              type="password"
              name="password"
              autoComplete="current-password"
              placeholder="Password"
              value={form.password}
              onChange={handleChange}
              className="input-field"
            />

            <button
              className="auth-btn primary"
              onClick={authMode === "login" ? login : register}
              disabled={loading}
            >
              {loading 
                ? (authMode === "login" ? "Signing In..." : "Creating Account...") 
                : (authMode === "login" ? "Enter GameVault ⚡" : "Create Gamer Account 🎮")
              }
            </button>

            <div className="auth-footer">
              {authMode === "login" ? (
                <p>
                  Don't have a GameVault account?{" "}
                  <button className="link-btn" onClick={() => { setAuthMode("register"); setMessage(""); }}>
                    Join here
                  </button>
                </p>
              ) : (
                <p>
                  Already have an account?{" "}
                  <button className="link-btn" onClick={() => { setAuthMode("login"); setMessage(""); }}>
                    Sign in here
                  </button>
                </p>
              )}
            </div>

            {message && <p className="message">{message}</p>}
          </div>
        </div>
      )}
    </>
  );
}

export default App;
