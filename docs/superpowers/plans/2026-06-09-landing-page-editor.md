# Landing Page Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the raw HTML textarea with a structured field editor (headline, subheadline, pain points, CTA) and add multi-page support per segment.

**Architecture:** A new `page_slug` column and composite PK on `landing_pages` enables multiple pages per segment. A `copy` JSON column stores structured fields so the editor can reopen with pre-populated fields. The Worker gains `GET/DELETE /pages/:segment` and `POST /render` routes; the dashboard modal is rewritten as a two-view component (campaign list → page editor).

**Tech Stack:** TypeScript, Cloudflare Workers, D1 (SQLite), SvelteKit (Svelte 5), Vitest

---

### Task 1: Migration + D1Repo updates

**Files:**
- Create: `src/main/infrastructure/worker/migrations/0011_landing_pages_multi.sql`
- Modify: `src/main/infrastructure/worker/infrastructure/db/d1-repo.ts`
- Modify: `src/main/infrastructure/worker/test/integration/d1-repo.test.ts` (schema only)

- [ ] **Step 1: Create migration file**

```sql
-- src/main/infrastructure/worker/migrations/0011_landing_pages_multi.sql
CREATE TABLE landing_pages_new (
  segment     TEXT NOT NULL,
  page_slug   TEXT NOT NULL DEFAULT 'index',
  html        TEXT NOT NULL,
  copy        TEXT,
  title       TEXT,
  deployed_at TEXT NOT NULL,
  PRIMARY KEY (segment, page_slug)
);
INSERT INTO landing_pages_new (segment, page_slug, html, title, deployed_at)
  SELECT segment, 'index', html, title, deployed_at FROM landing_pages;
DROP TABLE landing_pages;
ALTER TABLE landing_pages_new RENAME TO landing_pages;
```

- [ ] **Step 2: Update the integration test DDL**

In `src/main/infrastructure/worker/test/integration/d1-repo.test.ts`, replace the `landing_pages` DDL line inside `applyMigrations`:

```ts
`CREATE TABLE IF NOT EXISTS landing_pages (segment TEXT NOT NULL, page_slug TEXT NOT NULL DEFAULT 'index', html TEXT NOT NULL, copy TEXT, title TEXT, deployed_at TEXT NOT NULL, PRIMARY KEY (segment, page_slug))`,
```

- [ ] **Step 3: Update `saveLanding` in d1-repo.ts**

Replace the existing `saveLanding` method (around line 456):

```ts
async saveLanding(
  segment: string,
  pageSlug: string,
  html: string,
  copy: { headline: string; subheadline: string; pain_points: string[]; cta: string } | null,
  title: string,
): Promise<void> {
  const now = new Date().toISOString();
  await this.db
    .prepare(`
      INSERT INTO landing_pages (segment, page_slug, html, copy, title, deployed_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(segment, page_slug) DO UPDATE SET
        html=excluded.html, copy=excluded.copy, title=excluded.title, deployed_at=excluded.deployed_at
    `)
    .bind(segment, pageSlug, html, copy ? JSON.stringify(copy) : null, title, now)
    .run();
}
```

- [ ] **Step 4: Update `getLandingHtml` in d1-repo.ts**

Replace the existing `getLandingHtml` method (around line 448):

```ts
async getLandingHtml(segment: string, pageSlug = 'index'): Promise<string | null> {
  const row = await this.db
    .prepare('SELECT html FROM landing_pages WHERE segment = ? AND page_slug = ?')
    .bind(segment, pageSlug)
    .first<Record<string, unknown>>();
  return row ? (row['html'] as string) : null;
}
```

- [ ] **Step 5: Add `listLandingPages` to d1-repo.ts**

Add after `getLandingHtml`:

```ts
async listLandingPages(segment: string): Promise<Array<{
  page_slug: string;
  title: string | null;
  deployed_at: string;
  copy: { headline: string; subheadline: string; pain_points: string[]; cta: string } | null;
}>> {
  const { results } = await this.db
    .prepare('SELECT page_slug, title, deployed_at, copy FROM landing_pages WHERE segment = ? ORDER BY deployed_at DESC')
    .bind(segment)
    .all<Record<string, unknown>>();
  return (results ?? []).map(r => ({
    page_slug:   r['page_slug'] as string,
    title:       (r['title'] as string | null) ?? null,
    deployed_at: r['deployed_at'] as string,
    copy:        r['copy'] ? JSON.parse(r['copy'] as string) : null,
  }));
}
```

- [ ] **Step 6: Add `deleteLandingPage` to d1-repo.ts**

Add after `listLandingPages`:

```ts
async deleteLandingPage(segment: string, pageSlug: string): Promise<void> {
  await this.db
    .prepare('DELETE FROM landing_pages WHERE segment = ? AND page_slug = ?')
    .bind(segment, pageSlug)
    .run();
}
```

- [ ] **Step 7: Run tests**

```bash
npm run test:integration
```

Expected: all integration tests pass (existing `saveLanding` call in the test will fail — Task 2 fixes it).

- [ ] **Step 8: Commit**

```bash
git add src/main/infrastructure/worker/migrations/0011_landing_pages_multi.sql \
        src/main/infrastructure/worker/infrastructure/db/d1-repo.ts \
        src/main/infrastructure/worker/test/integration/d1-repo.test.ts
git commit -m "feat: landing_pages composite PK + copy column; add listLandingPages/deleteLandingPage"
```

---

### Task 2: Integration tests for new D1Repo methods

**Files:**
- Modify: `src/main/infrastructure/worker/test/integration/d1-repo.test.ts`

- [ ] **Step 1: Update the existing `saveLanding` test call**

Find the existing test at `describe('Extra methods')` → `saveLanding then getLandingHtml returns html` and update it to pass the new signature:

```ts
it('saveLanding then getLandingHtml returns html', async () => {
  await repo.saveLanding('seg1', 'index', '<h1>test</h1>', null, 'Test');
  const html = await repo.getLandingHtml('seg1');
  expect(html).toBe('<h1>test</h1>');
});

it('getLandingHtml returns null for unknown segment', async () => {
  const html = await repo.getLandingHtml('unknown-seg');
  expect(html).toBeNull();
});
```

- [ ] **Step 2: Add new integration tests**

Add inside the `describe('Extra methods')` block after the existing landing tests:

```ts
it('getLandingHtml with explicit slug returns correct page', async () => {
  await repo.saveLanding('seg2', 'precios', '<h1>precios</h1>', null, 'Precios');
  const html = await repo.getLandingHtml('seg2', 'precios');
  expect(html).toBe('<h1>precios</h1>');
  const missing = await repo.getLandingHtml('seg2', 'index');
  expect(missing).toBeNull();
});

it('listLandingPages returns all pages for a segment', async () => {
  const copy = { headline: 'H', subheadline: 'S', pain_points: ['p1'], cta: 'CTA' };
  await repo.saveLanding('seg3', 'index', '<h1>index</h1>', copy, 'Index');
  await repo.saveLanding('seg3', 'about', '<h1>about</h1>', null, 'About');
  const pages = await repo.listLandingPages('seg3');
  expect(pages).toHaveLength(2);
  const index = pages.find(p => p.page_slug === 'index');
  expect(index?.copy?.headline).toBe('H');
  expect(index?.copy?.pain_points).toEqual(['p1']);
  const about = pages.find(p => p.page_slug === 'about');
  expect(about?.copy).toBeNull();
});

it('listLandingPages returns empty array for unknown segment', async () => {
  const pages = await repo.listLandingPages('no-such-segment');
  expect(pages).toHaveLength(0);
});

it('deleteLandingPage removes the row, others unaffected', async () => {
  await repo.saveLanding('seg4', 'index', '<h1>i</h1>', null, 'i');
  await repo.saveLanding('seg4', 'about', '<h1>a</h1>', null, 'a');
  await repo.deleteLandingPage('seg4', 'index');
  const pages = await repo.listLandingPages('seg4');
  expect(pages).toHaveLength(1);
  expect(pages[0]!.page_slug).toBe('about');
});

it('deleteLandingPage on non-existent row is a no-op', async () => {
  await expect(
    repo.deleteLandingPage('no-seg', 'no-slug')
  ).resolves.toBeUndefined();
});

it('saveLanding upserts on duplicate segment+slug', async () => {
  await repo.saveLanding('seg5', 'index', '<h1>v1</h1>', null, 'v1');
  await repo.saveLanding('seg5', 'index', '<h1>v2</h1>', null, 'v2');
  const html = await repo.getLandingHtml('seg5', 'index');
  expect(html).toBe('<h1>v2</h1>');
});
```

- [ ] **Step 3: Run integration tests**

```bash
npm run test:integration
```

Expected: all tests pass including the new ones.

- [ ] **Step 4: Commit**

```bash
git add src/main/infrastructure/worker/test/integration/d1-repo.test.ts
git commit -m "test: integration tests for multi-page landing repo methods"
```

---

### Task 3: Worker routes

**Files:**
- Modify: `src/main/infrastructure/worker/index.ts`

- [ ] **Step 1: Update the `/public/landings/` route to support slug**

Replace (around line 122):

```ts
if (path.startsWith('/public/landings/')) {
  const rest = path.slice('/public/landings/'.length);
  const slashIdx = rest.indexOf('/');
  const segment  = slashIdx === -1 ? rest : rest.slice(0, slashIdx);
  const pageSlug = slashIdx === -1 ? 'index' : rest.slice(slashIdx + 1);
  if (!segment) return new Response('Not Found', { status: 404 });
  const html = await d1repo.getLandingHtml(segment, pageSlug);
  if (!html) return new Response('Not Found', { status: 404 });
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html' } });
}
```

- [ ] **Step 2: Update the `/deploy` route**

Replace the existing `/deploy` block (around line 243):

```ts
if (path === '/deploy' && method === 'POST') {
  const body = await request.json() as {
    segment?: string;
    page_slug?: string;
    html?: string;
    copy?: { headline?: string; subheadline?: string; pain_points?: string[]; cta?: string };
  };
  const { segment, page_slug = 'index' } = body;
  if (!segment) return json({ error: 'segment required' }, 400);
  const copy = body.copy ?? null;
  const html = body.html ?? (copy ? buildHtml(segment, copy as Parameters<typeof buildHtml>[1]) : null);
  if (!html) return json({ error: 'html or copy required' }, 400);
  const now   = new Date().toISOString();
  const title = copy?.headline ?? segment;
  const d1repo = new D1Repo(env.DB);
  await d1repo.saveLanding(segment, page_slug, html, copy as Parameters<typeof d1repo.saveLanding>[3], title);
  const landingUrl = page_slug === 'index'
    ? `https://market-intel.pages.dev/landings/${segment}`
    : `https://market-intel.pages.dev/landings/${segment}/${page_slug}`;
  await d1repo.updateOpportunityLanding(segment, landingUrl, 'testing', now);
  return json({ url: landingUrl });
}
```

- [ ] **Step 3: Add `POST /render` in the authenticated section**

Inside the authenticated `try` block, add after the `/deploy` block:

```ts
if (path === '/render' && method === 'POST') {
  const { segment, copy } = await request.json() as {
    segment?: string;
    copy?: Parameters<typeof buildHtml>[1];
  };
  if (!segment || !copy) return json({ error: 'segment and copy required' }, 400);
  return json({ html: buildHtml(segment, copy) });
}
```

- [ ] **Step 4: Add `GET /pages/:segment` in the authenticated section**

```ts
const pagesMatch = path.match(/^\/pages\/([^/]+)$/);
if (pagesMatch && method === 'GET') {
  const segment = decodeURIComponent(pagesMatch[1]);
  const d1repo = new D1Repo(env.DB);
  const pages = await d1repo.listLandingPages(segment);
  return json({ pages });
}
```

- [ ] **Step 5: Add `DELETE /pages/:segment/:slug` in the authenticated section**

```ts
const pageDeleteMatch = path.match(/^\/pages\/([^/]+)\/([^/]+)$/);
if (pageDeleteMatch && method === 'DELETE') {
  const segment  = decodeURIComponent(pageDeleteMatch[1]);
  const pageSlug = decodeURIComponent(pageDeleteMatch[2]);
  const d1repo = new D1Repo(env.DB);
  await d1repo.deleteLandingPage(segment, pageSlug);
  return json({ ok: true });
}
```

- [ ] **Step 6: Run full test suite**

```bash
npm test
```

Expected: all 137+ tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/main/infrastructure/worker/index.ts
git commit -m "feat: multi-slug landings route; POST /render; GET+DELETE /pages/:segment"
```

---

### Task 4: Pages server actions

**Files:**
- Modify: `src/main/infrastructure/pages/src/routes/dashboard/+page.server.ts`

- [ ] **Step 1: Update the `deploy` action**

Replace the existing `deploy` action:

```ts
deploy: async ({ request, platform }) => {
  const env      = (platform as App.Platform).env;
  const formData = await request.formData();
  const segment  = formData.get('segment') as string;
  const pageSlug = (formData.get('page_slug') as string | null) ?? 'index';
  const rawHtml  = formData.get('html') as string | null;
  const rawCopy  = formData.get('copy') as string | null;
  const body: Record<string, unknown> = { segment, page_slug: pageSlug };
  if (rawHtml)       body.html = rawHtml;
  if (rawCopy)       body.copy = JSON.parse(rawCopy);
  const res = await workerFetch(`${env.WORKER_URL.replace(/\/$/, '')}/deploy`, env, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) return { success: false, error: `${res.status}` };
  const data = await res.json() as { url: string };
  return { success: true, url: data.url };
},
```

- [ ] **Step 2: Add the `deletePage` action**

Add after the `deploy` action:

```ts
deletePage: async ({ request, platform }) => {
  const env      = (platform as App.Platform).env;
  const formData = await request.formData();
  const segment  = formData.get('segment') as string;
  const pageSlug = formData.get('page_slug') as string;
  await workerFetch(
    `${env.WORKER_URL.replace(/\/$/, '')}/pages/${encodeURIComponent(segment)}/${encodeURIComponent(pageSlug)}`,
    env,
    { method: 'DELETE' },
  );
  return { success: true };
},
```

- [ ] **Step 3: Run pages typecheck**

```bash
cd src/main/infrastructure/pages && npm run typecheck
```

Expected: no new errors (pre-existing 3 `process` errors in e2e tests are OK).

- [ ] **Step 4: Commit**

```bash
git add src/main/infrastructure/pages/src/routes/dashboard/+page.server.ts
git commit -m "feat: deploy action supports page_slug+copy; add deletePage action"
```

---

### Task 5: DeployModal rewrite

**Files:**
- Modify: `src/main/infrastructure/pages/src/lib/components/DeployModal.svelte`

- [ ] **Step 1: Replace the entire component**

```svelte
<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { synthesizeCopy } from '$lib/api.js';
  import type { LandingCopy } from '$lib/types.js';

  export let segment: string;

  const dispatch = createEventDispatcher<{ close: void }>();

  interface PageSummary {
    page_slug: string;
    title: string | null;
    deployed_at: string;
    copy: LandingCopy | null;
  }

  // ── Campaign view ─────────────────────────────────────────────────────────
  let view: 'campaign' | 'editor' = 'campaign';
  let pages: PageSummary[] = [];
  let loadingPages = true;
  let campaignError = '';

  async function loadPages() {
    loadingPages = true;
    campaignError = '';
    try {
      const res = await fetch(`/api/pages/${encodeURIComponent(segment)}`);
      const data = await res.json() as { pages: PageSummary[] };
      pages = data.pages ?? [];
    } catch {
      campaignError = 'Error al cargar páginas.';
    } finally {
      loadingPages = false;
    }
  }

  loadPages();

  // ── Page editor ───────────────────────────────────────────────────────────
  let pageSlug    = 'index';
  let headline    = '';
  let subheadline = '';
  let painPoints: string[] = [''];
  let cta         = '';
  let previewHtml = '';
  let advancedMode    = false;
  let advancedHtml    = '';
  let htmlModified    = false;
  let status      = '';
  let deploying   = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function openNewPage() {
    pageSlug = 'nueva-pagina';
    headline = ''; subheadline = ''; painPoints = ['']; cta = '';
    previewHtml = ''; advancedMode = false; advancedHtml = ''; htmlModified = false;
    status = 'Generando copy con LLM...';
    view = 'editor';
    fetchSynthesize();
  }

  async function openEditPage(p: PageSummary) {
    pageSlug = p.page_slug;
    advancedMode = false; advancedHtml = ''; htmlModified = false;
    view = 'editor';
    if (p.copy) {
      headline    = p.copy.headline;
      subheadline = p.copy.subheadline;
      painPoints  = p.copy.pain_points.length ? [...p.copy.pain_points] : [''];
      cta         = p.copy.cta;
      status      = 'Edita la página y despliégala.';
      schedulePreview();
    } else {
      headline = ''; subheadline = ''; painPoints = ['']; cta = '';
      status = 'Generando copy con LLM...';
      fetchSynthesize();
    }
  }

  async function fetchSynthesize() {
    try {
      const result = await synthesizeCopy(segment);
      headline    = result.copy.headline;
      subheadline = result.copy.subheadline;
      painPoints  = result.copy.pain_points.length ? result.copy.pain_points : [''];
      cta         = result.copy.cta;
      previewHtml = result.html;
      status      = 'Edita la página y despliégala.';
    } catch {
      status = 'LLM no disponible — escribe el copy manualmente.';
    }
  }

  function schedulePreview() {
    if (advancedMode) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(fetchPreview, 300);
  }

  async function fetchPreview() {
    const copy: LandingCopy = {
      headline, subheadline,
      pain_points: painPoints.filter(Boolean),
      cta,
    };
    try {
      const res = await fetch('/api/render', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ segment, copy }),
      });
      const data = await res.json() as { html: string };
      previewHtml = data.html;
    } catch { /* keep old preview */ }
  }

  function addPainPoint() { painPoints = [...painPoints, '']; }
  function removePainPoint(i: number) {
    painPoints = painPoints.filter((_, j) => j !== i);
    if (!painPoints.length) painPoints = [''];
    schedulePreview();
  }
  function updatePainPoint(i: number, val: string) {
    painPoints = painPoints.map((p, j) => j === i ? val : p);
    schedulePreview();
  }

  function enableAdvanced() {
    advancedHtml = previewHtml;
    advancedMode = true;
  }

  async function deploy() {
    deploying = true;
    status = 'Desplegando...';
    const copy: LandingCopy = {
      headline, subheadline,
      pain_points: painPoints.filter(Boolean),
      cta,
    };
    const finalHtml = (advancedMode && htmlModified) ? advancedHtml : previewHtml;
    try {
      const fd = new FormData();
      fd.set('segment',   segment);
      fd.set('page_slug', pageSlug);
      fd.set('html',      finalHtml);
      if (!advancedMode || !htmlModified) fd.set('copy', JSON.stringify(copy));
      const res  = await fetch('?/deploy', { method: 'POST', body: fd });
      const data = await res.json() as { success: boolean; url?: string; error?: string };
      if (data.success) {
        status = `✓ Desplegado: ${data.url ?? ''}`;
        await loadPages();
        setTimeout(() => { view = 'campaign'; status = ''; deploying = false; }, 1500);
      } else {
        status = `Error: ${data.error ?? 'unknown'}`;
        deploying = false;
      }
    } catch (e) {
      status = `Error: ${(e as Error).message}`;
      deploying = false;
    }
  }

  async function removePage(slug: string) {
    const fd = new FormData();
    fd.set('segment',   segment);
    fd.set('page_slug', slug);
    await fetch('?/deletePage', { method: 'POST', body: fd });
    pages = pages.filter(p => p.page_slug !== slug);
  }
</script>

<div class="overlay" role="dialog" aria-modal="true">
  <div class="modal">

    {#if view === 'campaign'}
      <h3>Páginas · <span>{segment}</span></h3>

      {#if loadingPages}
        <p class="status">Cargando...</p>
      {:else if campaignError}
        <p class="status">{campaignError}</p>
      {:else if pages.length === 0}
        <p class="empty">Sin páginas — crea la primera.</p>
      {:else}
        <div class="page-list">
          {#each pages as p}
            <div class="page-row">
              <div class="page-info">
                <span class="slug">/{p.page_slug}</span>
                <span class="page-title">{p.title ?? ''}</span>
                <span class="deployed-at">{new Date(p.deployed_at).toLocaleDateString('es')}</span>
              </div>
              <div class="page-btns">
                <button class="btn-sm" on:click={() => openEditPage(p)}>Editar</button>
                <button class="btn-sm btn-danger" on:click={() => removePage(p.page_slug)}>Eliminar</button>
              </div>
            </div>
          {/each}
        </div>
      {/if}

      <div class="actions">
        <button class="btn-primary" on:click={openNewPage}>+ Nueva página</button>
        <button class="btn-secondary" on:click={() => dispatch('close')}>Cerrar</button>
      </div>

    {:else}
      <h3>
        <button class="back-btn" on:click={() => { view = 'campaign'; }}>←</button>
        Editar · <span>{segment} / {pageSlug}</span>
      </h3>

      <div class="editor-layout">
        <div class="fields-pane">
          {#if !advancedMode}
            <label class="field-label">Slug
              <input type="text" bind:value={pageSlug} on:input={schedulePreview} />
            </label>
            <label class="field-label">Headline
              <input type="text" bind:value={headline} on:input={schedulePreview} />
            </label>
            <label class="field-label">Subtítulo
              <textarea rows="3" bind:value={subheadline} on:input={schedulePreview}></textarea>
            </label>
            <span class="field-label">Puntos de dolor</span>
            {#each painPoints as point, i}
              <div class="pain-row">
                <input
                  type="text"
                  value={point}
                  on:input={e => updatePainPoint(i, (e.target as HTMLInputElement).value)}
                />
                <button class="btn-remove" on:click={() => removePainPoint(i)} aria-label="Eliminar">✕</button>
              </div>
            {/each}
            <button class="btn-add" on:click={addPainPoint}>+ Añadir punto</button>
            <label class="field-label">CTA
              <input type="text" bind:value={cta} on:input={schedulePreview} />
            </label>
            <button class="btn-advanced" on:click={enableAdvanced}>Modo avanzado →</button>
          {:else}
            <p class="advanced-warning">
              {#if htmlModified}
                Editando HTML directamente. Para volver al editor estructurado cierra y vuelve a abrir.
              {:else}
                Modo avanzado — edita el HTML directamente.
                <button class="btn-back-structured" on:click={() => { advancedMode = false; }}>← Volver</button>
              {/if}
            </p>
            <textarea
              class="html-ta"
              bind:value={advancedHtml}
              on:input={() => { htmlModified = true; previewHtml = advancedHtml; }}
              spellcheck="false"
            ></textarea>
          {/if}
        </div>

        <div class="preview-pane">
          <div class="pane-label">Vista previa</div>
          <iframe
            title="Vista previa"
            srcdoc={previewHtml || '<body style="background:#020817;color:#94a3b8;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh"><p>Completando campos…</p></body>'}
          ></iframe>
        </div>
      </div>

      <p class="status">{status}</p>
      <div class="actions">
        <button
          class="btn-primary"
          on:click={deploy}
          disabled={deploying || (advancedMode && htmlModified ? !advancedHtml : !previewHtml)}
        >Desplegar</button>
        <button class="btn-secondary" on:click={() => { view = 'campaign'; }}>Cancelar</button>
      </div>
    {/if}

  </div>
</div>

<style>
  .overlay      { position: fixed; inset: 0; background: rgba(0,0,0,0.75); z-index: 100; display: flex; align-items: center; justify-content: center; padding: 16px; }
  .modal        { background: #0f172a; border: 1px solid #1e293b; border-radius: 16px; padding: 24px; width: min(1100px, 96vw); max-height: 92vh; display: flex; flex-direction: column; gap: 16px; overflow: hidden; }
  h3            { color: #f1f5f9; font-size: 0.95rem; display: flex; align-items: center; gap: 8px; }
  h3 span       { color: #64748b; font-weight: 400; }
  .back-btn     { background: none; border: none; color: #64748b; cursor: pointer; font-size: 1rem; padding: 0 4px; }
  .back-btn:hover { color: #f1f5f9; }

  /* Campaign view */
  .page-list    { display: flex; flex-direction: column; gap: 6px; overflow-y: auto; max-height: 50vh; }
  .page-row     { display: flex; align-items: center; justify-content: space-between; background: #1e293b; border-radius: 8px; padding: 10px 14px; }
  .page-info    { display: flex; align-items: center; gap: 16px; }
  .slug         { font-size: 0.8rem; color: #f1f5f9; font-family: monospace; }
  .page-title   { font-size: 0.78rem; color: #64748b; }
  .deployed-at  { font-size: 0.7rem; color: #475569; }
  .page-btns    { display: flex; gap: 6px; }
  .btn-sm       { padding: 5px 12px; background: #334155; border: none; border-radius: 6px; color: #94a3b8; font-size: 0.75rem; cursor: pointer; }
  .btn-sm:hover { background: #475569; color: #f1f5f9; }
  .btn-danger   { background: #450a0a; color: #f87171; }
  .btn-danger:hover { background: #7f1d1d; }
  .empty        { color: #475569; font-size: 0.85rem; padding: 24px 0; text-align: center; }

  /* Editor layout */
  .editor-layout  { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; flex: 1; min-height: 0; height: 58vh; }
  .fields-pane    { display: flex; flex-direction: column; gap: 8px; overflow-y: auto; padding-right: 4px; }
  .preview-pane   { display: flex; flex-direction: column; gap: 6px; min-height: 0; }
  .pane-label     { font-size: 0.65rem; color: #475569; text-transform: uppercase; letter-spacing: 0.07em; }
  iframe          { flex: 1; border: 1px solid #1e293b; border-radius: 8px; background: #020817; min-height: 0; }

  /* Fields */
  .field-label    { display: flex; flex-direction: column; gap: 4px; font-size: 0.72rem; color: #64748b; }
  input, textarea { padding: 8px 10px; background: #020817; border: 1px solid #1e293b; border-radius: 6px; color: #f1f5f9; font-size: 0.85rem; width: 100%; }
  input:focus, textarea:focus { outline: none; border-color: #334155; }
  textarea        { resize: vertical; }
  .pain-row       { display: flex; gap: 6px; align-items: center; }
  .pain-row input { flex: 1; }
  .btn-remove     { background: none; border: none; color: #475569; cursor: pointer; font-size: 0.8rem; padding: 4px; }
  .btn-remove:hover { color: #f87171; }
  .btn-add        { background: none; border: 1px dashed #334155; border-radius: 6px; color: #475569; cursor: pointer; font-size: 0.75rem; padding: 6px; text-align: left; width: 100%; }
  .btn-add:hover  { color: #94a3b8; border-color: #475569; }
  .btn-advanced   { background: none; border: none; color: #475569; cursor: pointer; font-size: 0.72rem; text-align: left; padding: 4px 0; margin-top: 4px; }
  .btn-advanced:hover { color: #94a3b8; }
  .btn-back-structured { background: none; border: none; color: #3b82f6; cursor: pointer; font-size: 0.72rem; padding: 0; }

  /* Advanced mode */
  .advanced-warning { font-size: 0.75rem; color: #64748b; line-height: 1.5; }
  .html-ta        { flex: 1; font-family: ui-monospace, monospace; font-size: 0.72rem; line-height: 1.5; resize: none; min-height: 200px; }

  /* Bottom bar */
  .status         { font-size: 0.78rem; color: #64748b; min-height: 1.2em; }
  .actions        { display: flex; gap: 12px; }
  .btn-primary    { flex: 1; padding: 11px; background: #3b82f6; color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 0.9rem; }
  .btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-secondary  { padding: 11px 20px; background: #1e293b; color: #94a3b8; border: none; border-radius: 8px; cursor: pointer; font-size: 0.9rem; }
</style>
```

- [ ] **Step 2: Run pages typecheck**

```bash
cd src/main/infrastructure/pages && npm run typecheck
```

Expected: no new errors.

- [ ] **Step 3: Run full worker test suite**

```bash
cd /home/valentin/code/market-intel && npm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit and push**

```bash
git add src/main/infrastructure/pages/src/lib/components/DeployModal.svelte
git commit -m "feat: DeployModal campaign view + structured field editor + modo avanzado"
git push
```
