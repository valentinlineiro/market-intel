# Landing Page Editor — Structured Fields + Multi-Page

**Date:** 2026-06-09
**Status:** Approved
**Scope:** Replace raw HTML textarea with structured field editor; support multiple pages per segment

---

## Goal

Replace the raw HTML textarea in `DeployModal` with a structured field editor (headline, subheadline, pain points, CTA) that non-technical users can edit comfortably. Add multi-page support so a segment can have several independent landing pages. Keep a raw HTML escape hatch for power users.

---

## Data Layer

### Migration

`0011_landing_pages_multi.sql` — recreates `landing_pages` with a composite primary key and two new columns:

```sql
CREATE TABLE landing_pages_new (
  segment     TEXT NOT NULL,
  page_slug   TEXT NOT NULL DEFAULT 'index',
  html        TEXT NOT NULL,
  copy        TEXT,          -- JSON: {headline, subheadline, pain_points: string[], cta}
  title       TEXT,
  deployed_at TEXT NOT NULL,
  PRIMARY KEY (segment, page_slug)
);
INSERT INTO landing_pages_new (segment, page_slug, html, title, deployed_at)
  SELECT segment, 'index', html, title, deployed_at FROM landing_pages;
DROP TABLE landing_pages;
ALTER TABLE landing_pages_new RENAME TO landing_pages;
```

Existing pages survive as `page_slug = 'index'` with `copy = NULL`. The editor falls back to LLM generation when `copy` is null.

---

## API Changes

### Modified — `POST /deploy`

Accepts `page_slug` (defaults to `'index'`) and saves both `copy` and `html`:

**Body:** `{ segment: string, page_slug?: string, copy?: LandingCopy, html?: string }`

- `page_slug` defaults to `'index'` if omitted.
- If `html` is provided directly, it is saved as-is.
- If only `copy` is provided, `buildHtml(segment, copy)` produces the HTML.
- Both `copy` and `html` are stored so the editor can reopen with structured fields intact.

### Modified — `GET /public/landings/:segment`

Unchanged behaviour — serves the `index` page for the segment. Now implemented as: look up `(segment, 'index')` in `landing_pages`.

### New — `GET /public/landings/:segment/:slug`

Serves any page by slug. Returns `404` if not found.

### New — `GET /pages/:segment` (authenticated)

Returns all pages for a segment, sorted by `deployed_at` descending:

```ts
{
  pages: Array<{
    page_slug: string;
    title: string | null;
    deployed_at: string;
    copy: { headline: string; subheadline: string; pain_points: string[]; cta: string } | null;
  }>
}
```

Used by the dashboard campaign editor to list pages on open.

### New — `DELETE /pages/:segment/:slug` (authenticated)

Deletes a single page. Returns `{ ok: true }`. No-ops silently if not found.

### New — `POST /render` (authenticated)

Takes `{ segment: string, copy: LandingCopy }`, calls `buildHtml(segment, copy)`, returns `{ html: string }`. Used by the editor for debounced live preview (300ms). Keeps `buildHtml` logic in one place.

---

## D1Repo Changes

### `saveLanding(segment, pageSlug, html, copy, title)`

Upserts `(segment, page_slug)`. Stores both `html` and `copy` (JSON-serialised).

### `getLandingHtml(segment, pageSlug)`

Looks up by `(segment, page_slug)`. Falls back: `getLandingHtml(segment)` calls with `pageSlug = 'index'`.

### `listLandingPages(segment)`

Returns all rows for a segment: `page_slug`, `title`, `deployed_at`, `copy` (parsed JSON or null).

### `deleteLandingPage(segment, pageSlug)`

Deletes the row at `(segment, page_slug)`.

---

## Dashboard — `DeployModal.svelte`

Two internal views, toggled by component state:

### Campaign view (opens first)

- Fetches `GET /pages/:segment` on mount.
- Lists pages as rows: slug, title, deployed_at, **Editar** button, **Eliminar** button.
- **Nueva página** button opens the page editor for a blank page.
- Empty state: "Sin páginas — crea la primera."

### Page editor view

Fields:

| Field | Control |
|---|---|
| Slug | Text input (pre-filled `index`, editable) |
| Headline | Text input |
| Subheadline | Textarea |
| Puntos de dolor | Dynamic list — add row / remove row per item |
| CTA | Text input |

**On open:**
- If saved `copy` exists for the page → pre-populate fields from it.
- If `copy` is null (new page or legacy page) → call `POST /api/synthesize` to generate initial values via LLM.

**Live preview:** iframe with `srcdoc` updated via `POST /render` debounced 300ms on any field change.

**Modo avanzado toggle:**
- Hides structured fields, shows raw HTML textarea pre-filled with current HTML.
- A warning explains: "Una vez editado el HTML directamente, no es posible volver al editor estructurado para esta sesión."
- Switching back to structured mode is disabled after the HTML textarea is modified.

**Desplegar button:** sends `POST ?/deploy` with `{ segment, page_slug, copy, html }` (both structured and rendered). On success, returns to campaign view and refreshes the page list.

**Eliminar:** calls `DELETE /pages/:segment/:slug` then removes the row from the list.

---

## Pages server action — `+page.server.ts`

### `deploy` action (updated)

Reads `page_slug` from form data (defaults `'index'`). Passes `{ segment, page_slug, copy?, html? }` to the Worker.

### New `deletePage` action

Reads `segment` and `page_slug` from form data. Calls `DELETE /pages/:segment/:slug` on the Worker.

### New `listPages` load (or inline in `load`)

The dashboard `load` function already fetches leads, opps, etc. Page lists are fetched lazily (on modal open via client-side fetch to `/api/pages/:segment`) rather than on page load — avoids loading all page data upfront.

---

## Edge Cases

| Scenario | Behaviour |
|---|---|
| `copy = null`, LLM unavailable | Fields are blank; user types manually; Desplegar enabled once slug + headline filled |
| Duplicate slug for same segment | Upsert overwrites existing page |
| Delete the only page | Allowed — segment has no pages until a new one is created |
| Legacy page with no `copy` | Opens editor, LLM called; on save, `copy` is stored going forward |
| Modo avanzado → user edits HTML → clicks back | Toggle disabled; user must re-open modal to get structured editor back |
| `/public/landings/:segment` with no `index` page | Returns 404 |

---

## Testing

### Unit tests

- `computeLeadScore` (existing, no change)
- `buildHtml` output does not regress for existing copy shape

### Integration tests

- `saveLanding(segment, slug, html, copy, title)` → `listLandingPages(segment)` returns correct rows
- `deleteLandingPage` removes the row, others unaffected
- `getLandingHtml(segment, 'index')` returns html; `getLandingHtml(segment, 'unknown')` returns null
- `POST /deploy` with `page_slug` saves correctly
- `DELETE /pages/:segment/:slug` returns `{ ok: true }` for existing and non-existing rows

---

## Out of Scope

- Navigation links between pages within a segment
- Page ordering / drag-and-drop reorder
- Per-page analytics
- A/B testing pages
- Migrating old `landing_url` values to new slug-based URLs
