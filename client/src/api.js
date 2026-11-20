import axios from "axios";

// Smart API configuration:
// Defaults to http://localhost:5000 during local dev, or REACT_APP_API_URL if configured.
const getBaseUrl = () => {
  if (process.env.REACT_APP_API_URL) return process.env.REACT_APP_API_URL;
  if (typeof window !== "undefined") {
    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
      if (window.location.port === "3000") {
        return "http://localhost:5000";
      }
      return window.location.origin;
    }
    return window.location.origin;
  }
  return "http://localhost:5000";
};

export const API_BASE = getBaseUrl();
export const API = `${API_BASE}/api`;

export const authApi = axios.create({
  baseURL: API
});

export const fetchOrders = (email) =>
  authApi.get(`/checkout/orders/${encodeURIComponent(email)}`);

authApi.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default authApi;
