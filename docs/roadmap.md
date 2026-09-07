# Roadmap

## Phase 1 — laptop (now)

- Current stack (subscription-only, no API keys): **Claude Pro** (developer A +
  reviews Codex PRs) + **ChatGPT/Codex** (developer B + reviews Claude PRs) +
  **SuperGrok** (your interactive planning/research sidekick).
- Run `coordinator.sh` by hand against one repo, one labeled issue.
- Goal: tune the developer prompt until PRs are mergeable without rework.
- Measure per task: agent-credit spend, wall time, review time, rework rate.
- Upgrade Claude Pro → Max 5x only when the $20 credit is the thing stopping
  you (the dashboard shows Agent SDK credit burn separately).

## Phase 2 — EC2 (when the loop is boring)

- Small instance (t3.medium is plenty — the models run at Anthropic/OpenAI;
  this box only orchestrates). Dedicated unprivileged user.
- `claude` login on the box (subscription auth), scoped GitHub token.
- Cron the coordinator every 15 min. Logs to a file; a weekly digest issue
  summarizing spend + throughput.
- Cron `review.sh` for new PRs (cross-vendor: the sub that didn't write it
  reviews it).

## Phase 3 — scale within subscriptions (when pools run dry)

House rule is subscription-only, so scaling means bigger pools, not API keys:

- Claude Pro → Max 5x ($100 credit) → Max 20x ($200 credit).
- ChatGPT plan → Pro 5x/20x for a bigger agentic pool.
- Route by pool health: if one vendor's pool is dry, the round-robin in
  coordinator.sh naturally shifts work to the other.
- Add non-dev agents (support triage, content) — same issue-queue pattern,
  different labels and prompts.
- Escape hatch (only if the business ever demands it): an API key per
  overloaded agent is a one-env-var change at the same per-token rates. Noted,
  not planned.

## Non-goals (on purpose)

- No unattended merges of PRs that touch sensitive paths (CI, deploy, env,
  migrations, auth, billing) or that any reviewer flagged — those always
  escalate to a human. Auto-merge applies only to LGTM + green + clean-path
  PRs, and AUTO_MERGE=0 turns it off entirely.
- No multi-account subscription stacking — scale via API billing.
- No always-on agent loops — everything is event/cron driven.
