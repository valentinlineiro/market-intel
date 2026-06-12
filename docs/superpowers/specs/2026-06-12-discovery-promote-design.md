# Discovery Candidate Promote — Design Spec
_2026-06-12_

## Goal

Let a user manually promote a discovery candidate into an active segment directly from the dashboard, triggering an immediate focused background sync so the new segment starts accumulating signals without waiting for the next cron window.

## Scope

Three focused changes. No new DB tables or migrations.

1. Worker: `POST /discovery/promote` endpoint
2. Worker: `runFocusedSync` helper for single-segment collection
3. `SectorsGrid.svelte`: per-card promote button + state machine
4. `+page.svelte`: handle `on:promoted` event → poll sync

---

## 1. Worker — `/discovery/promote` endpoint

**Route:** `POST /discovery/promote` (auth-gated, same `Authorization: Bearer <WORKER_SECRET>` as other worker routes)

**Request body:**
```json
{
  "profile": "Fisioterapeuta autónomo",
  "keywords": ["colegio", "factura", "mutua", "habilitación"],
  "income_est": "medium_high",
  "has_deadline": false
}
```

**Processing steps:**

1. **Slug derivation** — export `profileToSlug` from `d1-repo.ts` (already defined there, line 32) and call it here. Single source of truth for slug logic across worker and DB layer.

2. **Duplicate check** — load current config; if `cfg.segments[slug]` already exists, return `{ ok: false, error: 'already_active' }` (HTTP 409).

3. **LLM query expansion** — one lightweight call to generate 2–3 GNews search queries from the profile name and keywords. Prompt pattern:
   ```
   Given this professional profile: "${profile}"
   And these pain keywords: ${keywords.join(', ')}
   Generate 2-3 Google News search strings (in Spanish) that would find articles about their specific problems.
   Return ONLY a JSON array of strings, nothing else.
   ```
   Use `max_tokens: 200`. On LLM failure, fall back to `["${profile} problema", "${profile} España"]` — non-fatal.

4. **Segment assembly** — build a `MarketSegment`:
   ```typescript
   {
     label:       profile,
     queries:     llmQueries,   // or fallback
     keywords:    keywords,
     income_tier: income_est ?? 'medium',
     has_deadline: has_deadline,
   }
   ```

5. **Save to config** — `setConfig(db, { segments: { ...cfg.segments, [slug]: newSegment } })` then `invalidateCache()`.

6. **Focused background sync** — `ctx.waitUntil(runFocusedSync(env, slug))`. Does NOT run a full cron — see section 2.

7. **Response:**
   ```json
   { "ok": true, "segment": "fisioterapeuta_autonomo", "run_id": "<uuid>" }
   ```
   The `run_id` is inserted into `cron_runs` by `runFocusedSync` so the existing poll loop can track it.

---

## 2. Worker — `runFocusedSync` helper

A scoped version of `runCronJob` that collects only for one segment. Lives in `index.ts` alongside `runCronJob`.

```typescript
async function runFocusedSync(env: Env, segmentKey: string): Promise<void>
```

Steps:
1. Load full config.
2. Extract the single segment: `const seg = cfg.segments[segmentKey]`.
3. Build a minimal focused config: `{ ...cfg, segments: { [segmentKey]: seg } }`.
4. Insert a `cron_runs` row with `trigger: 'manual'` and a fresh `run_id`.
5. Call `buildRegistry(focusedCfg, env, [])` — only this segment's collectors fire.
6. Call `runCollect`, `analyzeFriction` (for the fresh signals).
7. Run scoring for this segment via `runScore`, passing a mock discovery repo that returns only the promoted segment:
   ```typescript
   await runScore(
     {
       signals: d1repo,
       opportunities: d1repo,
       discovery: {
         ...d1repo,
         getSegmentsToScore: async () => [{
           key:             segmentKey,
           label:           seg.label,
           keywords:        seg.keywords,
           income_tier:     seg.income_tier,
           has_deadline:    seg.has_deadline,
           discovery_score: 5,
         }],
       },
     },
     notifier,
     1,     // topN — score this one segment
     0,     // minScore — always create the opportunity row
     false, // dryRun
     hasLlmKey(env) ? llm : undefined,
   );
   ```
   Without this, no `Opportunity` row exists for the new segment until the next cron (up to 12 h), leaving the Oportunidades tab empty immediately after promote.
8. Update the `cron_runs` row with `finished_at`, `fresh_signals`, `analyzed_signals`, `opps_updated`.

If the segment is missing from config by the time this runs (race condition), exit cleanly.

---

## 3. `SectorsGrid.svelte` — promote button + state machine

**New prop:**
```typescript
export let activeSegments: Record<string, unknown> = {};
```
Passed from `+page.svelte` as `activeSegments={data.config?.segments ?? {}}`.

**Slug derivation** — must exactly mirror `profileToSlug` in `d1-repo.ts`, including the `.slice(0, 48)` cap. Export `profileToSlug` from `d1-repo.ts` and import it in both `index.ts` (promote handler) and duplicate it verbatim client-side in `SectorsGrid.svelte`:
```typescript
function toSlug(profile: string): string {
  return profile
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48);
}
```
Any divergence here would cause `activeSegments[slug]` to miss already-promoted cards.

**State machine:**
```typescript
let states: Record<string, 'idle' | 'loading' | 'promoted' | 'error'> = {};
```

**On-load active state:** A card whose `toSlug(c.profile)` exists in `activeSegments` renders in the `'promoted'` visual state immediately (button hidden, "Activo" badge shown). This is derived, not stored in `states`.

**`promote(candidate)` function:**
```typescript
async function promote(c: DiscoveryCandidate) {
  const key = toSlug(c.profile ?? c.segment);
  states[key] = 'loading';
  try {
    const res = await fetch('/api/discovery/promote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: c.profile ?? c.segment, keywords: c.raw_signals ?? [], income_est: c.income_est, has_deadline: c.has_deadline ?? false }),
    });
    const body = await res.json() as { ok: boolean; run_id?: string; error?: string };
    if (!res.ok || !body.ok) throw new Error(body.error ?? String(res.status));
    states[key] = 'promoted';
    dispatch('promoted', { run_id: body.run_id });
  } catch (e) {
    states[key] = 'error';
  }
}
```

**Card visual states:**
- `idle`: shows "Promover →" button (violet, small)
- `loading`: button replaced by spinner + "Promoviendo…"
- `promoted` (local or from `activeSegments`): button hidden, green "Activo" badge
- `error`: red "Error — reintentar" link below card

---

## 4. `+page.svelte` — event handler + sync poll

**Existing `forceSync` / `pollSync` pattern is reused.** No new polling logic needed.

When `SectorsGrid` dispatches `on:promoted`:
```svelte
<SectorsGrid
  discovery={data.discovery}
  activeSegments={data.config?.segments ?? {}}
  on:promoted={({ detail }) => {
    syncRunId = detail.run_id;
    syncRunning = true;
    pollSync();
  }}
/>
```

This wires the promote into the existing sync toast system: the "en curso…" dot appears in the header, and when `runFocusedSync` completes the toast shows "Sync completado · N señales nuevas · N analizadas".

`invalidateAll()` is called inside `pollSync` on completion, which refreshes `data.config.segments` — turning the card's local `'promoted'` state into the durable "Activo" badge from `activeSegments`.

---

## Data flow summary

```
User clicks "Promover →"
  → SectorsGrid: states[slug] = 'loading'
  → POST /api/discovery/promote
      → worker: LLM query expansion
      → worker: setConfig adds segment
      → worker: ctx.waitUntil(runFocusedSync)
      → worker: returns { ok, run_id }
  → SectorsGrid: states[slug] = 'promoted', dispatch('promoted', { run_id })
  → +page.svelte: syncRunId = run_id, pollSync()
      (polling /pipeline-status until run_id finished)
  → pollSync complete: invalidateAll()
      → data.config.segments now includes new segment
      → SectorsGrid re-renders: card shows "Activo" from activeSegments
```

---

## Error handling

| Failure point | Behaviour |
|---|---|
| LLM query expansion fails | Fall back to two auto-generated queries; promotion continues |
| Segment already exists | Worker returns 409, card shows "Ya activo" |
| `setConfig` fails | Worker returns 500, card shows "Error — reintentar" |
| `runFocusedSync` crashes | Non-fatal — logged, cron_run marked with error; config save already succeeded |
| Frontend fetch fails (network) | `states[slug] = 'error'`, no config change |

---

## Out of scope

- Bulk promote (multi-select) — can be added later
- Demote / remove segment from config — separate concern
- Auto-promote above a score threshold — the auto-converge variant, deferred
- Edit queries before promoting — user can refine in Config tab after
