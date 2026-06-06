# IDEA: Easy to add sources — collector plugin interface

**Status:** DRAFT
**Created:** 2026-06-06
**Source:** Friction observed adding StackOverflow collector (TASK-003)
**Candidate-size:** S
**Depends:** none
**Decision:** Pending human review.

## Problem

Adding a new signal source currently requires:
1. Create collector file in `infrastructure/collectors/`
2. Import it in `index.ts` (crowded file, 400+ lines)
3. Wire it into the cron pipeline manually
4. Know the internal `Signal` type and mapping conventions
5. Know how `runCollect` works and where to insert

Five manual steps, all in different places, all requiring knowledge of internals. The StackOverflow collector took longer to wire than to write. The Reddit and GitHub collectors have the same friction footprint.

The pain: **collector authorship and collector registration are coupled.** A new source requires understanding the whole pipeline to add a leaf node.

## Proposed solution

A collector registry pattern:

```ts
// arch.config.json or collectors.config.json
{
  "collectors": [
    { "id": "stackoverflow", "enabled": true, "tags": ["typescript", "react"], "segment": "dev-tools" },
    { "id": "reddit", "enabled": true, "subreddits": ["freelance", "entrepreneur"] },
    { "id": "github", "enabled": true, "keywords": ["pain", "frustrating"] }
  ]
}
```

Each collector is a module with a standard interface:

```ts
interface Collector {
  id: string;
  collect(config: CollectorConfig, env: Env): Promise<Signal[]>;
}
```

The cron loop discovers and runs registered collectors automatically. Adding a new source = write the module + add one config entry. No changes to `index.ts`.

## Validation hints

- Adding a new collector requires changes to exactly 2 files: the new collector module and the config
- `index.ts` cron loop requires no changes when a new collector is added
- Existing collectors (gnews, local_news, github, reddit, stackoverflow) migrated to new interface without behavior change
