// Incremental semantic reindex. Private: needs ?key=<STATS_KEY>. Same paging as before: ?from=N -> {ver,total,next,done}.
// Each doc in sem-docs-N.json carries a content fingerprint (c). D1 table semhash(id, c, v) remembers the fingerprint
// embedded for each id and the corpus version (v) that last confirmed it. Only new or changed docs are embedded
// (Workers AI) and upserted (Vectorize); unchanged docs are just re-confirmed. On the last page, if every current doc was
// confirmed for this version, vectors for ids no longer in the corpus are deleted. Errors return JSON, never a crash.
const MODEL = "@cf/baai/bge-small-en-v1.5", BATCH = 100, PER_CALL = 500, IN = 90;
export async function onRequestGet({ request, env }) {
  const u = new URL(request.url), key = u.searchParams.get("key") || "";
  if (!env.STATS_KEY || key !== env.STATS_KEY) return new Response("Not found", { status: 404 });
  if (!u.searchParams.has("from")) return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  try {
    if (!env.AI || !env.VECTORIZE || !env.DB) return Response.json({ error: "Missing AI, VECTORIZE or DB binding" });
    const DB = env.DB, from = Math.max(0, parseInt(u.searchParams.get("from"), 10) || 0);
    const man = await (await fetch(new URL("/sem-docs.json?t=" + Date.now(), u.origin))).json();
    if (!man.shard) return Response.json({ error: "sem-docs.json is in the old single-file format; republish" });
    await DB.prepare("CREATE TABLE IF NOT EXISTS semhash (id TEXT PRIMARY KEY, c TEXT, v TEXT)").run();
    let embedded = 0, skipped = 0, deleted = 0, next = from;
    if (from < man.n) {
      const si = Math.floor(from / man.shard);
      const sh = await (await fetch(new URL(`/sem-docs-${si}.json?t=` + Date.now(), u.origin))).json();
      const off = from - sh.from, docs = sh.docs.slice(off, off + PER_CALL);
      const known = new Map();
      for (let i = 0; i < docs.length; i += IN) {
        const ids = docs.slice(i, i + IN).map(d => d.id);
        const r = await DB.prepare(`SELECT id, c FROM semhash WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all();
        for (const row of r.results || []) known.set(row.id, row.c);
      }
      const todo = docs.filter(d => known.get(d.id) !== d.c), same = docs.filter(d => known.get(d.id) === d.c);
      for (let i = 0; i < todo.length; i += BATCH) {
        const part = todo.slice(i, i + BATCH);
        const emb = await env.AI.run(MODEL, { text: part.map(d => (d.t + ". " + d.x).slice(0, 1000)) });
        await env.VECTORIZE.upsert(part.map((d, k) => ({ id: d.id, values: emb.data[k], metadata: { h: d.h, t: d.t } })));
        await DB.batch(part.map(d => DB.prepare("INSERT INTO semhash (id, c, v) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET c = excluded.c, v = excluded.v").bind(d.id, d.c, man.ver)));
        embedded += part.length;
      }
      for (let i = 0; i < same.length; i += IN) {
        const ids = same.slice(i, i + IN).map(d => d.id);
        await DB.prepare(`UPDATE semhash SET v = ? WHERE id IN (${ids.map(() => "?").join(",")})`).bind(man.ver, ...ids).run();
      }
      skipped = same.length; next = from + docs.length;
    }
    const done = next >= man.n;
    if (done) {
      const cur = await DB.prepare("SELECT COUNT(*) n FROM semhash WHERE v = ?").bind(man.ver).first();
      if (cur && cur.n >= man.n) {                       // the whole corpus was confirmed for this version: safe to prune
        const old = await DB.prepare("SELECT id FROM semhash WHERE v != ? LIMIT 1000").bind(man.ver).all();
        const ids = (old.results || []).map(r => r.id);
        for (let i = 0; i < ids.length; i += 100) {
          const part = ids.slice(i, i + 100);
          await env.VECTORIZE.deleteByIds(part);
          await DB.prepare(`DELETE FROM semhash WHERE id IN (${part.map(() => "?").join(",")})`).bind(...part).run();
        }
        deleted = ids.length;
      }
    }
    return Response.json({ ver: man.ver, total: man.n, next, done, embedded, skipped, deleted });
  } catch (e) { return Response.json({ error: String(e && e.message || e).slice(0, 300) }); }
}
const PAGE = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Consi search index</title>
<body style="font:16px system-ui;max-width:640px;margin:40px auto;padding:0 16px"><h1>Consi semantic index</h1><p id="s">Starting…</p>
<script>const P=new URLSearchParams(location.search),k=P.get("key");let from=parseInt(P.get("start")||"0",10)||0,tries=0,E=0,S=0,D=0;
async function go(){let t="";try{const r=await fetch("/api/reindex?key="+encodeURIComponent(k)+"&from="+from);t=await r.text();const j=JSON.parse(t);
if(j.error){s.textContent="Stopped at "+from+": "+j.error+". To resume from here later, open this page with &start="+from+" added to the address.";return}
tries=0;from=j.next;E+=j.embedded||0;S+=j.skipped||0;D+=j.deleted||0;
s.textContent="Checked "+j.next+" of "+j.total+" (version "+j.ver+"): "+E+" new or changed, "+S+" unchanged"+(j.done?", "+D+" removed. Done.":"…");if(!j.done)setTimeout(go,300)}
catch(e){if(++tries<4){s.textContent="Retrying at "+from+"…";setTimeout(go,5000);return}
s.textContent="Stopped at "+from+" ("+(t?t.replace(/<[^>]+>/g," ").replace(/\\s+/g," ").slice(0,200):e.message)+"). To resume, open this page with &start="+from+" added to the address."}}go()</script>`;
