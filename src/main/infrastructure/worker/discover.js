// src/main/infrastructure/worker/discover.js

const HN_QUERIES = [
  "solo practitioner software pain billing",
  "freelancer professional bureaucracy",
  "small practice management software problem",
  "professional license permit Spain problem",
];

const NEWS_QUERIES = [
  "autónomo España software problema hacienda",
  "profesional liberal burocracia queja",
  "pyme software gestión problema España",
];

const KNOWN_SEGMENTS = [
  "Odontólogo / Clínica dental",
  "Docente universitario",
  "Abogado autónomo",
  "Arquitecto",
];

const CLUSTER_PROMPT = `Analiza estos textos de noticias y foros profesionales.
Identifica perfiles profesionales con dolores recurrentes NO incluidos en: {known}.

TEXTOS:
{posts}

Para cada perfil nuevo devuelve JSON:
{"profile":"...","pain":"...","keywords":["..."],"post_count":N,"income_estimate":"high|medium_high|medium|low","has_deadline":true|false}

Devuelve SOLO un array JSON válido. Si no hay perfiles nuevos devuelve [].`;

export async function runDiscovery(apiKey, limit = 60) {
  const texts = await collectBroad(limit);
  if (!texts.length) return [];

  const allClusters = [];
  const toProcess = texts.slice(0, 30); // cost cap: max 2 LLM batches
  for (let i = 0; i < toProcess.length; i += 15) {
    const batch = toProcess.slice(i, i + 15);
    const clusters = await clusterBatch(batch, apiKey);
    allClusters.push(...clusters);
  }

  return aggregate(allClusters);
}

async function collectBroad(limit) {
  const texts = [];

  for (const query of HN_QUERIES) {
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

  for (const query of NEWS_QUERIES) {
    if (texts.length >= limit) break;
    try {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=es&gl=ES&ceid=ES:es`;
      const res = await fetch(url, { headers: { "User-Agent": "market-intel/0.1" } });
      if (!res.ok) continue;
      const text = await res.text();
      const matches = [...text.matchAll(/<title><!\[CDATA\[([^\]]+)\]\]><\/title>|<title>([^<]+)<\/title>/g)];
      for (const m of matches.slice(1, 11)) { // skip feed title
        const title = (m[1] || m[2] || "").trim();
        if (title) texts.push(title);
      }
    } catch (e) {
      console.error(`News RSS '${query}':`, e.message);
    }
  }

  return texts.slice(0, limit);
}

async function clusterBatch(texts, apiKey) {
  const prompt = CLUSTER_PROMPT
    .replace("{known}", KNOWN_SEGMENTS.join(", "))
    .replace("{posts}", texts.map((t, i) => `${i + 1}. ${t}`).join("\n"));

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "anthropic/claude-haiku-4-5",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 600,
      }),
    });
    if (!res.ok) return [];

    const data = await res.json();
    const choices = data?.choices;
    if (!choices?.length) {
      console.error("cluster batch: empty choices", JSON.stringify(data).slice(0, 200));
      return [];
    }
    let raw = choices[0].message.content.trim();
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
