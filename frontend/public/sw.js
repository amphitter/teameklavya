// EventHub Service Worker — offline QR + ticket caching (Claude #3)
// Minimal, safe, no push yet. Caches ticket-cache and static assets.

const CACHE_NAME = "eventhub-v1";
const OFFLINE_URLS = ["/", "/user/registrations", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(OFFLINE_URLS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // Only handle GET
  if (request.method !== "GET") return;

  // For ticket QR images (Cloudinary) — cache first, fallback network
  if (request.url.includes("cloudinary") || request.url.includes("/api/tickets") || request.url.includes("/api/events")) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((res) => {
            // Cache successful responses
            if (res.ok) {
              const clone = res.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            }
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // For navigation requests — network first, fallback cache
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match(request).then((c) => c || caches.match("/")))
    );
  }
});
