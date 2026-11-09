/* Consi offline helper (service worker). Opens the app instantly from the copy saved on the phone, even with a weak
   or no signal, and refreshes that copy in the background. Never touches /api/ (counter, AI) or version.json. */
const C = "consi-shell-v1", KEY = "/__consi_shell";
self.addEventListener("install", e => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
const isShell = u => { const p = new URL(u).pathname; return p === "/" || p === "/index.html"; };
async function refresh() {
  const res = await fetch("/?sw=" + Date.now(), { cache: "no-store" });
  if (!res.ok || !(res.headers.get("content-type") || "").includes("text/html")) throw new Error("bad");
  const body = await res.clone().text();                 // wait for the WHOLE page before saving it
  const m = body.match(/consi-autoupdate\*\/\(function\(\)\{var V="([0-9a-z]+)"/);
  const cache = await caches.open(C);
  await cache.put(KEY, new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } }));
  return m ? m[1] : "";
}
self.addEventListener("fetch", e => {
  const r = e.request;
  if (r.method !== "GET" || r.mode !== "navigate" || !isShell(r.url)) return;
  e.respondWith((async () => {
    const cache = await caches.open(C), saved = await cache.match(KEY);
    if (new URL(r.url).searchParams.has("v")) {          // update requested: go to the network first, then save that copy
      try { const res = await fetch("/?sw=" + Date.now(), { cache: "no-store" }); if (res.ok) { const b = await res.clone().text(); await cache.put(KEY, new Response(b, { headers: { "content-type": "text/html; charset=utf-8" } })); return new Response(b, { headers: { "content-type": "text/html; charset=utf-8" } }); } } catch (err) {}
    }
    if (saved) { e.waitUntil(refresh().catch(() => {})); return saved; }
    try { const res = await fetch(r); if (res.ok) { const b = await res.clone().text(); await cache.put(KEY, new Response(b, { headers: { "content-type": "text/html; charset=utf-8" } })); } return res; }
    catch (err) { return new Response("Consi needs a connection the first time it opens.", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } }); }
  })());
});
self.addEventListener("message", e => {
  if (!e.data || e.data.t !== "refresh") return;
  const port = e.ports && e.ports[0];
  e.waitUntil(refresh().then(v => port && port.postMessage({ v })).catch(() => port && port.postMessage({ v: "" })));
});
