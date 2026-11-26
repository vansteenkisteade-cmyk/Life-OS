/* Life OS service worker: offline + meldingen */
const VERSION = "lifeos-v3";
const SHELL = ["./", "./index.html", "./config.js", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png"];
const CDN = [
  "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js"
];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(async c => {
    await c.addAll(SHELL);
    await Promise.all(CDN.map(u => fetch(u, {mode: "cors"}).then(r => r.ok && c.put(u, r)).catch(() => {})));
  }).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Firebase-verkeer (login, database) nooit cachen: dat regelt Firebase zelf
  if (/googleapis\.com|firebaseio|identitytoolkit|securetoken/.test(url.host)) return;
  const sameOrigin = url.origin === self.location.origin;
  const isPage = req.mode === "navigate";
  if (isPage || (sameOrigin && /\/(index\.html|config\.js)?$/.test(url.pathname))) {
    // netwerk eerst (altijd de nieuwste versie), anders uit de cache (offline)
    e.respondWith(fetch(req).then(r => { const cp = r.clone(); caches.open(VERSION).then(c => c.put(isPage ? "./index.html" : req, cp)); return r; })
      .catch(() => caches.match(isPage ? "./index.html" : req).then(r => r || caches.match("./"))));
    return;
  }
  if (sameOrigin || CDN.includes(req.url) || /fonts\.(googleapis|gstatic)\.com/.test(url.host)) {
    // cache eerst, op de achtergrond verversen
    e.respondWith(caches.match(req).then(hit => {
      const net = fetch(req).then(r => { if (r && (r.ok || r.type === "opaque")) { const cp = r.clone(); caches.open(VERSION).then(c => c.put(req, cp)); } return r; }).catch(() => hit);
      return hit || net;
    }));
  }
});
/* meldingen */
self.addEventListener("push", e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch(x) { d = {body: e.data && e.data.text()}; }
  const title = d.title || "Life OS";
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || "", tag: d.tag || undefined, renotify: !!d.tag,
    icon: "icons/icon-192.png", badge: "icons/icon-192.png", data: {url: d.url || "./#snel"}
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const target = new URL(e.notification.data && e.notification.data.url || "./", self.location.href).href;
  e.waitUntil(self.clients.matchAll({type: "window", includeUncontrolled: true}).then(list => {
    for (const c of list) { if (c.url.startsWith(self.registration.scope)) { c.focus(); c.postMessage({go: new URL(target).hash}); return; } }
    return self.clients.openWindow(target);
  }));
});
