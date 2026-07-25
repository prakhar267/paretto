const STATIC_CACHE = "paretto-static-v6";
// Keep the legacy audio cache identity so existing installs do not redownload
// the complete French pronunciation library during the brand transition.
const AUDIO_CACHE = "pas-a-pas-audio-v1";
const OFFLINE_SHELL_PATH = "/offline.html";
const PUBLIC_AUDIO_PATH =
  /^\/audio\/fr\/[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*\.wav$/;
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
    caches.open(STATIC_CACHE).then((cache) =>
      cache.addAll(
        STATIC_ASSETS.map(
          (path) =>
            new Request(new URL(path, self.location.origin), {
              cache: "reload",
              credentials: "omit",
            }),
        ),
      ),
    ),
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

  // APIs always remain network-only.
  if (url.pathname.startsWith("/api/")) return;

  // Learner HTML is never cached. A failed cold navigation receives only the
  // static reconnect page that was cached at install time.
  if (request.mode === "navigate") {
    event.respondWith(networkNavigationWithOfflineShell(request));
    return;
  }

  // Keep Cache Storage identity-free: only immutable, versioned production
  // pronunciation assets without query data are eligible.
  if (PUBLIC_AUDIO_PATH.test(url.pathname) && url.search === "") {
    event.respondWith(
      cacheFirst(
        new Request(url.toString(), {
          cache: "no-cache",
          credentials: "omit",
        }),
        AUDIO_CACHE,
      ),
    );
    return;
  }

  if (STATIC_ASSETS.includes(url.pathname) && url.search === "") {
    event.respondWith(
      cacheFirst(
        new Request(url.toString(), {
          cache: "no-cache",
          credentials: "omit",
        }),
        STATIC_CACHE,
      ),
    );
  }
});

async function networkNavigationWithOfflineShell(request) {
  try {
    return await fetch(request);
  } catch {
    const cache = await caches.open(STATIC_CACHE);
    const offlineShell = await cache.match(OFFLINE_SHELL_PATH);
    if (offlineShell) return offlineShell;
    return new Response("Paretto is offline. Reconnect and try again.", {
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
      console.warn("Paretto cache write skipped", error);
    }
  }
  return response;
}
