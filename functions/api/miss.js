// Consi "search found little or nothing" log. Stores only: the search text (already stripped of emails, phone numbers,
// and long number strings by the app, and again here), how many results it found, the kind (none = no results,
// few = one result, noclick = 2+ results but nothing tapped), the day, the time, and the app build.
// No device ID, IP address, or location is stored. Records are deleted after 90 days (privacy policy). Needs D1 bound as DB.
export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) return new Response(null, { status: 204 });
    const b = await request.json().catch(() => ({}));
    let q = String(b.q || "").replace(/\S+@\S+/g, "[email]").replace(/\+?\d[\d\s().-]{8,}\d/g, "[number]").replace(/\d{5,}/g, "#")
      .replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 160);
    if (q.length < 3) return new Response(null, { status: 204 });
    const n = Math.max(0, Math.min(999, parseInt(b.n, 10) || 0));
    const kind = ["none", "few", "noclick"].includes(b.kind) ? b.kind : (n ? "few" : "none");
    const build = String(b.v || "").replace(/[^a-z0-9]/gi, "").slice(0, 16);
    const now = Date.now(), day = new Date(now).toISOString().slice(0, 10);
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS misses (q TEXT, n INTEGER, day TEXT, ts INTEGER, build TEXT, kind TEXT)").run();
    try { await env.DB.prepare("ALTER TABLE misses ADD COLUMN kind TEXT").run(); } catch (e) {}   // older table without kind
    const c = await env.DB.prepare("SELECT COUNT(*) c FROM misses WHERE day = ?").bind(day).first();
    if (c && c.c >= 3000) return new Response(null, { status: 204 });      // daily cap
    await env.DB.prepare("INSERT INTO misses (q, n, day, ts, build, kind) VALUES (?, ?, ?, ?, ?, ?)").bind(q, n, day, now, build, kind).run();
    if (Math.random() < 0.02) await env.DB.prepare("DELETE FROM misses WHERE ts < ?").bind(now - 90 * 864e5).run();
    return new Response(null, { status: 204 });
  } catch (e) { return new Response(null, { status: 204 }); }
}
export async function onRequestGet() { return new Response(null, { status: 405 }); }
