import { getConfig } from "../config.js";

const PAIN_KEYWORDS = [
  "problema", "queja", "multa", "burocracia", "retraso", "lento", "caro",
  "imposible", "denuncia", "fallo", "error", "cierre", "crisis", "huelga",
  "protesta", "reclamación", "sanción", "deuda", "impago", "colapso",
];

const HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; market-intel/0.1)" };

function sentimentScore(text) {
  const words = text.toLowerCase().split(/\s+/);
  const negCount = words.filter(w => PAIN_KEYWORDS.includes(w)).length;
  return Math.max(-1.0, -(negCount / Math.max(words.length, 1)) * 10);
}

function signalStrength(matchedKeywords, sentimentScore, textLength) {
  const kwScore   = Math.min(matchedKeywords / 3, 1.0);
  const sentScore = Math.min(Math.abs(sentimentScore), 1.0);
  const lenScore  = Math.min(textLength / 500, 1.0);
  return Math.min(1.0, Math.round((kwScore * 0.45 + sentScore * 0.35 + lenScore * 0.15) * 1000) / 1000);
}

function shortId() {
  return Math.random().toString(36).slice(2, 10);
}

async function fetchFeed(url) {
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) return [];
  const xml = await r.text();
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRegex.exec(xml)) !== null) {
    const block = m[1];
    const title = (/<title><!\[CDATA\[(.*?)\]\]><\/title>/.exec(block) || /<title>(.*?)<\/title>/.exec(block) || [])[1] || "";
    const link  = (/<link>(.*?)<\/link>/.exec(block) || [])[1] || "";
    const desc  = (/<description><!\[CDATA\[(.*?)\]\]><\/description>/.exec(block) || /<description>(.*?)<\/description>/.exec(block) || [])[1] || "";
    if (title) items.push({ title: title.trim(), link: link.trim(), desc: desc.trim() });
  }
  return items.slice(0, 20);
}

async function insertSignal(db, signal) {
  const existing = await db.prepare(
    "SELECT 1 FROM signals WHERE url=? AND segment=? LIMIT 1"
  ).bind(signal.url, signal.segment).first();
  if (existing) return false;

  await db.prepare(`
    INSERT INTO signals (id, source, collected_at, segment, location, raw_text, url,
      pain_keywords, sentiment_score, salary_mean, income_tier, signal_strength, has_deadline)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    signal.id, signal.source, signal.collected_at, signal.segment,
    signal.location, signal.raw_text.slice(0, 2000), signal.url,
    JSON.stringify(signal.pain_keywords), signal.sentiment_score,
    null, null, signal.signal_strength, 0,
  ).run();
  return true;
}

export async function runLocalNewsCron(env) {
  const cfg = await getConfig(env.DB);
  const ln = cfg.collectors.local_news;
  const feeds = ln.feeds;
  const location = ln.location;

  if (!feeds || !feeds.length) {
    console.warn(`local_news: no feeds configured for "${location}" — skipping`);
    return;
  }

  let total = 0;
  for (const feedUrl of feeds) {
    try {
      const items = await fetchFeed(feedUrl);
      for (const item of items) {
        const text    = `${item.title}. ${item.desc}`;
        const sent    = sentimentScore(text);
        const matched = PAIN_KEYWORDS.filter(kw => text.toLowerCase().includes(kw));
        if (matched.length === 0 && sent > -0.03) continue;

        const inserted = await insertSignal(env.DB, {
          id:              shortId(),
          source:          "local_news",
          collected_at:    new Date().toISOString(),
          segment:         "general",
          location,
          raw_text:        text,
          url:             item.link || `local_news://${shortId()}`,
          pain_keywords:   matched,
          sentiment_score: sent,
          signal_strength: signalStrength(matched.length, sent, text.length),
        });
        if (inserted) total++;
      }
      await new Promise(r => setTimeout(r, 300));
    } catch (e) {
      console.error(`local_news feed "${feedUrl}":`, e.message);
    }
  }
  console.log(`local_news cron (${location}): ${total} new signals`);
}
