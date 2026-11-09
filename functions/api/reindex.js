// Loads the semantic-search corpus into Vectorize. Private: needs ?key=<STATS_KEY>.
// Open /api/reindex?key=... in a browser: the page indexes in batches and shows progress. Safe to re-run; ids are stable.
// The corpus is sharded (sem-docs.json = manifest; sem-docs-N.json = 1,000 docs each) so each call stays within the
// Workers free-tier CPU limit. Errors come back as JSON so the page can show the real reason.
const MODEL = "@cf/baai/bge-small-en-v1.5", BATCH = 100, PER_CALL = 200;
export async function onRequestGet({ request, env }) {
  const u = new URL(request.url), key = u.searchParams.get("key") || "";
  if (!env.STATS_KEY || key !== env.STATS_KEY) return new Response("Not found", { status: 404 });
  if (!u.searchParams.has("from")) return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  try {
    if (!env.AI || !env.VECTORIZE) return Response.json({ error: "Missing AI or VECTORIZE binding" });
    const from = Math.max(0, parseInt(u.searchParams.get("from"), 10) || 0);
    const man = await (await fetch(new URL("/sem-docs.json?t=" + Date.now(), u.origin))).json();
    if (!man.shard) return Response.json({ error: "sem-docs.json is the old single-file format; republish" });
    if (from >= man.n) return Response.json({ ver: man.ver, total: man.n, next: man.n, done: true });
    const si = Math.floor(from / man.shard);
    const sh = await (await fetch(new URL(`/sem-docs-${si}.json?t=` + Date.now(), u.origin))).json();
    const off = from - sh.from, docs = sh.docs.slice(off, off + PER_CALL);
    for (let i = 0; i < docs.length; i += BATCH) {
      const part = docs.slice(i, i + BATCH);
      const emb = await env.AI.run(MODEL, { text: part.map(d => (d.t + ". " + d.x).slice(0, 1000)) });
      await env.VECTORIZE.upsert(part.map((d, k) => ({ id: d.id, values: emb.data[k], metadata: { h: d.h, t: d.t } })));
    }
    const next = from + docs.length;
    return Response.json({ ver: man.ver, total: man.n, next, done: next >= man.n });
  } catch (e) { return Response.json({ error: String(e && e.message || e).slice(0, 300) }); }
}
const PAGE = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Consi search index</title>
<body style="font:16px system-ui;max-width:640px;margin:40px auto;padding:0 16px"><h1>Consi semantic index</h1><p id="s">Starting…</p>
<script>const P=new URLSearchParams(location.search),k=P.get("key");let from=parseInt(P.get("start")||"0",10)||0,tries=0;
async function go(){let t="";try{const r=await fetch("/api/reindex?key="+encodeURIComponent(k)+"&from="+from);t=await r.text();const j=JSON.parse(t);
if(j.error){s.textContent="Stopped at "+from+": "+j.error+". To resume from here later, open this page with &start="+from+" added to the address.";return}
tries=0;from=j.next;s.textContent="Indexed "+j.next+" of "+j.total+" (version "+j.ver+")"+(j.done?". Done.":"…");if(!j.done)setTimeout(go,300)}
catch(e){if(++tries<4){s.textContent="Retrying at "+from+"…";setTimeout(go,5000);return}
s.textContent="Stopped at "+from+" ("+(t?t.replace(/<[^>]+>/g," ").replace(/\\s+/g," ").slice(0,200):e.message)+"). To resume, open this page with &start="+from+" added to the address."}}go()</script>`;
