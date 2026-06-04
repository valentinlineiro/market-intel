import { getConfig } from "../config.js";

const GNEWS_BASE = "https://news.google.com/rss/search?hl=es&gl=ES&ceid=ES:es&q=";
const HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; market-intel/0.1)" };

function signalStrength(matchedKeywords, sentimentScore, textLength) {
  const kwScore   = Math.min(matchedKeywords / 3, 1.0);
  const sentScore = Math.min(Math.abs(sentimentScore), 1.0);
  const lenScore  = Math.min(textLength / 500, 1.0);
  return Math.min(1.0, Math.round((kwScore * 0.45 + sentScore * 0.35 + lenScore * 0.15) * 1000) / 1000);
}

function sentimentScore(text) {
  const neg = ["problema","horrible","imposible","multa","burocracia","lento","caro","queja","odio","caos","frustrado","harto","fallo"];
  const words = text.toLowerCase().split(/\s+/);
  const negCount = words.filter(w => neg.includes(w)).length;
  return Math.max(-1.0, -(negCount / Math.max(words.length, 1)) * 10);
}

function shortId() {
  return Math.random().toString(36).slice(2, 10);
}

async function fetchFeed(query) {
  const url = GNEWS_BASE + encodeURIComponent(query);
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) return [];
  const xml = await r.text();
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRegex.exec(xml)) !== null) {
    const block = m[1];
    const title   = (/<title><!\[CDATA\[(.*?)\]\]><\/title>/.exec(block) || /<title>(.*?)<\/title>/.exec(block) || [])[1] || "";
    const link    = (/<link>(.*?)<\/link>/.exec(block) || [])[1] || "";
    const desc    = (/<description><!\[CDATA\[(.*?)\]\]><\/description>/.exec(block) || (/<description>(.*?)<\/description>/.exec(block)) || [])[1] || "";
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
    signal.salary_mean, signal.income_tier, signal.signal_strength,
    signal.has_deadline ? 1 : 0,
  ).run();
  return true;
}

export async function runGnewsCron(db) {
  const cfg = await getConfig(db);
  const segments = cfg.collectors.gnews_segments;

  let total = 0;
  for (const [segment, config] of Object.entries(segments)) {
    for (const query of config.queries) {
      try {
        const items = await fetchFeed(query);
        for (const item of items) {
          const text = `${item.title}. ${item.desc}`;
          const sent = sentimentScore(text);
          const matched = config.keywords.filter(kw => text.toLowerCase().includes(kw)).length;
          if (matched === 0 && sent > -0.03) continue;

          const inserted = await insertSignal(db, {
            id:            shortId(),
            source:        "google_news",
            collected_at:  new Date().toISOString(),
            segment,
            location:      "España",
            raw_text:      text,
            url:           item.link || `gnews://${shortId()}`,
            pain_keywords: config.keywords.filter(kw => text.toLowerCase().includes(kw)),
            sentiment_score: sent,
            salary_mean:   config.salary_mean,
            income_tier:   config.income_tier,
            signal_strength: signalStrength(matched, sent, text.length),
            has_deadline:  config.has_deadline,
          });
          if (inserted) total++;
        }
        await new Promise(r => setTimeout(r, 500));
      } catch (e) {
        console.error(`gnews cron ${segment} "${query}": ${e.message}`);
      }
    }
  }
  console.log(`gnews cron: ${total} new signals`);
}
