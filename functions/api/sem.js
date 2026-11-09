// Semantic search: embeds the query with Workers AI and returns the closest Consi entries from Vectorize.
// Stores nothing. Returns {off:true} if the bindings are missing, so the app quietly falls back to keyword search.
const MODEL = "@cf/baai/bge-small-en-v1.5";
export async function onRequestGet({ request, env }) {
  try {
    if (!env.AI || !env.VECTORIZE) return Response.json({ off: true });
    const q = String(new URL(request.url).searchParams.get("q") || "").replace(/\s+/g, " ").trim().slice(0, 200);
    if (q.length < 4) return Response.json({ m: [] });
    const emb = await env.AI.run(MODEL, { text: [q] });
    const res = await env.VECTORIZE.query(emb.data[0], { topK: 10, returnMetadata: "all" });
    const m = (res.matches || []).filter(x => x.metadata && x.score >= 0.55).map(x => ({ h: x.metadata.h, t: x.metadata.t, s: Math.round(x.score * 1000) / 1000 }));
    return Response.json({ m }, { headers: { "cache-control": "public, max-age=3600" } });
  } catch (e) { return Response.json({ off: true }); }
}
