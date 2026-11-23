// Consi "Today in litigation" (Nov 23, 2026). GET /api/news -> { ts, next, items: [{ t, s, u }] }.
// Headlines only: a title, an outlet name and a link out. No article text is read, stored, or shown.
// Refreshes at 7:00 a.m., 12:00 noon and 5:00 p.m. AST: the first visit after each moment starts a background refresh,
// and the visitor who triggers it still gets the previous list at once. If a refresh fails, the last good list stays up.
// Storage is the existing D1 binding DB (tables created on first use). AI is the existing binding AI, used only to score headlines.
import { SOURCES, UA, windowStart, nextWindow, gather, select, aiScores } from "../_lib/news-core.js";

const json = (o, s = 200, cache = "public, max-age=120") => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json; charset=utf-8", "cache-control": cache } });

async function ensure(DB) {
  await DB.prepare("CREATE TABLE IF NOT EXISTS news (id INTEGER PRIMARY KEY, ts INTEGER, att INTEGER, items TEXT, status TEXT)").run();
  await DB.prepare("CREATE TABLE IF NOT EXISTS newsfeeds (id TEXT PRIMARY KEY, url TEXT, ts INTEGER)").run();
}

async function getText(u, ms = 6000, max = 1500000) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(u, { signal: ac.signal, redirect: "follow", headers: { "user-agent": UA, "accept": "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/html;q=0.8, */*;q=0.5" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return (await r.text()).slice(0, max);
  } finally { clearTimeout(t); }
}

async function refresh(env, now) {
  const DB = env.DB;
  const cache = {
    get: async id => { try { const r = await DB.prepare("SELECT url FROM newsfeeds WHERE id=? AND ts>?").bind(id, now - 14 * 864e5).first(); return r ? r.url : ""; } catch (e) { return ""; } },
    set: async (id, url) => { try { await DB.prepare("INSERT INTO newsfeeds(id,url,ts) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET url=excluded.url, ts=excluded.ts").bind(id, url, now).run(); } catch (e) {} }
  };
  const { cands, status } = await gather(SOURCES, u => getText(u), cache, now);
  cands.sort((a, b) => b.d - a.d);
  const pool = cands.slice(0, 90);
  const ai = await aiScores(env, pool);
  const items = select(pool, ai, now, 10).map(x => ({ t: x.t, s: x.s, u: x.u }));
  const st = JSON.stringify({ at: now, ai: !!ai, candidates: pool.length, sources: status.map(x => ({ id: x.id, ok: x.ok, n: x.n, feed: x.feed, err: x.err })) });
  if (items.length >= 3) {
    await DB.prepare("UPDATE news SET ts=?, items=?, status=? WHERE id=1").bind(now, JSON.stringify(items), st).run();
  } else {
    await DB.prepare("UPDATE news SET status=? WHERE id=1").bind(st).run();   // keep the last good list
  }
}

export async function onRequestGet({ request, env, waitUntil }) {
  try {
    if (!env.DB) return json({ ts: 0, next: 0, items: [] }, 200, "no-store");
    const url = new URL(request.url), dbg = url.searchParams.get("debug") === "1";
    await ensure(env.DB);
    const now = Date.now();
    let row = await env.DB.prepare("SELECT ts, att, items, status FROM news WHERE id=1").first();
    const have = row && row.items && row.items !== "[]";
    const stale = !row || !(row.ts >= windowStart(now));
    const canTry = !row || !row.att || now - row.att > 10 * 60 * 1000;
    if (stale && canTry) {
      await env.DB.prepare("INSERT INTO news(id,ts,att,items,status) VALUES(1,0,?,?,?) ON CONFLICT(id) DO UPDATE SET att=excluded.att").bind(now, "[]", "{}").run();
      const job = refresh(env, now).catch(e => env.DB.prepare("UPDATE news SET status=? WHERE id=1").bind(JSON.stringify({ at: now, error: String(e && e.message || e).slice(0, 120) })).run().catch(() => {}));
      if (!have) { await job; row = await env.DB.prepare("SELECT ts, att, items, status FROM news WHERE id=1").first(); }   // first ever run: wait for it
      else if (typeof waitUntil === "function") waitUntil(job);
    }
    let items = []; try { items = JSON.parse((row && row.items) || "[]"); } catch (e) {}
    const out = { ts: row ? row.ts : 0, next: nextWindow(now), items };
    if (dbg) { try { out.status = JSON.parse((row && row.status) || "{}"); } catch (e) { out.status = {}; } }
    return json(out, 200, dbg ? "no-store" : "public, max-age=120");
  } catch (e) {
    return json({ ts: 0, next: 0, items: [] }, 200, "no-store");
  }
}
