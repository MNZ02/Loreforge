# Loreforge v0.1 — Provider Integrations

Loreforge does not intercept prompts or launch CLIs. Sessions see the board only if their **always-on rules** tell them to call `lore` at start. `lore instructions show` prints the JSON envelopes to embed.

Agent ids are session labels, not roles. A friend can use Codex on one task and Claude on the next; each registers its own id and claims whatever is open. Nothing in the protocol reserves implement or review for Muse, Flash, or Grok.

## Install into sessions

Skills that load only when the model guesses they apply are the wrong default. Use files each CLI already reads every session. Portable text: [templates/session-rule.md](../templates/session-rule.md).

| CLI | File | Scope |
|---|---|---|
| Grok | `~/.grok/rules/loreforge.md` | every Grok session |
| Grok / Codex / Claude in a repo | `AGENTS.md` (and `CLAUDE.md` if used) | that repository |
| Claude Code | `~/.claude/CLAUDE.md` or repo `CLAUDE.md` | user or repo |
| Cursor | `.cursor/rules/loreforge.mdc` | that repository |
| Other CLIs | that product's custom-instructions / project-instructions field, once | that product |

```bash
npm install && npm run build
export LOREFORGE_HOME="${LOREFORGE_HOME:-$HOME/.loreforge/context-v1}"
# optional: alias lore="node /path/to/loreforge/dist/cli/main.js"

lore instructions show --project <PROJECT_UUID> --agent <THIS_SESSION_ID>
```

Use a distinct `--agent` per CLI window (`codex`, `claude`, `cursor`, `grok`, `alice`, …). The session must: register that id and this git root, `task list`, `inbox`, then `context` before editing. Claim only to edit. Do not start other models or create worktrees.

The `lore mcp` stdio adapter exposes the same typed core operations. See [Package workflows](package-workflows.md#mcp). It does not launch agents or install vendor hooks.

## Friend trial (two CLIs, your choice)

On one machine, one git repo, Node 24.15+:

```bash
npm install -g loreforge    # or npm install /path/to/loreforge
cd /path/to/git/repo
lore detect                 # PATH + ~/.claude, ~/.codex, ~/.grok, … (no key reads)
lore init --write-rules --demo
```

With no `--agent`, init uses detected CLIs (role `both`). Override with `--agent id:role`. `--no-detect` disables scanning. This is not a subscription-plan API.

1. Init registers the repo, the agent ids, optional sample tasks, and writes **repo** rules (`.grok/rules`, `AGENTS.md` markers). `~/.grok/rules` is only changed with `--write-user-rules`.
2. Open each CLI in that repo. Say only “what's next.”
3. The implementer claims the first demo task; the reviewer waits, then `context` in review mode.

If a CLI asks you to restate the plan, its rule file was not loaded. Roles from init are preferences, not locks.

Sharing the git repo is not enough: loreforge state is local SQLite under `LOREFORGE_HOME`. Two laptops do not automatically share a board. Use verified backup/restore or record export for transfer; do not treat an arbitrary shared network directory as a SQLite synchronization protocol.

## Provider Integration Matrix

| Provider & CLI | Model Reported / Effort | Generic Snippet Support | Native Hook Status | Local CLI Execution | Evidence & Verification Notes |
|---|---|---|---|---|---|
| **Google Antigravity (AGY)** | Gemini 3.8 Flash (High) | Supported (`instructions show`) | Unverified / Deferred (no custom hooks modified) | Exercised (local CLI subprocess commands) | [Acceptance Tests](https://github.com/MNZ02/Loreforge/blob/main/tests/acceptance/checklist.md) & [Flash Progress](https://github.com/MNZ02/Loreforge/blob/main/reports/flash/progress.json) |
| **Meta Muse** | Muse Spark 1.3 (xhigh requested) | Supported (`instructions show`) | Unverified / Deferred (no custom hooks modified) | Exercised concurrently in shared directory | [Muse Baseline](https://github.com/MNZ02/Loreforge/blob/main/reports/muse/baseline.json) & [Muse Progress](https://github.com/MNZ02/Loreforge/blob/main/reports/muse/progress.json) |
| **Other AI CLIs (Codex, Claude, etc.)** | Unspecified / User-supplied | Supported (POSIX-standard CLI stdin/stdout) | Unverified (not tested in v0.1) | Pending (unverified) | Generic shell invocation callable from any POSIX shell environment |

## Integration Architecture & Boundaries

1. **Always-on rules, not CLI-mutated hooks**:
   Users drop instructions into files the CLI already loads. Loreforge does not rewrite `.cursorrules`, `.windsurfrules`, or shell profiles.

2. **Truthful Verification**:
   - Provider availability or subscription models are not claimed or evaluated.
   - Provider models are recorded as reported by the active session; unverified session modes are explicitly labeled as unverified.
   - Live two-provider exercise (S1) is evaluated separately from software unit/acceptance tests.

3. **Safe Path Quoting**:
   The `lore instructions show` command emits concrete paths safely escaped for standard POSIX shells, ensuring paths with spaces or special symbols do not cause injection.

User-level rules generated by 0.2 resolve the current repository rather than embedding a project UUID/home. Re-run init with --write-user-rules to replace earlier fixed-project rules. `lore doctor` diagnoses repository configuration; vendor rule loading still requires verification in the target client.
