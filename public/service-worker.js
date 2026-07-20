const STATIC_CACHE = "pas-a-pas-static-v2";
const AUDIO_CACHE = "pas-a-pas-audio-v1";
const OFFLINE_SHELL_PATH = "/offline.html";
const STATIC_ASSETS = [
  OFFLINE_SHELL_PATH,
  "/favicon.svg",
  "/apple-touch-icon.png",
  "/icon-192.png",
  "/icon-512.png",
  "/manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== STATIC_CACHE && key !== AUDIO_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Media elements commonly request byte ranges. Cache Storage rejects 206
  // responses, so let the network handle Range requests without interception.
  if (request.headers.has("range")) return;

  // Platform authentication routes and APIs always remain network-only.
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/signin-with-chatgpt") ||
    url.pathname.startsWith("/signout-with-chatgpt") ||
    url.pathname.startsWith("/callback")
  ) {
    return;
  }

  // Authenticated HTML is never cached. A failed cold navigation receives only
  // the static, identity-free reconnect page that was cached at install time.
  if (request.mode === "navigate") {
    event.respondWith(networkNavigationWithOfflineShell(request));
    return;
  }

  if (url.pathname.startsWith("/audio/")) {
    event.respondWith(cacheFirst(request, AUDIO_CACHE));
    return;
  }

  if (STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
  }
});

async function networkNavigationWithOfflineShell(request) {
  try {
    return await fetch(request);
  } catch {
    const cache = await caches.open(STATIC_CACHE);
    const offlineShell = await cache.match(OFFLINE_SHELL_PATH);
    if (offlineShell) return offlineShell;
    return new Response("Pas à Pas is offline. Reconnect and try again.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.status === 200) {
    try {
      await cache.put(request, response.clone());
    } catch (error) {
      // Quota/eviction failures must never turn a successful asset request into
      // a playback or rendering failure.
      console.warn("Pas a Pas cache write skipped", error);
    }
  }
  return response;
}
