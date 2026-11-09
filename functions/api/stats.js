// Private dashboard: /api/stats?key=YOUR_KEY  (key is the STATS_KEY secret set in Cloudflare; never stored in this public repo)
export async function onRequestGet({ request, env }) {
  // Compare letters and digits only, so a dash or dot that a phone drops or adds at the end of the link doesn't matter.
  const norm = v => String(v || "").replace(/[^A-Za-z0-9]/g, "");
  const key = norm(new URL(request.url).searchParams.get("key"));
  const page = (msg, status) => new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Consi visitors</title><body style="font:17px/1.5 -apple-system,system-ui,sans-serif;margin:24px">${msg}</body>`, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  if (!env.STATS_KEY) return page("<p>The dashboard key (STATS_KEY) isn’t set for this site yet.</p>", 200);
  if (!key || key !== norm(env.STATS_KEY)) return page("<p>Not found.</p>", 404);
  if (!env.DB) return page("<p>The database isn’t connected yet.</p>", 200);
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS visits (id TEXT, day TEXT, ts INTEGER, build TEXT)").run();
  const q = async (sql, ...a) => (await env.DB.prepare(sql).bind(...a).first()) || {};
  const all = async (sql, ...a) => ((await env.DB.prepare(sql).bind(...a).all()).results) || [];
  const d = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  const tot = await q("SELECT COUNT(*) v, COUNT(DISTINCT id) u FROM visits");
  const t1 = await q("SELECT COUNT(*) v, COUNT(DISTINCT id) u FROM visits WHERE day = ?", d(0));
  const t7 = await q("SELECT COUNT(*) v, COUNT(DISTINCT id) u FROM visits WHERE day >= ?", d(6));
  const t30 = await q("SELECT COUNT(*) v, COUNT(DISTINCT id) u FROM visits WHERE day >= ?", d(29));
  const ret = await q("SELECT COUNT(*) n FROM (SELECT id FROM visits GROUP BY id HAVING COUNT(DISTINCT day) > 1)");
  const days = await all("SELECT day, COUNT(*) v, COUNT(DISTINCT id) u FROM visits WHERE day >= ? GROUP BY day ORDER BY day DESC", d(29));
  const dist = await all("SELECT CASE WHEN c=1 THEN '1' WHEN c<=5 THEN '2–5' WHEN c<=20 THEN '6–20' ELSE '21+' END b, COUNT(*) n FROM (SELECT COUNT(*) c FROM visits GROUP BY id) GROUP BY b");
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS misses (q TEXT, n INTEGER, day TEXT, ts INTEGER, build TEXT)").run();
  const esc = v => String(v || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const miss = await all("SELECT lower(q) q, COUNT(*) c, SUM(CASE WHEN n=0 THEN 1 ELSE 0 END) z, MAX(day) last FROM misses WHERE day >= ? GROUP BY lower(q) ORDER BY c DESC, last DESC LIMIT 100", d(29));
  const missN = await q("SELECT COUNT(*) n FROM misses WHERE day >= ?", d(29));
  const f = n => Number(n || 0).toLocaleString("en-US"), avg = r => r.u ? (r.v / r.u).toFixed(1) : "0";
  const row = (l, r) => `<tr><td>${l}</td><td>${f(r.u)}</td><td>${f(r.v)}</td><td>${avg(r)}</td></tr>`;
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Consi visitors</title>
<style>body{font:16px/1.45 -apple-system,system-ui,sans-serif;margin:20px;color:#111;background:#fff}h1{font-size:22px}table{border-collapse:collapse;width:100%;margin:10px 0 22px}td,th{padding:8px 6px;border-bottom:1px solid #ddd;text-align:right}td:first-child,th:first-child{text-align:left}p{color:#555}@media (prefers-color-scheme:dark){body{background:#111;color:#eee}td,th{border-color:#333}p{color:#aaa}}</style>
<h1>Consi visitors</h1><table><tr><th></th><th>Users</th><th>Visits</th><th>Visits per user</th></tr>${row("Today", t1)}${row("Last 7 days", t7)}${row("Last 30 days", t30)}${row("All time", tot)}</table>
<p><b>${f(ret.n)}</b> users have come back on more than one day.</p>
<h1>Visits per user, all time</h1><table><tr><th>Visits</th><th>Users</th></tr>${dist.map(r => `<tr><td>${r.b}</td><td>${f(r.n)}</td></tr>`).join("")}</table>
<h1>By day, last 30 days</h1><table><tr><th>Day</th><th>Users</th><th>Visits</th><th>Per user</th></tr>${days.map(r => `<tr><td>${r.day}</td><td>${f(r.u)}</td><td>${f(r.v)}</td><td>${avg(r)}</td></tr>`).join("")}</table>
<h1>Searches Consi couldn’t answer, last 30 days</h1><p>${f(missN.n)} searches found one result or none. Most frequent first; “No results” counts the ones that found nothing at all.</p><table><tr><th>Search</th><th>Times</th><th>No results</th><th>Last</th></tr>${miss.map(r => `<tr><td>${esc(r.q)}</td><td>${f(r.c)}</td><td>${f(r.z)}</td><td>${r.last}</td></tr>`).join("") || `<tr><td colspan="4">None yet.</td></tr>`}</table>
<p>“Users” are devices: a phone and a laptop count as two, and someone who clears their browser data counts as new. Times are UTC days.</p>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
