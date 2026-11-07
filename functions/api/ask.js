// Consi AI answers. Uses Cloudflare Workers AI (binding AI) on ONLY the Consi excerpts the app sends.
// No question text is stored. Rate limits use the D1 binding DB (per anonymous device ID and per day overall).
const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const PER_DEVICE_DAY = 40, ALL_DAY = 1500;
const SYS = `You are Consi's research assistant for U.S. litigators. Answer the question using ONLY the numbered sources provided; they come from Consi's summaries of federal and state court rules, judges' chambers rules, and the federal rules.
Rules:
- Cite every statement with the source number in square brackets, like [2] or [1][3].
- If the sources don't answer the question, say exactly: "Consi’s sources don’t answer that." Then say in one sentence what to check (for example, the court’s local rules or the judge’s current procedures). Never guess and never use outside knowledge.
- Be direct and brief: 2 to 5 sentences. Lead with the answer (the deadline, the limit, yes or no).
- Name the court or judge each point comes from when it matters.
- Use the Oxford comma. Plain English. No headings or bullet lists.`;
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
export async function onRequestPost({ request, env }) {
  try {
    if (!env.AI) return json({ off: 1, msg: "AI isn’t connected yet." });
    const b = await request.json().catch(() => ({}));
    const q = String(b.q || "").replace(/\s+/g, " ").trim().slice(0, 300);
    const id = String(b.id || "").replace(/[^a-z0-9]/gi, "").slice(0, 32);
    const src = (Array.isArray(b.src) ? b.src : []).slice(0, 10).map(s => ({ t: String(s.t || "").slice(0, 160), s: String(s.s || "").slice(0, 120), x: String(s.x || "").slice(0, 1200) })).filter(s => s.x || s.t);
    if (q.length < 4 || !src.length) return json({ a: "" });
    if (env.DB) {
      const day = new Date().toISOString().slice(0, 10);
      await env.DB.prepare("CREATE TABLE IF NOT EXISTS asks (id TEXT, day TEXT, n INTEGER, PRIMARY KEY (id, day))").run();
      const all = await env.DB.prepare("SELECT COALESCE(SUM(n),0) t FROM asks WHERE day = ?").bind(day).first();
      if ((all && all.t) >= ALL_DAY) return json({ limit: 1, msg: "Consi’s AI answers are at today’s limit. The regular results below still work." });
      if (id) {
        const me = await env.DB.prepare("SELECT n FROM asks WHERE id = ? AND day = ?").bind(id, day).first();
        if (me && me.n >= PER_DEVICE_DAY) return json({ limit: 1, msg: "You’ve reached today’s limit for AI answers. The regular results below still work." });
        await env.DB.prepare("INSERT INTO asks (id, day, n) VALUES (?, ?, 1) ON CONFLICT(id, day) DO UPDATE SET n = n + 1").bind(id, day).run();
      }
    }
    const sources = src.map((s, i) => `[${i + 1}] ${s.t}${s.s ? " (" + s.s + ")" : ""}\n${s.x}`).join("\n\n");
    const out = await env.AI.run(MODEL, { messages: [{ role: "system", content: SYS }, { role: "user", content: `Sources:\n\n${sources}\n\nQuestion: ${q}` }], max_tokens: 350, temperature: 0.1 });
    const a = String((out && (out.response || out.result && out.result.response)) || "").trim();
    return json({ a });
  } catch (e) { return json({ err: 1, msg: "The AI answer isn’t available right now. The regular results below still work." }); }
}
export async function onRequestGet() { return new Response(null, { status: 405 }); }
