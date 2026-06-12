/**
 * routes/config.ts
 *
 * Route handlers for config retrieval, update, and seed generation.
 */

import { getConfig, setConfig, invalidateCache } from '../infrastructure/config.js';
import { LLMChain } from '../infrastructure/llm/chain.js';
import { json, makeLlm, hasLlmKey, authCors, PUBLIC_CORS } from '../index.js';
import type { Config } from '../domain/types.js';
import type { Env } from '../index.js';

interface SeedConfig {
  segments: Record<string, import('../domain/types.js').MarketSegment>;
  reddit_subreddits: string[];
  pain_keywords: string[];
  collectors_enabled: { boe: boolean; boja: boolean; bocas: boolean };
}

async function generateSeedConfig(description: string, llm: LLMChain): Promise<SeedConfig> {
  const prompt = `You are a market research analyst configuring a pain-signal intelligence system.

Given this target market description, generate a collector configuration as valid JSON only — no markdown, no explanation.

Output this exact structure:
{
  "segments": {
    "<slug>": {
      "label": "<human label>",
      "queries": ["<gnews search query>", ...],
      "keywords": ["<pain keyword>", ...],
      "income_tier": "low|medium|medium_high|high",
      "has_deadline": true|false
    }
  },
  "reddit_subreddits": ["<subreddit name without r/>", ...],
  "pain_keywords": ["<keyword>", ...],
  "collectors_enabled": { "boe": true|false, "boja": true|false, "bocas": true|false }
}

Rules:
- 5–8 segments, each representing a distinct professional profile with real pain
- Slug keys: lowercase, no accents, underscores only (autonomo not autónomo)
- queries: 2–4 Google News search strings in the market language, specific to pain/regulation
- keywords: 5–10 terms reflecting frustrations, regulations, deadlines, costs
- reddit_subreddits: 4–8 real communities relevant to this market
- pain_keywords: 10–15 general pain vocabulary words for scanning local news
- Enable boe/boja/bocas only if the market is Spain-based

Target market: ${description}`;

  const raw = await llm.complete(prompt, 2048);

  const start = raw.indexOf('{');
  const end   = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('LLM did not return valid JSON');

  const parsed = JSON.parse(raw.slice(start, end + 1)) as Partial<SeedConfig>;

  return {
    segments:           parsed.segments ?? {},
    reddit_subreddits:  parsed.reddit_subreddits ?? [],
    pain_keywords:      parsed.pain_keywords ?? [],
    collectors_enabled: parsed.collectors_enabled ?? { boe: false, boja: false, bocas: false },
  };
}

export async function handleGetConfig(db: D1Database): Promise<Response> {
  const cfg = await getConfig(db);
  return json({ config: cfg });
}

export async function handleSetConfig(db: D1Database, body: unknown, cors = PUBLIC_CORS): Promise<Response> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'invalid config' }, 400, cors);
  }
  await setConfig(db, body as Record<string, unknown>);
  invalidateCache();
  return json({ status: 'ok' }, 200, cors);
}

export async function handleGenerateSeed(env: Env, body: { description?: string }): Promise<Response> {
  const cors = authCors(env);
  if (!hasLlmKey(env)) return json({ error: 'LLM key not configured' }, 503, cors);
  const { description } = body;
  if (!description?.trim()) return json({ error: 'description required' }, 400, cors);
  const cfg = await getConfig(env.DB);
  const llm = makeLlm(cfg.llm, env);
  const seed = await generateSeedConfig(description, llm);
  await setConfig(env.DB, {
    segments: seed.segments,
    collectors: {
      reddit:     { enabled: true, subreddits: seed.reddit_subreddits },
      local_news: { enabled: true, feeds: [], pain_keywords: seed.pain_keywords },
      boe:        { enabled: seed.collectors_enabled.boe },
      boja:       { enabled: seed.collectors_enabled.boja },
      bocas:      { enabled: seed.collectors_enabled.bocas },
    } as unknown as Config['collectors'],
  });
  invalidateCache();
  return json({ ok: true, segments: seed.segments }, 200, cors);
}
