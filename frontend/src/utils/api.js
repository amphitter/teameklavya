import axios from "axios";

// Backend URL from env (no /api suffix). Falls back to local dev backend.
const API_BASE = process.env.NEXT_PUBLIC_API_URL
  ? `${process.env.NEXT_PUBLIC_API_URL}/api`
  : "https://teameklavya.onrender.com/api";

export const API_ROOT = process.env.NEXT_PUBLIC_API_URL || "https://teameklavya.onrender.com";

export const api = axios.create({
  baseURL: API_BASE,
  headers: {
    "Content-Type": "application/json",
  },
});

// Attach JWT token automatically
api.interceptors.request.use((config) => {
  if (!config.headers) config.headers = {};
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("token");
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor — surface readable errors
api.interceptors.response.use(
  (r) => r,
  (err) => {
    console.error("API Error:", err.response?.data || err.message);
    return Promise.reject(err);
  }
);

export default api;
