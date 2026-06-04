// sw.js — MIS GASTOS v1.0.92
const CACHE_VERSION = "v1.0.92";
const CACHE_NAME    = `mis-gastos-${CACHE_VERSION}`;
const BASE          = "/APK_V0.0/";

// Sin versiones en las URLs — el SW maneja la frescura
const ASSETS = [
  BASE,
  BASE + "index.html",
  BASE + "manifest.json",
  BASE + "css/style.css",
  BASE + "js/utils.js",
  BASE + "js/main.js",
  BASE + "icons/icon-192.png",
  BASE + "icons/icon-256-maskable.png",
  BASE + "icons/icon-512.png"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k.startsWith("mis-gastos-") && k !== CACHE_NAME)
            .map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", e => {
  const { request } = e;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(BASE)) return;

  // Ignorar parámetros ?v=xx — cachear siempre por pathname
  const cleanUrl = new URL(request.url);
  cleanUrl.search = '';
  const cleanRequest = new Request(cleanUrl.toString(), { mode: 'cors' });

  const isHTML = url.pathname === BASE || url.pathname.endsWith("index.html");
  e.respondWith(isHTML ? networkFirst(cleanRequest) : staleWhileRevalidate(cleanRequest));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const res = await fetch(req);
    if (res && res.status === 200) cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match(req)) ||
      new Response("<h2>Sin conexión</h2>", { headers: { "Content-Type": "text/html" } });
  }
}

async function staleWhileRevalidate(req) {
  const cache  = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);
  fetch(req)
    .then(res => { if (res?.status === 200) cache.put(req, res.clone()); })
    .catch(() => {});
  return cached || fetch(req);
}
