# Clean Architecture Redesign — market-intel

**Date:** 2026-06-01  
**Status:** Approved

---

## Context

market-intel detects market pain signals from multiple sources (Reddit, Google News, Trends, G2), scores them into opportunities, and validates via auto-generated Cloudflare landing pages with lead capture.

The current codebase has flat structure: `schema.py` mixes models, config, scoring logic and SQL DDL; loose root scripts (`synthesize.py`, `generate_landing.py`, `deploy.py`); Python and JS code mixed without clear boundaries; and GitHub Actions running gnews collection every 6h (120 runs/month ≈ 960 min), exhausting the 2,000 min/month free tier.

---

## Goals

1. Clean Architecture: domain → application → infrastructure, strict dependency rule
2. Cloudflare integrated into infrastructure layer (not a silo)
3. Eliminate ~1,900 GH Actions minutes/month by moving gnews collection and dashboard to Cloudflare
4. Single source of truth for data: Cloudflare D1 (no more SQLite on data branch)

---

## Target Structure

```
market-intel/
├── domain/
│   ├── models.py          # Signal, Opportunity dataclasses
│   ├── segments.py        # SEGMENTS dict, SALARY_TIERS
│   └── rules.py           # SCORE_WEIGHTS, thresholds, compute_opportunity_score()
│
├── application/
│   ├── ports.py           # ABCs: SignalRepository, OpportunityRepository,
│   │                      #       LLMProvider, Notifier, PageDeployer
│   ├── collect.py         # Use case: run collectors → write signals
│   ├── score.py           # Use case: signals → scored opportunities
│   ├── discover.py        # Use case: LLM broad segment discovery
│   ├── validate.py        # Use case: synthesize copy → build HTML → deploy landing
│   └── pipeline.py        # Orchestrator: collect → score → validate
│
└── infrastructure/
    ├── db/
    │   ├── sqlite_repo.py    # SignalRepository + OpportunityRepository (local SQLite)
    │   └── worker_repo.py    # Same ports, calls CF Worker HTTP API
    ├── collectors/
    │   ├── base.py
    │   ├── reddit.py
    │   ├── trends.py
    │   └── g2.py
    ├── llm/
    │   ├── chain.py          # Groq → OpenRouter → Anthropic fallback chain
    │   └── prompts.py        # All LLM prompt templates
    ├── notifications.py      # Telegram (implements Notifier)
    ├── worker/               # CF Worker — REST API + gnews cron (JS)
    │   ├── index.js          # API routes over D1
    │   ├── collectors/
    │   │   └── gnews.js      # Scheduled cron trigger (replaces collect-gnews.yml)
    │   └── wrangler.toml
    └── pages/                # CF Pages — frontend delivery (JS)
        ├── dashboard.html    # Dynamic: queries Worker API at runtime
        ├── landings/         # Generated landing pages (written by validate use case)
        ├── functions/
        │   └── signup.js     # Lead capture → D1
        └── wrangler.toml
```

---

## Layer Rules

| Layer | Can import from | Cannot import from |
|-------|-----------------|--------------------|
| `domain/` | stdlib only | `application/`, `infrastructure/` |
| `application/` | `domain/`, `ports.py`, stdlib | `infrastructure/` |
| `infrastructure/` | `domain/`, `application/ports.py`, stdlib, third-party | — |

`ports.py` defines the abstract interfaces (ABCs). Each infrastructure adapter implements the relevant port. Use cases receive adapters via constructor injection — no `import` of concrete classes inside `application/`.

---

## Domain Layer

### `domain/models.py`
- `Signal` dataclass (id, source, collected_at, segment, location, raw_text, url, pain_keywords, sentiment_score, salary_mean, income_tier, signal_strength, has_active_deadline)
- `Opportunity` dataclass (id, segment, pain_summary, score, score_breakdown, signal_ids, signal_count, first_seen, last_updated, status, landing_url, emails_captured, validation_deadline, telegram_alerted_at)
- `SignalSource` enum

### `domain/segments.py`
- `SEGMENTS` dict with all segment configs (label, cnae, salary data, pain_keywords, population, active_deadline, competition_proxy)
- `SALARY_TIERS` dict

### `domain/rules.py`
- `SCORE_WEIGHTS`, `KILL_SCORE_THRESHOLD`, `SCALE_SCORE_THRESHOLD`, `ALERT_SCORE_THRESHOLD`
- `compute_opportunity_score(breakdown: dict) -> float`
- `income_tier_score(segment_key: str) -> int`
- `urgency_score(segment_key: str) -> int`

**Deleted:** `schema.py` (contents split across the above three files). SQL DDL stays in `schema.sql`.

---

## Application Layer

### `application/ports.py`

```python
class SignalRepository(ABC):
    def save(self, signal: Signal) -> bool: ...          # False if duplicate
    def get(self, segment: str, limit: int) -> list[Signal]: ...
    def count(self, segment: str) -> int: ...

class OpportunityRepository(ABC):
    def upsert(self, opp: Opportunity) -> None: ...
    def get_all(self) -> list[Opportunity]: ...
    def get_by_segment(self, segment: str) -> Opportunity | None: ...

class LLMProvider(ABC):
    def complete(self, prompt: str, max_tokens: int) -> str: ...

class Notifier(ABC):
    def send(self, message: str) -> bool: ...

class PageDeployer(ABC):
    def deploy(self, html: str, segment: str) -> str: ...  # returns URL
```

### Use cases

- **`collect.py`** — receives a list of collector callables and a `SignalRepository`. Runs each collector, deduplicates, persists. Returns count of new signals.
- **`score.py`** — receives `SignalRepository`, `OpportunityRepository`, `Notifier`. Scores each segment, applies kill/scale rules, sends Telegram alert if threshold crossed.
- **`discover.py`** — receives `LLMProvider`, `Notifier`. Broad Reddit scrape → LLM clustering → alert top candidates. No DB writes (discovery is advisory).
- **`validate.py`** — receives `OpportunityRepository`, `LLMProvider`, `PageDeployer`. For opportunities above threshold: synthesize copy → build HTML → deploy → update landing_url in DB.
- **`pipeline.py`** — orchestrates collect → score → validate in sequence. Accepts flags: `skip_collect`, `dry_run`, `force`, `segments`, `threshold`.

---

## Infrastructure Layer

### Python adapters

**`infrastructure/db/sqlite_repo.py`** — implements `SignalRepository` + `OpportunityRepository` over local SQLite. Used in local dev and as fallback.

**`infrastructure/db/worker_repo.py`** — implements same ports by calling the CF Worker HTTP API (`WORKER_URL` + `WORKER_SECRET`). Used in GH Actions production runs.

**`infrastructure/collectors/`** — reddit, trends, g2. Each is a callable `collect(segment: str) -> list[Signal]`. gnews moves to CF Worker cron (see below).

**`infrastructure/llm/chain.py`** — implements `LLMProvider`. Tries Groq → OpenRouter → Anthropic in order, falls back on error.

**`infrastructure/notifications.py`** — implements `Notifier`. Sends Telegram message. No-ops silently if token not configured.

### Cloudflare Worker (`infrastructure/worker/`)

**`index.js`** — existing REST API routes (GET/POST signals, opportunities, stats, health). No changes to contract.

**`collectors/gnews.js`** — new. Registered as a Cloudflare Cron Trigger (`0 */12 * * *` — twice daily). Fetches Google News RSS for each segment's pain keywords, scores basic signal strength, writes to D1 via native binding. Replaces `collect-gnews.yml` entirely.

**`wrangler.toml`** — adds cron trigger entry:
```toml
[triggers]
crons = ["0 */12 * * *"]
```

### Cloudflare Pages (`infrastructure/pages/`)

**`dashboard.html`** — rewritten to fetch `/stats` and `/opportunities` from the Worker API on page load. No more static generation or `pages.yml`. Always shows live data.

**`landings/`** — `validate.py` use case writes generated HTML files here before deploying via `wrangler pages deploy`.

**`functions/signup.js`** — unchanged.

**`wrangler.toml`** — `pages_build_output_dir = "infrastructure/pages"`.

---

## GitHub Actions After Migration

| Workflow | Before | After |
|----------|--------|-------|
| `collect-gnews.yml` | every 6h, ~960 min/month | **Deleted** → CF cron |
| `pages.yml` | after every gnews, ~960 min/month | **Deleted** → dynamic HTML |
| `collect-trends.yml` | weekly, ~48 min/month | Stays, updated imports |
| `discover.yml` | 2×/week, ~96 min/month | Stays → 1×/week, ~48 min/month |
| `pipeline.yml` | weekly, ~60 min/month | Stays, updated imports |
| `deploy.yml` | on push | Stays, paths updated for new structure |

**Estimated total: ~200 min/month** (from ~2,150).

---

## Composition Root

Adapters are instantiated and injected in a single place: `infrastructure/compose.py`.

```python
def build(dry_run: bool = False) -> dict:
    use_local = os.getenv("USE_LOCAL_DB") == "1"
    signals = SqliteSignalRepo() if use_local else WorkerSignalRepo()
    opportunities = SqliteOpportunityRepo() if use_local else WorkerOpportunityRepo()
    return {
        "signals":       signals,
        "opportunities": opportunities,
        "llm":           LLMChain(),
        "notifier":      TelegramNotifier(),
        "deployer":      CloudflarePagesDeployer() if not dry_run else NoopDeployer(),
    }
```

`application/pipeline.py` calls `compose.build()` and passes the resulting adapters into each use case. No concrete class is imported inside `application/`.

`CloudflarePagesDeployer.deploy(html, segment)` writes the HTML to `infrastructure/pages/landings/{segment}.html`, then shells out to `wrangler pages deploy infrastructure/pages/ --project-name market-intel`, and returns the published URL.

---

## Migration Notes

- All existing Python imports break and must be updated. Order: domain → application → infrastructure.
- `schema.py` deleted; `schema.sql` unchanged.
- `market_intel.db` and the `data` branch are deprecated once D1 is the single source of truth. The `data` branch can be deleted after the first successful production pipeline run against D1.
- `worker_repo.py` is the production DB adapter for GH Actions. `sqlite_repo.py` is for local development only (`USE_LOCAL_DB=1` env var).
- GH Actions workflows updated to `python -m application.pipeline` (or equivalent entry point).
- `wrangler.toml` at root updated: `pages_build_output_dir = "infrastructure/pages"`.
