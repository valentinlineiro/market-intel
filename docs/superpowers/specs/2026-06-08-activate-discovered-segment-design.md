# Activate Discovered Segment Design

**Goal:** Let the user promote a discovered candidate into an active collector segment with one click, using the LLM to auto-generate GNews search config at activation time.

**Architecture:** New worker endpoint generates GNews config via LLM, writes it to both `collectors.gnews.segments` and `synthesis_segments` in the persisted config. SvelteKit form action calls it. SectorsGrid card shows an "Activar" button that spins while pending and flips to an "Activo" badge on success.

**Tech Stack:** Cloudflare Worker (D1, LLM via existing `LLMChain`), SvelteKit form actions, Svelte 5 legacy mode.

---

## Worker endpoint

`POST /candidates/:segment/activate` — requires `Authorization: Bearer` header.

Steps:
1. Decode `segment` from the URL path (`decodeURIComponent`).
2. Look up the candidate row from `discovery_candidates` table by `profile = segment` (latest entry).
3. If not found, return `{ error: 'Candidate not found' }` with 404.
4. Call LLM with the activation prompt (see below) using `cfg.llm` config.
5. Parse the LLM JSON response into `GnewsSegmentConfig`.
6. Load current config via `getConfig`.
7. Merge new segment into `config.collectors.gnews.segments[segmentKey]` and `config.synthesis_segments[segmentKey]`.
8. Save via `setConfig`.
9. Return `{ success: true, segment: segmentKey, config: generatedConfig }`.

Error responses:
- 404 if candidate not found
- 500 with `{ error: message }` for LLM failure or DB error

`segmentKey` = segment name lowercased, spaces replaced with `_`, non-alphanumeric stripped.

**LLM activation prompt:**
```
Professional segment: "{segment}"
Pain: "{pain_summary}"
Signals: {raw_signals_joined}

Generate a GNews search config as JSON:
{
  "label": "human-readable label in Spanish",
  "queries": ["query1 in Spanish", "query2 in Spanish", "query3 in Spanish"],
  "keywords": ["kw1", "kw2", "kw3", "kw4"],
  "salary_mean": 35000,
  "income_tier": "low|medium|medium_high|high",
  "has_deadline": true|false
}

Return ONLY valid JSON.
```

The generated config is used directly as `GnewsSegmentConfig`. The `SegmentConfig` entry for `synthesis_segments` is derived from it:
```ts
{
  key: segmentKey,
  label: generated.label,
  keywords: generated.keywords,
  income_tier: generated.income_tier,
  has_deadline: generated.has_deadline,
  discovery_score: candidate.discovery_score,
}
```

---

## SvelteKit action

New action `activate` in `+page.server.ts`:

```ts
activate: async ({ request, platform }) => {
  const env = (platform as App.Platform).env;
  const fd = await request.formData();
  const segment = fd.get('segment') as string;
  const res = await workerFetch(
    `${env.WORKER_URL.replace(/\/$/, '')}/candidates/${encodeURIComponent(segment)}/activate`,
    env,
    { method: 'POST', body: '{}' },
  );
  const data = await res.json() as { success?: boolean; error?: string; segment?: string };
  if (!res.ok) return { success: false, error: data.error ?? `Error ${res.status}` };
  return { success: true, segment: data.segment };
},
```

---

## SectorsGrid component

Props change:
```ts
export let discovery: DiscoveryResult;
export let activeSegments: string[] = [];
export let onActivate: () => void;
```

Per-card local state (in script):
```ts
let activating = new Set<string>();
let cardErrors: Record<string, string> = {};
```

`segmentKey(name: string)` helper: lowercased, spaces → `_`, non-alphanumeric stripped — mirrors the worker logic.

Activation function:
```ts
async function activate(candidateName: string) {
  const key = segmentKey(candidateName);
  activating = new Set([...activating, key]);
  cardErrors = { ...cardErrors, [key]: '' };
  try {
    const fd = new FormData();
    fd.set('segment', candidateName);
    const res = await fetch('?/activate', { method: 'POST', body: fd });
    const result = deserialize(await res.text()) as { type: string; data?: { success: boolean; error?: string } };
    if (result.type === 'success' && result.data?.success) {
      onActivate();
    } else {
      cardErrors = { ...cardErrors, [key]: result.data?.error ?? 'Error al activar' };
    }
  } catch (e) {
    cardErrors = { ...cardErrors, [key]: e instanceof Error ? e.message : 'Error al activar' };
  } finally {
    activating = new Set([...activating].filter(k => k !== key));
  }
}
```

Card states (per candidate, derived from `activeSegments`, `activating`, `cardErrors`):
- **Active**: `activeSegments.includes(segmentKey(c.profile))` → green "✓ Activo" chip, no button
- **Loading**: `activating.has(segmentKey(c.profile))` → spinner + "Activando..." button, disabled
- **Error**: `cardErrors[segmentKey(c.profile)]` non-empty → red error text below meta, button reappears
- **Default**: "Activar" button

---

## Page changes (`+page.svelte`)

Pass `activeSegments` and `onActivate` to `SectorsGrid`:
```svelte
<SectorsGrid
  discovery={data.discovery}
  activeSegments={Object.keys(data.config?.synthesis_segments ?? {})}
  onActivate={() => invalidateAll()}
/>
```

No other page changes needed.

---

## Data flow

```
User clicks "Activar" on card
  → SectorsGrid.activate(candidateName)
  → POST ?/activate { segment }
  → +page.server.ts activate action
  → Worker POST /candidates/:segment/activate
    → DB lookup candidate
    → LLM generates GnewsSegmentConfig
    → getConfig → merge → setConfig
  → { success: true, segment: segmentKey }
  → onActivate() → invalidateAll()
  → page reloads with updated config
  → card shows "✓ Activo" badge
```

---

## Error handling

- Candidate not found in DB → 404 → card shows "Segmento no encontrado"
- LLM parse failure → 500 → card shows the error message, button reappears
- Network error → caught in catch block → card shows error, button reappears
- Config save failure → propagated as 500 from worker

---

## What is NOT in scope

- Deactivating a segment (removing from config) — Config tab handles that
- Editing generated queries before saving — Config tab handles that
- Batch activation — future work if needed
