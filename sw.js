/* Consi service worker v3 (Nov 10, 2026). Three jobs, in this order:
   1) The app is ALWAYS the newest published build. On every open it asks /version.json (about 20 bytes, never cached) which build is
      current. If the copy saved on the device is older, it downloads the new page FIRST, checks that the page really is that build
      (retrying with fresh URLs if a CDN edge still serves the old one), saves it, and opens it.
   2) The app opens fast and works with a weak or no signal: if the check can't be made in a couple of seconds, it opens the saved copy.
   3) Rulebook files (lr/<n>.<hash>.js) and state pages (st/<code>.<hash>.js) are saved on the device the first time they load, so they open
      again with no signal. They are named by content hash, so a saved copy is never stale. At most 150 are kept (oldest dropped first).
   Never touches /api/. When this worker replaces an older one, it clears the old saved copies and reloads open Consi windows. */
const C = "consi-shell-v2", D = "consi-data-v1", KEEP = 150, KEY = "/__consi_shell", BID = /consi-autoupdate\*\/\(function\(\)\{var V="([0-9a-z]+)"/, HTML = "text/html; charset=utf-8";
const isData = u => { const p = new URL(u); return p.origin === self.location.origin && /^\/(lr|st)\/[^/]+\.js$/.test(p.pathname); };
const isShell = u => { const p = new URL(u).pathname; return p === "/" || p === "/index.html"; };
const mk = (body, v) => new Response(body, { headers: { "content-type": HTML, "x-consi-v": v || "" } });
const wait = ms => new Promise(r => setTimeout(r, ms));
async function latest(ms) {                              // the current build id, or "" if it can't be read quickly
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch("/version.json?t=" + Date.now(), { cache: "no-store", signal: ctl.signal }); if (!r.ok) return ""; const j = await r.json(); return (j && j.v) || ""; }
  catch (e) { return ""; } finally { clearTimeout(t); }
}
async function download(want) {                          // the whole page, checked against the build we want
  let last = null;
  for (let i = 0; i < 4; i++) {
    const r = await fetch("/?sw=" + Date.now() + "_" + i, { cache: "no-store" });
    if (!r.ok || !(r.headers.get("content-type") || "").includes("text/html")) throw new Error("bad");
    const body = await r.text(), m = body.match(BID); last = { body, v: m ? m[1] : "" };
    if (!want || !m || m[1] === want) return last;
    await wait(500 * (i + 1));                           // an edge is still serving the old build: try again with a new URL
  }
  return last;
}
async function save(o) { const cache = await caches.open(C); await cache.put(KEY, mk(o.body, o.v)); return o; }
self.addEventListener("install", e => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil((async () => {
  let upgraded = false;
  for (const k of await caches.keys()) if (k !== C && k !== D) { upgraded = true; await caches.delete(k); }
  await self.clients.claim();
  if (upgraded) for (const c of await self.clients.matchAll({ type: "window" })) { try { await c.navigate(c.url); } catch (e) {} }
})()));
self.addEventListener("fetch", e => {
  const r = e.request;
  if (r.method === "GET" && isData(r.url)) {             // saved rulebook and state-page files: cache first, then the network
    e.respondWith((async () => {
      const cache = await caches.open(D), hit = await cache.match(r.url);
      if (hit) return hit;
      const res = await fetch(r);
      if (res.ok) e.waitUntil((async () => { await cache.put(r.url, res.clone()); const ks = await cache.keys(); for (let i = 0; i < ks.length - KEEP; i++) await cache.delete(ks[i]); })().catch(() => {}));
      return res;
    })());
    return;
  }
  if (r.method !== "GET" || r.mode !== "navigate" || !isShell(r.url)) return;
  e.respondWith((async () => {
    const cache = await caches.open(C), saved = await cache.match(KEY);
    if (!saved) {                                        // first visit: stream from the network, and keep a copy for next time
      try {
        const res = await fetch("/?sw=" + Date.now(), { cache: "no-store" });
        if (res.ok && (res.headers.get("content-type") || "").includes("text/html")) e.waitUntil(res.clone().text().then(b => { const m = b.match(BID); return save({ body: b, v: m ? m[1] : "" }); }).catch(() => {}));
        return res;
      } catch (err) { return new Response("Consi needs a connection the first time it opens.", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } }); }
    }
    const have = saved.headers.get("x-consi-v") || "", want = await latest(2500);
    if (want === "" || want === have) return saved;      // already the newest, or the check couldn't be made: open the saved copy now
    const job = download(want).then(save); e.waitUntil(job.catch(() => {}));    // a slow connection: after 20 s open the saved copy while the download finishes
    const o = await Promise.race([job, wait(20000).then(() => null)]).catch(() => null);
    return o ? mk(o.body, o.v) : saved;
  })());
});
self.addEventListener("message", e => {                  // the page asks for a refresh when it sees a newer build while open
  if (!e.data || e.data.t !== "refresh") return;
  const port = e.ports && e.ports[0];
  e.waitUntil((async () => { try { const want = await latest(4000), o = await download(want); await save(o); port && port.postMessage({ v: o.v }); } catch (err) { port && port.postMessage({ v: "" }); } })());
});
