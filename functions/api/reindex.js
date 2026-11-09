// Loads sem-docs.json into the Vectorize index (semantic search). Private: needs ?key=<STATS_KEY>.
// Open /api/reindex?key=... in a browser: the page indexes in batches and shows progress. Safe to re-run; ids are stable.
const MODEL = "@cf/baai/bge-small-en-v1.5", BATCH = 100, PER_CALL = 300;
export async function onRequestGet({ request, env }) {
  const u = new URL(request.url), key = u.searchParams.get("key") || "";
  if (!env.STATS_KEY || key !== env.STATS_KEY) return new Response("Not found", { status: 404 });
  if (!env.AI || !env.VECTORIZE) return new Response("Missing AI or VECTORIZE binding.", { status: 500 });
  if (!u.searchParams.has("from")) return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  const from = Math.max(0, parseInt(u.searchParams.get("from"), 10) || 0);
  const r = await fetch(new URL("/sem-docs.json?t=" + Date.now(), u.origin));
  if (!r.ok) return Response.json({ error: "sem-docs.json not found" }, { status: 500 });
  const all = await r.json(), docs = all.docs.slice(from, from + PER_CALL);
  for (let i = 0; i < docs.length; i += BATCH) {
    const part = docs.slice(i, i + BATCH);
    const emb = await env.AI.run(MODEL, { text: part.map(d => (d.t + ". " + d.x).slice(0, 1000)) });
    await env.VECTORIZE.upsert(part.map((d, k) => ({ id: d.id, values: emb.data[k], metadata: { h: d.h, t: d.t } })));
  }
  const next = from + docs.length;
  return Response.json({ ver: all.ver, total: all.n, next, done: next >= all.n });
}
const PAGE = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Consi search index</title>
<body style="font:16px system-ui;max-width:640px;margin:40px auto;padding:0 16px"><h1>Consi semantic index</h1><p id="s">Starting…</p>
<script>const k=new URLSearchParams(location.search).get("key");let from=0;
async function go(){try{const r=await fetch("/api/reindex?key="+encodeURIComponent(k)+"&from="+from);const j=await r.json();
if(j.error){s.textContent="Error: "+j.error;return}from=j.next;s.textContent="Indexed "+j.next+" of "+j.total+" (version "+j.ver+")"+(j.done?". Done.":"…");
if(!j.done)setTimeout(go,300)}catch(e){s.textContent="Paused at "+from+" ("+e.message+"). Reload this page to continue from the start; finished items are kept.";}}go()</script>`;
