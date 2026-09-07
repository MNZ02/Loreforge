# Loreforge

**Loreforge — shared memory for independent agents.**

A local record so Astra, Muse, Flash, Grok, and other CLIs can hand off work by ID instead of by copy-paste. No cloud, no daemon, no prompt interception.

Loreforge is a **log**, not a harness. Blackboard (or you) starts models and isolates worktrees. Loreforge stores tasks, claims, questions, decisions, and git evidence so a session that was not started from a board can still see what happened.

Agent ids are labels (`codex`, `claude`, `cursor`, `grok`, …), not roles. Any registered agent may claim any open task. Who implements vs reviews is decided at claim time, not by vendor.

**Non-goals:** never start or wake a model; never create or merge worktrees; never merge or deploy. Install the protocol into each CLI's always-on rules so sessions check the board without a pasted plan. See [Install into sessions](docs/integrations.md#install-into-sessions).

Repo: `loreforge`. CLI: `lore`.

```bash
lore context   --input - [--home <dir>] [--json]
lore handoff   --input - [--home <dir>] [--json]
lore ask       --input - [--home <dir>] [--json]
lore inbox     --input - [--home <dir>] [--json]
```

State lives in SQLite (`loreforge.sqlite3` under `--home`, `LOREFORGE_HOME`, or `~/.loreforge/context-v1`). Existing `AGENT_COMPANY_HOME` / `~/.agent-company/context-v1` / `company.sqlite3` paths still open.

### Install and try

Requires Node.js 24.15+. Do not use a `postinstall` prompt; run `lore init` once.

```bash
npm install -g loreforge   # or: npm install /path/to/loreforge && npx lore
cd /path/to/your/git/repo
lore init --write-rules --demo
# or pick roles: lore init --agent codex:implement --agent grok:review --write-rules --demo
```

`lore init` with no `--agent` **detects local CLIs** (binary on PATH and/or a config directory). `lore detect` lists them. That is not a billing check: an auth file on disk means “looks signed in,” not which plan you pay for. Interactive `lore init` still asks implement / review / both. Roles are preferences, not locks.

Then open those CLIs in the repo and ask “what’s next.” Each should list the sample tasks and claim according to its role.

### Quick Start

```bash
npm run lore -- project register --input - <<'EOF'
{"schemaVersion":1,"requestId":"req-reg-1","payload":{"root":"/path/to/repo","name":"MyProject"}}
EOF

npm run lore -- agent register --input - <<'EOF'
{"schemaVersion":1,"requestId":"req-reg-agent-1","payload":{"id":"flash","displayName":"Flash Agent"}}
EOF

npm run lore -- context --input - <<'EOF'
{"schemaVersion":1,"projectId":"<PROJECT_UUID>","payload":{"taskId":"<TASK_UUID>","mode":"work"}}
EOF
```

Compiled binary: `node dist/cli/main.js` (same arguments as `lore`).

```bash
npm run lore -- instructions show --project <PROJECT_UUID> --agent <AGENT_ID>
```

See [Usage Guide](docs/usage.md) and [Integrations](docs/integrations.md).

---

## Historical Automation (Legacy)

The following existing directories and scripts represent an earlier prototype architecture designed around GitHub issue polling, automated PR creation, and auto-merging:
- `orchestrator/`: shell scripts (`coordinator.sh`, `tick.sh`, `review.sh`, `fix.sh`, `digest.sh`) and policies.
- `agents/`: historical prompts (`developer.md`, `reviewer.md`).
- `.env.example`: historical environment configuration.
- `docs/roadmap.md`: earlier cloud/scale-out roadmap.

> [!WARNING]
> **Historical Artifacts**: The legacy scripts contain automated publishing and merge actions. They are preserved for historical reference only. The v0.1 product code does not execute, invoke, or import any legacy files.

## Rename compatibility

`company` remains a bin alias for `lore`. Pre-rename homes and `company.sqlite3` files still open. Frozen planning docs and historical reports keep their original names. This checkout is `/Users/mnz/dev/loreforge`.
