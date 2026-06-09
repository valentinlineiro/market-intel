# Willingness-to-Pay Capture + Lead Quality Scoring

**Date:** 2026-06-09
**Status:** Approved
**Scope:** Feature B of three-part productization roadmap

## Goal

Turn email signups from existence signals into intent signals. Every lead gets a quality score derived from price willingness, recency, and segment opportunity strength. Hot leads surface at the top of the dashboard so follow-up effort goes to the right people first.

---

## Data Layer

### Migration

`0010_add_price_tier_to_leads.sql`:

```sql
ALTER TABLE leads ADD COLUMN price_tier TEXT NULL;
```

Safe on existing rows — all receive `NULL`. No backfill needed.

### Score formula (computed at read time, never stored)

Three signals contribute up to 10 points total:

| Signal | Value | Points |
|---|---|---|
| **Price tier** | €50+ / mes | 4.0 |
| | €30–50 / mes | 3.0 |
| | €10–30 / mes | 1.5 |
| | €0–10 / mes or null | 0.0 |
| **Recency** | < 7 days ago | 3.0 |
| | 7–30 days ago | 1.5 |
| | > 30 days ago | 0.0 |
| **Segment match** | opportunity score ≥ 7 | 3.0 |
| | opportunity score 5–7 | 1.5 |
| | < 5 or no opportunity row | 0.0 |

`lead_score = price_points + recency_points + segment_points` (max 10.0, rounded to 1 decimal).

The score is a pure function of three inputs. It is computed on every `GET /public/leads` response and never persisted — the formula can be tuned without a migration.

---

## Signup Flow

### Step 1 — Email capture (unchanged)

`POST /public/signup` continues to accept `{ email, segment }` and saves the lead row with `price_tier = NULL`. No change to existing landing pages.

### Step 2 — Inline pricing question

After a successful signup, the landing page replaces the thank-you text with four tier buttons inline (no modal, no redirect):

```
¡Apuntado! Una pregunta rápida:
¿Cuánto pagarías por una solución a esto?

[ €0–10 ]  [ €10–30 ]  [ €30–50 ]  [ €50+ ]
```

Selecting a tier fires `POST /public/signup/price`. The pricing step is **optional** — a visitor who closes the tab keeps a valid lead row with `price_tier = NULL`, scoring 0 for that signal.

---

## API Changes

### New route — `POST /public/signup/price` (public, no auth)

**Body:** `{ email: string, segment: string, price_tier: string }`

**Behaviour:**
- Validates `price_tier` is one of: `"0-10"`, `"10-30"`, `"30-50"`, `"50+"`.
- Runs `UPDATE leads SET price_tier = ? WHERE email = ? AND segment = ?`.
- If no row matches (visitor navigated away and came back on a stale page), silently no-ops — returns `{ ok: true }` regardless.
- Idempotent: re-submitting overwrites with the latest answer.

**Response:** `{ ok: true }` on success, `{ error: string }` on validation failure (400).

### Modified route — `GET /public/leads`

Joins `opportunities` to fetch each segment's current score. Computes `lead_score` for every lead using the formula above. Returns:

```ts
{
  total: number,
  by_segment: Record<string, Array<{
    email: string,
    captured_at: string,
    price_tier: string | null,
    lead_score: number,
  }>>
}
```

Leads within each segment are sorted by `lead_score` descending.

---

## Dashboard

### `LeadsTable.svelte`

Adds a `lead_score` column to the existing leads table. Rendered as a colour-coded progress bar (0–10 range) with the numeric score alongside:

- Score ≥ 7 — green bar
- Score 4–7 — amber bar
- Score < 4 — muted bar

Table defaults to sorted by `lead_score` descending so the hottest leads appear first. The `price_tier` column is also shown (displays `—` when null).

### `$lib/types.ts`

`Lead` type gains `price_tier: string | null` and `lead_score: number`.

---

## Edge Cases

| Scenario | Behaviour |
|---|---|
| `price_tier = null` | Contributes 0 to score; lead still visible |
| No opportunity row for segment | Segment match contributes 0; other signals still count |
| `POST /public/signup/price` — email not found | Silent no-op, returns `{ ok: true }` |
| Duplicate signup | `saveLead` deduplicates on email + segment; price update still works |
| Opportunity score changes after lead captured | Score recalculates on next read — always fresh |

---

## Testing

### Unit tests (pure, no D1)

- Score formula: all tier combinations × recency buckets × segment score bands
- Null `price_tier` → 0 price points
- Missing opportunity → 0 segment points
- Max score (€50+ tier, < 7 days, opportunity ≥ 7) = 10.0

### Integration tests (D1 pool)

- `POST /public/signup` → `POST /public/signup/price` → `GET /public/leads` asserts `lead_score` matches expected value
- Invalid `price_tier` value → 400 response
- `POST /public/signup/price` for non-existent email → `{ ok: true }`, no error

---

## Out of Scope

- Lead export / CSV download
- Outreach or email sequences (Feature C)
- Admin UI for adjusting score weights (weights live in code, change via PR)
