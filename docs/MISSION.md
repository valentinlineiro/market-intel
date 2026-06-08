# MISSION.md
<!-- Intent constraint for autonomous governance. Read before promoting any IDEA. -->

## Goal

Collect pain signals from Spanish professional communities, score business opportunities, and surface actionable market intelligence to the operator — automatically, on a daily cron schedule.

## Autonomous scope

These classes of work can be promoted and executed without human confirmation:

- **Bug fixes** — broken collectors, scoring errors, failing tests
- **New collectors** — adding a new signal source following the existing collector pattern (same interface, same Signal type, wired into existing cron)
- **Scoring tuning** — adjusting weights, thresholds, or filters with measurable test coverage
- **Documentation** — README, MISSION, inline comments
- **Test coverage** — adding tests for existing collector or scoring behaviour
- **Dashboard copy** — text changes to the Svelte frontend with no data model changes

## Human-gated

These classes require a human Decision field before promotion:

- **New D1 schema** — adding or modifying database tables
- **New API endpoints** — changes to the Worker route surface
- **New external dependencies** — npm packages, third-party APIs not already used
- **Scoring model architecture** — switching from weighted LLM to embeddings or clustering
- **Output format changes** — anything that breaks existing consumers of /public/* endpoints
- **cron schedule changes** — frequency or trigger logic

## Non-goals

- Building a general-purpose market research platform
- Tracking individual users or competitors
- Replacing the operator's judgment on what to build — surface the signal, not the decision

## For arch analyze --scan

When a detected pattern matches human-gated class → `**Decision:** AWAITING_HUMAN`
When a detected pattern matches autonomous scope → `**Decision:** Pending human review.`
