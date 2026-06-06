# .githooks

ARCH governance hooks. Activated by: `git config core.hooksPath .githooks`

- `commit-msg` — rejects commits without [TASK-ID] reference
- `pre-commit` — runs arch review, blocks on drift violations  
- `pre-push` — final integrity check before remote push

Note: `arch --scope` call in pre-commit produces a warning but does not block — benign.
To deactivate: `git config --unset core.hooksPath`
