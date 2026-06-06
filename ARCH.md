# ARCH

Governance for human+AI collaborative software development.
Git-native. No external state. Works with any agent.

## The loop

```
arch capture  →  arch start  →  implement  →  arch done  →  arch govern
```

Capture a task. Start it. Do the work. Close it with a retrospective. Govern cleans up and assigns the next focus. Repeat.

## The 5 commands

| Command | When |
|---------|------|
| `arch capture <task>` | You have work to do |
| `arch task start <id>` | You're starting this task now |
| `arch task done <id>` | You finished — write what you learned |
| `arch govern` | End of session — archive, focus, hygiene |
| `arch review` | Something feels wrong — check system health |

## The 3 rules

1. **One focused task at a time.** arch govern assigns focus. Don't start a second task while the first is in progress.
2. **Hansei on close.** Every M/L/XL task gets a retrospective: what deviated, why, what changes next.
3. **arch review passes before you ship.** If review fails, fix it or file a task for it.

## When you need more

- Full command surface → `arch help --full`
- Protocol details → `docs/IDENTITY.md` (if present) or `docs/AGENTS.md`
- Task format reference → `docs/TASK-FORMAT.md`
