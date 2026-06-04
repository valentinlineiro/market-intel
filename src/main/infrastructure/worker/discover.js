import { callLLM } from "./llm.js";
import { getConfig } from "./config.js";

const CLUSTER_PROMPT = `Analiza estos textos de noticias y foros profesionales.
Identifica perfiles profesionales con dolores recurrentes NO incluidos en: {known}.

TEXTOS:
{posts}

Para cada perfil nuevo devuelve JSON:
{"profile":"...","pain":"...","keywords":["..."],"post_count":N,"income_estimate":"high|medium_high|medium|low","has_deadline":true|false}

Devuelve SOLO un array JSON válido. Si no hay perfiles nuevos devuelve [].`;

export async function runDiscovery(env, limit = 60) {
  const cfg = await getConfig(env.DB);
  const disc = cfg.discover;

  const texts = await collectBroad(disc, limit);
  if (!texts.length) return [];

  const allClusters = [];
  const toProcess = texts.slice(0, disc.text_limit);
  const batchSize = disc.batch_size || 15;
  for (let i = 0; i < toProcess.length; i += batchSize) {
    const batch = toProcess.slice(i, i + batchSize);
    const clusters = await clusterBatch(batch, disc.known_segments, env);
    allClusters.push(...clusters);
  }

  return aggregate(allClusters);
}

async function collectBroad(disc, limit) {
  const texts = [];

  for (const query of disc.hn_queries) {
    if (texts.length >= limit) break;
    try {
      const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story,ask_hn&hitsPerPage=12`;
      const res = await fetch(url, { headers: { "User-Agent": "market-intel/0.1" } });
      if (!res.ok) continue;
      const data = await res.json();
      for (const hit of data.hits ?? []) {
        const title = (hit.title || "").trim();
        const body  = (hit.story_text || "").slice(0, 200).trim();
        if (title) texts.push(body ? `${title} — ${body}` : title);
      }
    } catch (e) {
      console.error(`HN broad '${query}':`, e.message);
    }
  }

  for (const query of disc.news_queries) {
    if (texts.length >= limit) break;
    try {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=es&gl=ES&ceid=ES:es`;
      const res = await fetch(url, { headers: { "User-Agent": "market-intel/0.1" } });
      if (!res.ok) continue;
      const text = await res.text();
      const matches = [...text.matchAll(/<title><!\[CDATA\[([^\]]+)\]\]><\/title>|<title>([^<]+)<\/title>/g)];
      for (const m of matches.slice(1, 11)) {
        const title = (m[1] || m[2] || "").trim();
        if (title) texts.push(title);
      }
    } catch (e) {
      console.error(`News RSS '${query}':`, e.message);
    }
  }

  return texts.slice(0, limit);
}

async function clusterBatch(texts, knownSegments, env) {
  const prompt = CLUSTER_PROMPT
    .replace("{known}", knownSegments.join(", "))
    .replace("{posts}", texts.map((t, i) => `${i + 1}. ${t}`).join("\n"));

  try {
    let raw = await callLLM(prompt, env, { maxTokens: 600 });
    raw = raw.replace(/^```[\w]*\n?/, "").replace(/\n?```$/, "").trim();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (e) {
    console.error("cluster batch failed:", e.message);
    return [];
  }
}

function aggregate(clusters) {
  const merged = [];
  for (const c of clusters) {
    if (!c.profile) continue;
    const keywords = c.keywords || [];
    const kwLower = keywords.map(k => k.toLowerCase());
    const existing = merged.find(
      m => kwLower.filter(k => (m.keywords || []).map(x => x.toLowerCase()).includes(k)).length >= 2
    );
    if (existing) {
      existing.post_count = (existing.post_count || 0) + Math.min(c.post_count || 1, 15);
      existing.batch_count = existing.batch_count + 1;
    } else {
      merged.push({ ...c, keywords, batch_count: 1, post_count: Math.min(c.post_count || 1, 15) });
    }
  }
  return merged
    .map(m => ({
      profile:         m.profile,
      pain:            m.pain,
      keywords:        m.keywords || [],
      post_count:      m.post_count || 1,
      discovery_score: Math.round((m.post_count || 1) * (1 + (m.batch_count || 1) * 0.5) * 10) / 10,
      income_est:      m.income_estimate || null,
      has_deadline:    m.has_deadline || false,
    }))
    .sort((a, b) => b.discovery_score - a.discovery_score);
}
