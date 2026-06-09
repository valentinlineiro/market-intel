# WTP Capture + Lead Quality Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a willingness-to-pay question to landing pages and a computed lead quality score to the dashboard.

**Architecture:** A new `price_tier` column is added to `leads`. Score is computed at read time in `handleGetLeads` by combining price tier, recency, and the segment's opportunity score from a parallel DB query. A pure `computeLeadScore` function is the only new application logic. The landing page HTML gains an inline pricing step rendered after email capture.

**Tech Stack:** TypeScript, Cloudflare Workers, D1 (SQLite), SvelteKit (Svelte 5), Vitest

---

### Task 1: Migration + domain types

**Files:**
- Create: `src/main/infrastructure/worker/migrations/0010_add_price_tier_to_leads.sql`
- Modify: `src/main/infrastructure/worker/domain/types.ts`
- Modify: `src/main/infrastructure/worker/application/ports.ts`

- [ ] **Step 1: Create migration**

```sql
-- src/main/infrastructure/worker/migrations/0010_add_price_tier_to_leads.sql
ALTER TABLE leads ADD COLUMN price_tier TEXT NULL;
```

- [ ] **Step 2: Apply migration locally**

```bash
cd src/main/infrastructure/worker
npx wrangler d1 migrations apply market-intel --local
```

Expected: `✅ Applied 1 migration`

- [ ] **Step 3: Update Lead domain type**

In `src/main/infrastructure/worker/domain/types.ts`, replace the `Lead` interface:

```ts
export interface Lead {
  id: string;
  email: string;
  segment: string;
  created_at: string;
  price_tier: string | null;
}
```

- [ ] **Step 4: Add savePriceTier to ILeadRepo**

In `src/main/infrastructure/worker/application/ports.ts`, update `ILeadRepo`:

```ts
export interface ILeadRepo {
  saveLead(email: string, segment: string): Promise<void>;
  savePriceTier(email: string, segment: string, priceTier: string): Promise<void>;
  getLeads(segment?: string): Promise<Lead[]>;
}
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npm run typecheck
```

Expected: errors about `D1Repo` not implementing `savePriceTier` — that's fine, Task 3 fixes it.

- [ ] **Step 6: Commit**

```bash
git add src/main/infrastructure/worker/migrations/0010_add_price_tier_to_leads.sql \
        src/main/infrastructure/worker/domain/types.ts \
        src/main/infrastructure/worker/application/ports.ts
git commit -m "feat: add price_tier to Lead type and ILeadRepo interface"
```

---

### Task 2: Score formula — pure function + unit tests

**Files:**
- Create: `src/main/infrastructure/worker/application/lead-score.ts`
- Create: `src/main/infrastructure/worker/test/unit/lead-score.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/main/infrastructure/worker/test/unit/lead-score.test.ts
import { describe, it, expect } from 'vitest';
import { computeLeadScore } from '../../application/lead-score.js';

const NOW = new Date('2026-06-09T12:00:00Z').getTime();
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

describe('computeLeadScore', () => {
  it('max score: €50+, <7 days, opp≥7 = 10', () => {
    expect(computeLeadScore('50+', daysAgo(1), 8.5, NOW)).toBe(10);
  });

  it('price tier points', () => {
    expect(computeLeadScore('50+',   daysAgo(60), null, NOW)).toBe(4);
    expect(computeLeadScore('30-50', daysAgo(60), null, NOW)).toBe(3);
    expect(computeLeadScore('10-30', daysAgo(60), null, NOW)).toBe(1.5);
    expect(computeLeadScore('0-10',  daysAgo(60), null, NOW)).toBe(0);
  });

  it('null price_tier contributes 0', () => {
    expect(computeLeadScore(null, daysAgo(60), null, NOW)).toBe(0);
  });

  it('recency points: <7 days = 3, 7-30 = 1.5, >30 = 0', () => {
    expect(computeLeadScore(null, daysAgo(3),  null, NOW)).toBe(3);
    expect(computeLeadScore(null, daysAgo(15), null, NOW)).toBe(1.5);
    expect(computeLeadScore(null, daysAgo(45), null, NOW)).toBe(0);
  });

  it('segment points: ≥7 = 3, 5-7 = 1.5, <5 = 0', () => {
    expect(computeLeadScore(null, daysAgo(60), 8.0, NOW)).toBe(3);
    expect(computeLeadScore(null, daysAgo(60), 6.0, NOW)).toBe(1.5);
    expect(computeLeadScore(null, daysAgo(60), 3.0, NOW)).toBe(0);
  });

  it('null opportunity score contributes 0', () => {
    expect(computeLeadScore(null, daysAgo(60), null, NOW)).toBe(0);
  });

  it('unknown price_tier string treated as 0', () => {
    expect(computeLeadScore('banana', daysAgo(60), null, NOW)).toBe(0);
  });

  it('result is rounded to 1 decimal', () => {
    // 1.5 + 1.5 + 1.5 = 4.5
    expect(computeLeadScore('10-30', daysAgo(15), 6.0, NOW)).toBe(4.5);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test -- lead-score
```

Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement the score function**

```ts
// src/main/infrastructure/worker/application/lead-score.ts

const PRICE_POINTS: Record<string, number> = {
  '50+':   4.0,
  '30-50': 3.0,
  '10-30': 1.5,
  '0-10':  0.0,
};

function recencyPoints(capturedAt: string, now: number): number {
  const ageDays = (now - new Date(capturedAt).getTime()) / 86_400_000;
  if (ageDays < 7)  return 3.0;
  if (ageDays < 30) return 1.5;
  return 0.0;
}

function segmentPoints(opportunityScore: number | null): number {
  if (opportunityScore === null) return 0.0;
  if (opportunityScore >= 7)    return 3.0;
  if (opportunityScore >= 5)    return 1.5;
  return 0.0;
}

export function computeLeadScore(
  priceTier: string | null,
  capturedAt: string,
  opportunityScore: number | null,
  now = Date.now(),
): number {
  const price   = priceTier != null ? (PRICE_POINTS[priceTier] ?? 0.0) : 0.0;
  const recency = recencyPoints(capturedAt, now);
  const segment = segmentPoints(opportunityScore);
  return Math.round((price + recency + segment) * 10) / 10;
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm test -- lead-score
```

Expected: 8 tests pass

- [ ] **Step 5: Run full suite**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/main/infrastructure/worker/application/lead-score.ts \
        src/main/infrastructure/worker/test/unit/lead-score.test.ts
git commit -m "feat: add computeLeadScore pure function with unit tests"
```

---

### Task 3: D1Repo — rowToLead + savePriceTier + getLeads

**Files:**
- Modify: `src/main/infrastructure/worker/infrastructure/db/d1-repo.ts`

- [ ] **Step 1: Update rowToLead to include price_tier**

Replace the `rowToLead` function (around line 79):

```ts
function rowToLead(r: Record<string, unknown>): Lead {
  return {
    id:         String(r['id'] as number),
    email:      r['email'] as string,
    segment:    r['segment'] as string,
    created_at: (r['captured_at'] as string) ?? (r['created_at'] as string),
    price_tier: (r['price_tier'] as string | null) ?? null,
  };
}
```

- [ ] **Step 2: Update getLeads queries to select price_tier**

Replace both queries in `getLeads` (around line 254):

```ts
async getLeads(segment?: string): Promise<Lead[]> {
  const { results } = segment
    ? await this.db
        .prepare(
          'SELECT id, email, segment, captured_at, price_tier FROM leads WHERE segment = ? ORDER BY captured_at DESC LIMIT 200',
        )
        .bind(segment)
        .all<Record<string, unknown>>()
    : await this.db
        .prepare(
          'SELECT id, email, segment, captured_at, price_tier FROM leads ORDER BY captured_at DESC LIMIT 200',
        )
        .all<Record<string, unknown>>();
  return (results ?? []).map(rowToLead);
}
```

- [ ] **Step 3: Add savePriceTier method**

Add this method directly after `saveLead` (around line 252):

```ts
async savePriceTier(email: string, segment: string, priceTier: string): Promise<void> {
  await this.db
    .prepare('UPDATE leads SET price_tier = ? WHERE email = ? AND segment = ?')
    .bind(priceTier, email, segment)
    .run();
}
```

- [ ] **Step 4: Run tests**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/main/infrastructure/worker/infrastructure/db/d1-repo.ts
git commit -m "feat: add price_tier to rowToLead/getLeads, add savePriceTier"
```

---

### Task 4: Integration test for savePriceTier

**Files:**
- Modify: `src/main/infrastructure/worker/test/integration/d1-repo.test.ts`

- [ ] **Step 1: Add integration test**

Open `src/main/infrastructure/worker/test/integration/d1-repo.test.ts` and add the following test inside the existing `describe` block:

```ts
it('savePriceTier updates price_tier on existing lead', async () => {
  const { DB } = env;
  const repo = new D1Repo(DB);

  await repo.saveLead('price@test.es', 'dentista');
  const before = await repo.getLeads('dentista');
  const lead = before.find(l => l.email === 'price@test.es');
  expect(lead).toBeDefined();
  expect(lead!.price_tier).toBeNull();

  await repo.savePriceTier('price@test.es', 'dentista', '30-50');
  const after = await repo.getLeads('dentista');
  const updated = after.find(l => l.email === 'price@test.es');
  expect(updated!.price_tier).toBe('30-50');
});

it('savePriceTier on unknown email is a no-op', async () => {
  const { DB } = env;
  const repo = new D1Repo(DB);
  // Should not throw
  await expect(
    repo.savePriceTier('nobody@test.es', 'dentista', '50+')
  ).resolves.toBeUndefined();
});
```

- [ ] **Step 2: Run integration tests**

```bash
npm run test:integration
```

Expected: new tests pass

- [ ] **Step 3: Commit**

```bash
git add src/main/infrastructure/worker/test/integration/d1-repo.test.ts
git commit -m "test: integration tests for savePriceTier"
```

---

### Task 5: Worker routes — POST /public/signup/price + updated handleGetLeads

**Files:**
- Modify: `src/main/infrastructure/worker/index.ts`

- [ ] **Step 1: Add import for computeLeadScore**

At the top of `index.ts`, add to the imports:

```ts
import { computeLeadScore } from './application/lead-score.js';
```

- [ ] **Step 2: Expand the public POST check to include the new route**

Replace line 106:

```ts
const isPublicPost = method === 'POST' && (
  path === '/public/signup' ||
  path === '/public/signup/price'
);
```

- [ ] **Step 3: Add handler for POST /public/signup/price**

Inside the `if (isPublicGet || isPublicPost)` block, add after the existing signup handler (after line 131):

```ts
if (path === '/public/signup/price' && method === 'POST') {
  const body = await request.json() as { email?: string; segment?: string; price_tier?: string };
  const validTiers = ['0-10', '10-30', '30-50', '50+'];
  if (!body.email || !body.segment || !body.price_tier)
    return json({ error: 'email, segment and price_tier required' }, 400);
  if (!validTiers.includes(body.price_tier))
    return json({ error: 'invalid price_tier' }, 400);
  const d1repo = new D1Repo(env.DB);
  await d1repo.savePriceTier(body.email, body.segment, body.price_tier);
  return json({ ok: true });
}
```

- [ ] **Step 4: Update handleGetLeads to compute lead_score**

Replace the entire `handleGetLeads` function (around line 592):

```ts
async function handleGetLeads(d1repo: D1Repo, params: URLSearchParams): Promise<Response> {
  const segment = params.get('segment') ?? undefined;
  const [leads, opportunities] = await Promise.all([
    d1repo.getLeads(segment),
    d1repo.getAll(),
  ]);
  const oppScores = new Map<string, number>(
    opportunities.map(o => [o.segment, o.score]),
  );
  const bySegment: Record<string, Array<{
    email: string;
    captured_at: string;
    price_tier: string | null;
    lead_score: number;
  }>> = {};
  for (const r of leads) {
    if (!bySegment[r.segment]) bySegment[r.segment] = [];
    bySegment[r.segment].push({
      email:       r.email,
      captured_at: r.created_at,
      price_tier:  r.price_tier,
      lead_score:  computeLeadScore(r.price_tier, r.created_at, oppScores.get(r.segment) ?? null),
    });
  }
  for (const seg of Object.keys(bySegment)) {
    bySegment[seg].sort((a, b) => b.lead_score - a.lead_score);
  }
  return json({ total: leads.length, by_segment: bySegment });
}
```

- [ ] **Step 5: Run tests**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/main/infrastructure/worker/index.ts
git commit -m "feat: POST /public/signup/price route + lead_score in GET /public/leads"
```

---

### Task 6: Landing page HTML — inline pricing question

**Files:**
- Modify: `src/main/infrastructure/worker/application/synthesize.ts`

- [ ] **Step 1: Update buildHtml to add pricing step**

Replace the entire `buildHtml` function:

```ts
export function buildHtml(
  segment: string,
  copy: SynthesisCopy,
): string {
  const { headline, subheadline, cta = 'Quiero acceso prioritario', pain_points = [] } = copy;

  const painPointsHtml = pain_points
    .map(p => `<div class="benefit"><p>${escHtml(p)}</p></div>`)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escHtml(headline)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #020817; color: #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .container { max-width: 680px; padding: 48px 24px; text-align: center; }
    h1 { font-size: clamp(1.8rem, 4vw, 2.8rem); font-weight: 800; color: #f1f5f9; line-height: 1.2; margin-bottom: 20px; }
    .subtitle { font-size: 1.1rem; color: #94a3b8; margin-bottom: 40px; line-height: 1.6; }
    .benefits { display: grid; gap: 20px; margin-bottom: 40px; text-align: left; }
    .benefit { background: #0f172a; border: 1px solid #1e293b; border-radius: 12px; padding: 20px; }
    .benefit p { font-size: 0.875rem; color: #64748b; line-height: 1.5; }
    form { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; }
    input[type=email] { flex: 1; min-width: 220px; padding: 14px 18px; background: #0f172a; border: 1px solid #334155; border-radius: 8px; color: #f1f5f9; font-size: 1rem; }
    button { padding: 14px 28px; background: #3b82f6; color: white; border: none; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; white-space: nowrap; }
    button:hover { background: #2563eb; }
    .price-step { display: none; margin-top: 24px; }
    .price-step p { color: #94a3b8; margin-bottom: 16px; font-size: 0.95rem; }
    .price-step strong { color: #f1f5f9; }
    .tiers { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; }
    .tier { padding: 10px 20px; background: #0f172a; border: 1px solid #334155; border-radius: 8px; color: #94a3b8; font-size: 0.9rem; cursor: pointer; transition: border-color .15s, color .15s; }
    .tier:hover { border-color: #3b82f6; color: #f1f5f9; }
    .confirmed { display: none; color: #22c55e; margin-top: 20px; font-weight: 600; font-size: 1rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>${escHtml(headline)}</h1>
    <p class="subtitle">${escHtml(subheadline)}</p>
    <div class="benefits">${painPointsHtml}</div>
    <form id="form">
      <input type="hidden" id="segment" value="${escHtml(segment)}">
      <input type="email" id="email" placeholder="tu@email.com" required>
      <button type="submit">${escHtml(cta)}</button>
    </form>
    <div class="price-step" id="price-step">
      <strong>¡Apuntado!</strong>
      <p>Una última pregunta: ¿cuánto pagarías al mes por una solución?</p>
      <div class="tiers">
        <button class="tier" data-tier="0-10">€0–10</button>
        <button class="tier" data-tier="10-30">€10–30</button>
        <button class="tier" data-tier="30-50">€30–50</button>
        <button class="tier" data-tier="50+">€50+</button>
      </div>
    </div>
    <p class="confirmed" id="confirmed">✓ Gracias. Te avisamos primero.</p>
  </div>
  <script>
    var seg = document.getElementById('segment').value;
    var email = '';

    document.getElementById('form').addEventListener('submit', async function(e) {
      e.preventDefault();
      email = document.getElementById('email').value;
      await fetch('/public/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, segment: seg }),
      });
      e.target.style.display = 'none';
      document.getElementById('price-step').style.display = 'block';
    });

    document.querySelectorAll('.tier').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        var tier = this.getAttribute('data-tier');
        await fetch('/public/signup/price', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email, segment: seg, price_tier: tier }),
        });
        document.getElementById('price-step').style.display = 'none';
        document.getElementById('confirmed').style.display = 'block';
      });
    });
  </script>
</body>
</html>`;
}
```

- [ ] **Step 2: Run tests**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 3: Commit**

```bash
git add src/main/infrastructure/worker/application/synthesize.ts
git commit -m "feat: inline pricing question on landing pages after email signup"
```

---

### Task 7: Dashboard — types + LeadsTable with score column

**Files:**
- Modify: `src/main/infrastructure/pages/src/lib/types.ts`
- Modify: `src/main/infrastructure/pages/src/routes/dashboard/+page.server.ts`
- Modify: `src/main/infrastructure/pages/src/lib/components/LeadsTable.svelte`

- [ ] **Step 1: Update Lead type in pages**

In `src/main/infrastructure/pages/src/lib/types.ts`, replace the `Lead` interface:

```ts
export interface Lead {
  email: string;
  segment: string;
  captured_at: string;
  price_tier: string | null;
  lead_score: number;
}
```

- [ ] **Step 2: Update safeJson type in +page.server.ts**

In `src/main/infrastructure/pages/src/routes/dashboard/+page.server.ts`, update the `leadsRes` safeJson call:

```ts
safeJson<{ total: number; by_segment: Record<string, { email: string; captured_at: string; price_tier: string | null; lead_score: number }[]> }>(leadsRes, { total: 0, by_segment: {} }),
```

- [ ] **Step 3: Update LeadsTable.svelte**

Replace the entire contents of `src/main/infrastructure/pages/src/lib/components/LeadsTable.svelte`:

```svelte
<script lang="ts">
  import { cleanSegment } from '$lib/utils.js';

  export let bySegment: Record<string, { email: string; captured_at: string; price_tier: string | null; lead_score: number }[]>;
  export let total: number;

  let openSegment: string | null = null;

  $: segments = Object.entries(bySegment ?? {}).sort((a, b) => b[1].length - a[1].length);

  function scoreColor(s: number): string {
    if (s >= 7) return 'var(--accent)';
    if (s >= 4) return 'var(--amber)';
    return 'var(--text-dim)';
  }

  function tierLabel(tier: string | null): string {
    if (!tier) return '—';
    const map: Record<string, string> = { '0-10': '€0–10', '10-30': '€10–30', '30-50': '€30–50', '50+': '€50+' };
    return map[tier] ?? tier;
  }
</script>

{#if !total}
  <p class="empty">Sin leads todavía.</p>
{:else}
  <div class="list">
    {#each segments as [seg, leads]}
      <div class="group">
        <button class="group-header" on:click={() => openSegment = openSegment === seg ? null : seg}>
          <span class="seg-name">{cleanSegment(seg)}</span>
          <span class="count">{leads.length} leads</span>
          <span class="chevron" class:rotated={openSegment === seg}>›</span>
        </button>
        {#if openSegment === seg}
          <div class="leads">
            <div class="lead-row header-row">
              <span class="email">Email</span>
              <span class="tier-col">Precio</span>
              <span class="score-col">Calidad</span>
              <span class="date">Fecha</span>
            </div>
            {#each leads as lead}
              <div class="lead-row">
                <span class="email">{lead.email}</span>
                <span class="tier-col">{tierLabel(lead.price_tier)}</span>
                <div class="score-col">
                  <div class="bar-wrap">
                    <div class="bar" style="width:{lead.lead_score * 10}%; background:{scoreColor(lead.lead_score)}"></div>
                  </div>
                  <span class="score-num" style="color:{scoreColor(lead.lead_score)}">{lead.lead_score.toFixed(1)}</span>
                </div>
                <span class="date">{new Date(lead.captured_at).toLocaleDateString('es')}</span>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .list         { display: flex; flex-direction: column; gap: 4px; }
  .group        { background: var(--bg-card); border-radius: 8px; overflow: hidden; border: 1px solid var(--border-sub); }
  .group-header { display: flex; align-items: center; gap: 8px; width: 100%; padding: 10px 12px; background: none; border: none; cursor: pointer; text-align: left; }
  .group-header:hover { background: var(--bg-input); }
  .seg-name     { flex: 1; font-size: 0.85rem; font-weight: 600; color: var(--text); }
  .count        { font-size: 0.75rem; color: var(--accent); font-weight: 600; }
  .chevron      { color: var(--text-dim); font-size: 1rem; transition: transform 0.15s; display: inline-block; }
  .chevron.rotated { transform: rotate(90deg); }
  .leads        { border-top: 1px solid var(--border-sub); }
  .lead-row     { display: grid; grid-template-columns: 1fr 70px 100px 70px; align-items: center; gap: 8px; padding: 7px 12px; border-bottom: 1px solid var(--border-sub); }
  .lead-row:last-child { border-bottom: none; }
  .header-row   { background: var(--bg-input); }
  .header-row span { font-size: 0.68rem; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; }
  .email        { font-size: 0.78rem; color: var(--text-sub); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tier-col     { font-size: 0.72rem; color: var(--text-muted); }
  .score-col    { display: flex; align-items: center; gap: 6px; }
  .bar-wrap     { flex: 1; background: var(--bg-input); border-radius: 9999px; height: 4px; overflow: hidden; }
  .bar          { height: 100%; border-radius: 9999px; transition: width 0.3s; }
  .score-num    { font-size: 0.68rem; font-weight: 700; min-width: 24px; text-align: right; }
  .date         { font-size: 0.72rem; color: var(--text-muted); }
  .empty        { color: var(--text-muted); font-size: 0.85rem; padding: 24px 0; }
</style>
```

- [ ] **Step 4: Run pages typecheck**

```bash
cd src/main/infrastructure/pages && npm run typecheck
```

Expected: no errors

- [ ] **Step 5: Run full worker test suite**

```bash
cd /home/valentin/code/market-intel && npm test
```

Expected: all tests pass

- [ ] **Step 6: Commit and push**

```bash
git add src/main/infrastructure/pages/src/lib/types.ts \
        src/main/infrastructure/pages/src/routes/dashboard/+page.server.ts \
        src/main/infrastructure/pages/src/lib/components/LeadsTable.svelte
git commit -m "feat: LeadsTable with price_tier and lead_score progress bar"
git push
```
