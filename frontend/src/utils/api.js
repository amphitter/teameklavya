import axios from "axios";

/**
 * Where the API lives.
 *
 * - a real URL  → that host, as before (production: Vercel → Render)
 * - "same-origin" → this app forwards /api and /socket.io to the backend
 *   itself (see BACKEND_PROXY_URL in next.config.ts). Used when the app is
 *   served from a single origin that is not the API's — a preview proxy, a
 *   reverse proxy, or a phone on the same host. Absolute URLs would break
 *   there: the second origin is either unreachable or gated.
 * - unset       → the deployed backend, as before
 */
export const SAME_ORIGIN = process.env.NEXT_PUBLIC_API_URL === "same-origin";

const RAW = process.env.NEXT_PUBLIC_API_URL;
const FALLBACK = "https://teameklavya.onrender.com";

const API_BASE = SAME_ORIGIN ? "/api" : RAW ? `${RAW}/api` : `${FALLBACK}/api`;

/** Absolute origin when one is required (OAuth redirects, /uploads paths). */
export const API_ORIGIN = SAME_ORIGIN
  ? typeof window !== "undefined"
    ? window.location.origin
    : ""
  : RAW || FALLBACK;

export const API_ROOT = SAME_ORIGIN ? "" : RAW || FALLBACK;

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
