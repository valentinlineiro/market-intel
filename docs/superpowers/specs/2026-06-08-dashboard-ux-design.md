# Dashboard UX Redesign

**Date:** 2026-06-08
**Status:** Approved

## Overview

Full UX overhaul of the Market Intel dashboard. Goals: fix all current pain points (unreadable segment names, dense opportunity table, uninformative stats, raw JSON config), make it mobile-first, and add a dark/light theme toggle.

## Layout

Tabs navigation replaces the current single-scroll layout. Four tabs, sticky on scroll:

```
[ Oportunidades ] [ Sectores ] [ Leads ] [ Config ]
```

A **stats bar** sits permanently above the tabs and is always visible regardless of active tab.

## Stats Bar

Four KPIs in a single row:

| KPI | Value | Color logic |
|-----|-------|-------------|
| Señales | total_signals | neutral |
| Oportunidades | total_opportunities | neutral |
| Top score | max score across opportunities | green ≥ 6, yellow 4–6, gray < 4 |
| Collectors | healthy/total from `/health` | green if all OK, red with error count if any failed |

On mobile, all four fit in one row (compressed labels).

## Theme

Dark base (`#111827` background, `#1f2937` cards, `#374151` borders) with two accent colors:
- **Emerald** (`#10b981`) — positive signals, high scores, healthy status, primary actions
- **Violet** (`#a78bfa`) — active tab indicator, LLM-related elements

Light mode alternative (white/slate palette, same structure). Toggle in the header, preference persisted in `localStorage`.

Score color scale used consistently across the app:
- ≥ 6.0 → `#10b981` (emerald)
- 4.0–5.9 → `#f59e0b` (amber)
- < 4.0 → `#6b7280` (gray)

## Tab: Oportunidades

### List view

Compact rows sorted by score descending. Each row shows:
- Segment name (cleaned: `contador_asesoria_fiscal` → "Contador fiscal" — replace underscores with spaces, title-case, trim)
- Status badge (testing/watching/scaling/killed)
- Pain summary truncated to ~40 chars
- Score (color-coded)
- Chevron indicating expand state

### Inline drawer

Tapping a row expands an inline drawer below it (not a modal). The drawer contains:
- Full cleaned segment name as heading
- Score breakdown as horizontal bars: Dolor, Capacidad de pago, Volumen, Urgencia, Competencia (values from `score_breakdown`)
- Full `pain_summary` text
- Signal count
- Action buttons:
  - "Ver landing" (link, only if `landing_url` set)
  - "Deploy" / "Regenerar" (triggers existing deploy action)
  - Status change selector (watching → testing → scaling, or kill) — requires new `PATCH /opportunities/:segment/status` worker endpoint

Only one drawer open at a time — tapping another row closes the previous.

### Segment name cleaning

```ts
function cleanSegment(slug: string): string {
  return slug.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
```

Applied in the frontend display layer only — slugs remain unchanged in the DB and API.

## Tab: Sectores

Same card grid as current but with updated theme. Changes:
- Timestamp displayed as absolute date + relative ("hace 2h", "hace 3 días") instead of raw minutes
- "Descubrir ahora" button styled as primary action (emerald)
- Score color-coded with the same scale

## Tab: Leads

List grouped by segment (cleaned name). Each group shows email count. Expandable to show individual emails + capture date. Empty state: "Sin leads todavía."

## Tab: Config

Single scrolling form with accordion sections. One "Guardar cambios" button at the bottom submits all changes via PUT `/config`.

### Scoring
| Field | Type | Default |
|-------|------|---------|
| top_n | number input | 10 |
| min_score | number input (step 0.1) | 5.0 |
| dry_run | toggle | false |

### LLM
| Field | Type | Options |
|-------|------|---------|
| provider | select | groq, openrouter, anthropic |
| model | text input | — |
| temperature | number input (0–1, step 0.1) | 0.3 |
| max_tokens | number input | 1024 |

### Descubrimiento
| Field | Type | Default |
|-------|------|---------|
| max_clusters | number input | 10 |
| min_signals | number input | 3 |

### Notificaciones
| Field | Type |
|-------|------|
| from_email | email input |
| to_email | email input |
| alert_score_threshold | number input (0–10, step 0.1) |

### Collectors

One accordion item per collector. Each has an enabled toggle at the top. Additional fields:

**gnews:** max_results (number)
**local_news:** feeds (list of URL + location pairs, add/remove rows); pain_keywords (tag input)
**reddit:** subreddits (tag input — comma-separated list)
**youtube:** max_videos (number), max_comments_per_video (number)
**bluesky:** max_results (number)
**mastodon:** instances (tag input), max_results (number)

### Segmentos (gnews)

One accordion item per segment in `collectors.gnews.segments`. Fields per segment:
- label (text)
- queries (textarea — one per line)
- keywords (tag input)
- salary_mean (number)
- income_tier (select: low / medium / medium_high / high)
- has_deadline (toggle)

### Segmentos (synthesis)

One accordion item per segment in `synthesis_segments`. Fields per segment:
- label (text)
- keywords (tag input)
- income_tier (select: low / medium / medium_high / high)
- has_deadline (toggle)
- discovery_score (number, read-only display — set by the system)

## Mobile

- Minimum supported width: 320px
- Stats bar: 4 KPIs always in one row, font scales down
- Tabs: horizontal scroll if viewport too narrow
- Drawers: full-width, no horizontal overflow
- Config forms: full-width stacked fields

## Out of scope

- Editing segment slugs (keys in DB)
- Multi-language support
- Charts or time-series visualizations
- Pagination (current data volume doesn't require it)
