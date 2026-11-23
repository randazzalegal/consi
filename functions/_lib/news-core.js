// Consi "Today in litigation" (Nov 23, 2026). Pure logic, no network of its own, so it can be tested offline.
// Headlines only: a title, a link, and the outlet's name. Article text is never read, stored, or shown.

export const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
export const UA = "Mozilla/5.0 (compatible; ConsiNews/1.0; +https://consi.law)";

/* kind: big = general litigation news, appeals = appellate/Supreme Court, bar = a bar association's own news. */
export const SOURCES = [
  { id: "volokh", name: "Volokh Conspiracy", kind: "big", feeds: ["https://reason.com/volokh/feed/"], home: "https://reason.com/volokh/" },
  { id: "instapundit", name: "Instapundit", kind: "big", feeds: ["https://instapundit.com/feed"], home: "https://instapundit.com/" },
  { id: "scotusblog", name: "SCOTUSblog", kind: "appeals", feeds: ["https://www.scotusblog.com/feed/"], home: "https://www.scotusblog.com/" },
  { id: "chn", name: "Courthouse News", kind: "big", feeds: ["https://www.courthousenews.com/feed/"], home: "https://www.courthousenews.com/" },
  { id: "lawcrime", name: "Law&Crime", kind: "big", feeds: ["https://lawandcrime.com/feed/"], home: "https://lawandcrime.com/" },
  { id: "abaj", name: "ABA Journal", kind: "big", feeds: ["https://www.abajournal.com/feed"], home: "https://www.abajournal.com/" },
  { id: "flbar", name: "Florida Bar News", kind: "bar", feeds: ["https://www.floridabar.org/the-florida-bar-news/feed/"], home: "https://www.floridabar.org/the-florida-bar-news/" },
  { id: "mabar", name: "Massachusetts Bar Association", kind: "bar", feeds: [], home: "https://www.massbar.org/" },
  { id: "nvbar", name: "State Bar of Nevada", kind: "bar", feeds: [], home: "https://www.nvbar.org/" },
  { id: "cabar", name: "State Bar of California", kind: "bar", feeds: [], home: "https://www.calbar.ca.gov/" },
  { id: "azbar", name: "State Bar of Arizona", kind: "bar", feeds: [], home: "https://www.azbar.org/" }
];

/* No paywalled outlets, and no Above the Law (owner's instruction), including its sister sites such as How Appealing. */
export const BLOCK = ["law360.com", "bloomberglaw.com", "bloomberg.com", "wsj.com", "nytimes.com", "ft.com", "abovethelaw.com", "westlaw.com", "lexisnexis.com", "law.com", "americanlawyer.com", "thetimes.com", "economist.com"];

/* Refresh windows: 7:00 a.m., 12:00 noon and 5:00 p.m. Atlantic Standard Time (UTC-4, no daylight saving). */
export const WINDOW_HOURS_UTC = [11, 16, 21];
const DAY = 864e5, HOUR = 36e5;
function dayStart(now) { const d = new Date(now); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); }
export function windowStart(now) {
  const b = dayStart(now), c = [];
  for (let d = -1; d <= 0; d++) for (const h of WINDOW_HOURS_UTC) c.push(b + d * DAY + h * HOUR);
  return Math.max(...c.filter(t => t <= now));
}
export function nextWindow(now) {
  const b = dayStart(now), c = [];
  for (let d = 0; d <= 1; d++) for (const h of WINDOW_HOURS_UTC) c.push(b + d * DAY + h * HOUR);
  return Math.min(...c.filter(t => t > now));
}

const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "\u2019", lsquo: "\u2018", ldquo: "\u201c", rdquo: "\u201d", hellip: "\u2026", mdash: "\u2014", ndash: "\u2013" };
export function decode(s) {
  return String(s || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    const v = NAMED[e.toLowerCase()];
    return v === undefined ? m : v;
  });
}
export function cleanText(s) {
  let t = String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  t = decode(t).replace(/<[^>]*>/g, " ");   // tags that arrived escaped inside the title
  t = decode(t);                              // feeds that encode twice
  return t.replace(/\s+/g, " ").trim();
}
function tagText(block, tag) {
  const m = block.match(new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + tag + ">", "i"));
  return m ? m[1] : "";
}

/* RSS 2.0 or Atom. Reads only title, link and date. Never the description or the article body. */
export function parseFeed(xml, max = 30) {
  const head = String(xml || "").slice(0, 3000);
  const isAtom = /<feed[\s>]/i.test(head) && !/<rss[\s>]/i.test(head);
  const re = isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi;
  const out = []; let m;
  while ((m = re.exec(xml)) && out.length < max) {
    const b = m[0];
    const title = cleanText(tagText(b, "title"));
    let link = "";
    if (isAtom) {
      const ls = [...b.matchAll(/<link\b[^>]*>/gi)].map(x => x[0]);
      const pick = ls.find(l => /rel\s*=\s*["']alternate["']/i.test(l)) || ls.find(l => !/rel\s*=/i.test(l)) || ls[0] || "";
      const h = pick.match(/href\s*=\s*["']([^"']+)["']/i);
      link = h ? decode(h[1]).trim() : "";
    } else {
      link = cleanText(tagText(b, "link"));
      if (!link) { const g = cleanText(tagText(b, "guid")); if (/^https?:\/\//i.test(g)) link = g; }
    }
    const ds = tagText(b, "pubDate") || tagText(b, "dc:date") || tagText(b, "published") || tagText(b, "updated");
    const t = Date.parse(cleanText(ds));
    if (title && link) out.push({ t: title, u: link, d: Number.isFinite(t) ? t : 0 });
  }
  return out;
}

/* Feed autodiscovery from a page's <link rel="alternate" type="application/rss+xml"> tags. */
export function discoverFeeds(html, base) {
  const out = [];
  for (const m of String(html || "").matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/rel\s*=\s*["']alternate["']/i.test(tag)) continue;
    if (!/type\s*=\s*["']application\/(rss|atom)\+xml["']/i.test(tag)) continue;
    const h = tag.match(/href\s*=\s*["']([^"']+)["']/i);
    if (!h) continue;
    try { const u = new URL(decode(h[1]), base).href; if (!/comment/i.test(u) && !out.includes(u)) out.push(u); } catch (e) {}
  }
  return out.slice(0, 3);
}

const STRIP_PARAM = /^(utm_|mc_|fbclid$|gclid$|smid$|unlocked_article_code$|ref$|ref_src$|cid$|taid$|edition$|share$|cmpid$|ocid$|source$|campaign$)/i;
export function cleanUrl(u) {
  try {
    const x = new URL(String(u).trim());
    if (x.protocol !== "https:" && x.protocol !== "http:") return "";
    for (const k of [...x.searchParams.keys()]) if (STRIP_PARAM.test(k)) x.searchParams.delete(k);
    x.hash = "";
    return x.href;
  } catch (e) { return ""; }
}
export function blocked(u) {
  try { const h = new URL(u).hostname.toLowerCase(); return BLOCK.some(b => h === b || h.endsWith("." + b)); } catch (e) { return true; }
}

const KW = /\b(court|courts|circuit|supreme|justice|justices|judge|judges|ruling|rules?|lawsuit|sues?|sued|suit|appeals?|appellate|en banc|mandamus|injunction|indict\w*|plea|sentenc\w*|defamation|libel|antitrust|class action|settlement|verdict|trial|jury|attorney|attorneys|lawyer|lawyers|bar|disciplin\w*|sanction\w*|amicus|certiorari|stay|first amendment|anti-slapp|subpoena|discovery|bankruptcy)\b/gi;
export function kwScore(t) { const m = String(t).match(KW); return m ? Math.min(4, new Set(m.map(x => x.toLowerCase())).size) : 0; }
const APPEALS = /\b(\d+(st|nd|rd|th)\s+cir\w*|circuit|appeals? court|court of appeals?|en banc|mandamus|certiorari|supreme court|justices?)\b/i;

/* Asks Workers AI to score real headlines. It never writes or rewrites a headline. Returns null when AI is unavailable. */
export async function aiScores(env, list) {
  if (!env || !env.AI || !list.length) return null;
  try {
    const lines = list.map((x, k) => `${k}. [${x.s}] ${x.t.slice(0, 160)}`).join("\n");
    const r = await env.AI.run(MODEL, {
      messages: [
        { role: "system", content: "You rate news headlines for U.S. litigators. For each numbered headline give an integer from 0 to 10. 10 = a major court ruling, appeal, big lawsuit, or First Amendment or media-law case. 7 = notable legal-profession or bar news. 3 = only loosely related. 0 = not about law, courts, or lawyers. Judge only the headline text. Reply with ONLY a JSON array of integers, one per headline, in order." },
        { role: "user", content: lines }
      ],
      max_tokens: 600, temperature: 0
    });
    const txt = String((r && (r.response || r.result)) || "");
    const m = txt.match(/\[[\s\S]*\]/);
    if (!m) return null;
    const a = JSON.parse(m[0]);
    if (!Array.isArray(a) || a.length !== list.length) return null;
    return a.map(n => Math.max(0, Math.min(10, Math.round(+n || 0))));
  } catch (e) { return null; }
}

const normT = t => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 60);
/* cands: [{t,u,d,s,id,k}], ai: optional array of 0..10 scores in the same order. Returns up to N items, best first. */
export function select(cands, ai, now, N = 10) {
  const rec = d => { const h = (now - d) / HOUR; return h < 12 ? 2 : h < 36 ? 1 : 0; };
  const sc = cands.map((c, i) => {
    let base = ai && ai[i] != null ? ai[i] : Math.min(8, kwScore(c.t) * 2);
    if (APPEALS.test(c.t)) base += 1.5;
    return { ...c, rel: base, score: base + rec(c.d) };
  }).sort((a, b) => b.score - a.score || b.d - a.d);
  const chosen = [], per = {}, seenT = new Set(), seenU = new Set(); let bars = 0;
  const cap = s => s.kind === "bar" ? 1 : ({ volokh: 3, chn: 3 }[s.id] || 2);
  const tryAdd = (x, th) => {
    if (chosen.length >= N || x.score < th) return false;
    const nt = normT(x.t); if (seenT.has(nt) || seenU.has(x.u)) return false;
    if ((per[x.id] || 0) >= cap(x)) return false;
    if (x.kind === "bar" && bars >= 3) return false;
    chosen.push(x); seenT.add(nt); seenU.add(x.u); per[x.id] = (per[x.id] || 0) + 1; if (x.kind === "bar") bars++;
    return true;
  };
  const fl = sc.find(x => x.id === "flbar" && x.rel >= 4);   // the Florida Bar News is a named source: keep its best item when it is on topic (relevance, not freshness)
  if (fl) tryAdd(fl, 0);
  for (const th of [4.5, 3, 0]) for (const x of sc) tryAdd(x, th);
  return chosen.sort((a, b) => b.score - a.score || b.d - a.d);
}

/* Fetches every source and returns candidate headlines plus a per-source status. fetchText(url) and cache are injected. */
export async function gather(sources, fetchText, cache, now, maxAgeH = 60) {
  const status = [], cands = [];
  await Promise.all(sources.map(async s => {
    const st = { id: s.id, name: s.name, ok: false, n: 0, feed: "", err: "" };
    status.push(st);
    let items = [], tried = 0;
    const tryUrl = async u => {
      if (tried >= 4) return false;
      tried++;
      try { const xml = await fetchText(u); const it = parseFeed(xml); if (it.length) { items = it; st.feed = u; return true; } st.err = "no items"; }
      catch (e) { st.err = String(e && e.message || e).slice(0, 80); }
      return false;
    };
    try {
      const known = cache && (await cache.get(s.id));
      const urls = [...(known ? [known] : []), ...s.feeds.filter(f => f !== known)];
      let ok = false;
      for (const u of urls) { if (await tryUrl(u)) { ok = true; break; } }
      if (!ok) {
        try {
          const html = await fetchText(s.home);
          for (const u of discoverFeeds(html, s.home)) { if (await tryUrl(u)) { ok = true; break; } }
          if (!ok && !st.err) st.err = "no feed found";
        } catch (e) { st.err = String(e && e.message || e).slice(0, 80); }
      }
      if (ok && cache && st.feed !== known) await cache.set(s.id, st.feed);
    } catch (e) { st.err = String(e && e.message || e).slice(0, 80); }
    for (const it of items) {
      const u = cleanUrl(it.u);
      if (!u || blocked(u)) continue;
      if (!it.d || it.d > now + HOUR || now - it.d > maxAgeH * HOUR) continue;
      if (it.t.length < 8) continue;
      cands.push({ t: it.t.slice(0, 220), u, d: it.d, s: s.name, id: s.id, k: s.kind, kind: s.kind });
      st.n++;
    }
    st.ok = st.n > 0;
  }));
  return { cands, status };
}
