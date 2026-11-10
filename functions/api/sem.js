// Semantic search: embeds the query with Workers AI and returns the closest Consi entries from Vectorize.
// Stores nothing. Returns {off:true} if the bindings are missing, so the app quietly falls back to keyword search.
const MODEL = "@cf/baai/bge-small-en-v1.5", PER_DEVICE_DAY = 100, ANON_DAY = 2000, SITE_DAY = 20000;
export async function onRequestGet({ request, env }) {
  try {
    if (!env.AI || !env.VECTORIZE) return Response.json({ off: true });
    const u = new URL(request.url), q = String(u.searchParams.get("q") || "").replace(/\s+/g, " ").trim().slice(0, 200);
    if (q.length < 4) return Response.json({ m: [] });
    if (env.DB) {                                                      // cost caps (Nov 9, 2026)
      const day = new Date().toISOString().slice(0, 10), id = String(u.searchParams.get("d") || "").replace(/[^a-z0-9]/gi, "").slice(0, 32) || "anon";
      await env.DB.prepare("CREATE TABLE IF NOT EXISTS sems (id TEXT, day TEXT, n INTEGER, PRIMARY KEY (id, day))").run();
      const all = await env.DB.prepare("SELECT COALESCE(SUM(n),0) t FROM sems WHERE day = ?").bind(day).first();
      if ((all && all.t) >= SITE_DAY) return Response.json({ off: true });
      const me = await env.DB.prepare("SELECT n FROM sems WHERE id = ? AND day = ?").bind(id, day).first();
      if (me && me.n >= (id === "anon" ? ANON_DAY : PER_DEVICE_DAY)) return Response.json({ off: true });
      await env.DB.prepare("INSERT INTO sems (id, day, n) VALUES (?, ?, 1) ON CONFLICT(id, day) DO UPDATE SET n = n + 1").bind(id, day).run();
      if (Math.random() < 0.02) await env.DB.prepare("DELETE FROM sems WHERE day < ?").bind(new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)).run();
    }
    const emb = await env.AI.run(MODEL, { text: [q] });
    const res = await env.VECTORIZE.query(emb.data[0], { topK: 10, returnMetadata: "all" });
    const m = (res.matches || []).filter(x => x.metadata && x.score >= 0.55).map(x => ({ h: x.metadata.h, t: x.metadata.t, s: Math.round(x.score * 1000) / 1000 }));
    return Response.json({ m }, { headers: { "cache-control": "public, max-age=3600" } });
  } catch (e) { return Response.json({ off: true }); }
}
