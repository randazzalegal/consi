// Consi visitor counter. Stores only: a random anonymous device ID the app generated, the day, the time, and the app build.
// No names, emails, IP addresses, or locations are stored. Needs a D1 database bound as DB (does nothing until bound).
export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) return new Response(null, { status: 204 });
    const b = await request.json().catch(() => ({}));
    const id = String(b.id || "").replace(/[^a-z0-9]/gi, "").slice(0, 32);
    if (id.length < 12) return new Response(null, { status: 204 });
    const build = String(b.v || "").replace(/[^a-z0-9]/gi, "").slice(0, 16);
    const now = Date.now(), day = new Date(now).toISOString().slice(0, 10);
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS visits (id TEXT, day TEXT, ts INTEGER, build TEXT)").run();
    await env.DB.prepare("INSERT INTO visits (id, day, ts, build) VALUES (?, ?, ?, ?)").bind(id, day, now, build).run();
    return new Response(null, { status: 204 });
  } catch (e) { return new Response(null, { status: 204 }); }
}
export async function onRequestGet() { return new Response(null, { status: 405 }); }
