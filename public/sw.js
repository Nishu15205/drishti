/* Drishti service worker — installable PWA shell.
 *
 * Strategy:
 *  - Navigations & API calls: network-first (AI answers must never be stale);
 *    navigation falls back to the cached shell when offline.
 *  - Framework chunks (/_next/static, /_next/image): network-first with a
 *    cache fallback. These URLs are REUSED with new content on every build
 *    and dev recompile — cache-first here hydrates the page with old JS and
 *    causes React hydration mismatches / ReferenceErrors. Fresh always wins
 *    while online; the cache only serves offline.
 *  - Truly immutable assets (icons, demo photos, fonts, manifest): cache-first.
 *  - Demo photos also cached so the backup demo mode works offline.
 */
const VERSION = "drishti-v6-enin";
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;

const SHELL_ASSETS = [
  "/",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/icons/favicon-32.png",
  "/demo/street.png",
  "/demo/roof.png",
  "/demo/danger.png",
  "/demo/busstop.png",
  "/demo/hallway.png",
  "/demo/stairs.png",
  "/demo/currency.png",
  "/demo/medicine.png",
  "/demo/exit-board.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Cache shell best-effort — a single failure must not break install.
      await Promise.allSettled(SHELL_ASSETS.map((url) => cache.add(url)));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => !k.startsWith(VERSION))
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Never intercept AI streaming APIs — they are POST-only anyway, but be safe.
  if (url.pathname.startsWith("/api/")) return;

  // Framework chunks → network-first, cache only as the offline fallback.
  const isFrameworkAsset =
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/_next/image");

  // Immutable media → cache-first
  const isImmutableAsset =
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/demo/") ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname.endsWith(".woff2") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".svg");

  if (isFrameworkAsset) {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          if (res.ok) {
            const cache = await caches.open(RUNTIME_CACHE);
            cache.put(req, res.clone());
          }
          return res;
        } catch (err) {
          const cached = await caches.match(req);
          if (cached) return cached;
          return new Response("", { status: 504, statusText: "Offline" });
        }
      })()
    );
    return;
  }

  if (isImmutableAsset) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        try {
          const res = await fetch(req);
          if (res.ok) {
            const cache = await caches.open(RUNTIME_CACHE);
            cache.put(req, res.clone());
          }
          return res;
        } catch (err) {
          return new Response("", { status: 504, statusText: "Offline" });
        }
      })()
    );
    return;
  }

  // Navigations → network-first, offline fallback to cached shell
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          const cache = await caches.open(SHELL_CACHE);
          cache.put("/", res.clone());
          return res;
        } catch (err) {
          const shell = await caches.match("/");
          if (shell) return shell;
          return new Response("Offline", {
            status: 503,
            headers: { "Content-Type": "text/plain" },
          });
        }
      })()
    );
  }
});
