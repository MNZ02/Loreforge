# Loreforge

Loreforge is a local shared log for independent agent CLIs. It is not a harness.

## Non-goals

- Do not start, wake, or schedule other models.
- Do not create, switch, or merge git worktrees.
- Do not open PRs, merge, or deploy as part of the coordination protocol.
- Blackboard (or the user) runs agents. This repo records what they did.

## Session protocol

CLI: `node dist/cli/main.js` (from this checkout) or `npm run lore --`.
State: `--home`, then `LOREFORGE_HOME` / `LORE_HOME`, then `AGENT_COMPANY_HOME`, then `~/.loreforge/context-v1` (or existing `~/.agent-company/context-v1`).

Agent id is a label for **this** session, not a role. Register whatever id you use (`grok`, `codex`, `claude`, …). Any registered agent may claim any open task.

On start: register this git root and your agent id, `task list`, `inbox`, then `context` before editing (`work` if you will edit, `review` if not). Claim before edits. Handoff with git evidence on complete or block.

See [docs/usage.md](docs/usage.md), [docs/integrations.md](docs/integrations.md), and [templates/session-rule.md](templates/session-rule.md).
