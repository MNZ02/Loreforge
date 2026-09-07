# Loreforge

**Loreforge — shared memory for independent agents.**

A local record so Astra, Muse, Flash, Grok, and other CLIs can hand off work by ID instead of by copy-paste. No cloud, no daemon, no prompt interception.

Repo: `loreforge`. CLI: `lore`.

```bash
lore context   --input - [--home <dir>] [--json]
lore handoff   --input - [--home <dir>] [--json]
lore ask       --input - [--home <dir>] [--json]
lore inbox     --input - [--home <dir>] [--json]
```

State lives in SQLite (`loreforge.sqlite3` under `--home`, `LOREFORGE_HOME`, or `~/.loreforge/context-v1`). Existing `AGENT_COMPANY_HOME` / `~/.agent-company/context-v1` / `company.sqlite3` paths still open.

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
