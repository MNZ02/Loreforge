# Landing-page handoff — start here

Read [PLAN.md](PLAN.md). It contains the exact layout, copy, visual tokens, file
ownership, DOM contract, checks, and review procedure. No website is implemented yet.

## Shared registry

- Repository: /Users/mnz/dev/loreforge
- Home: /Users/mnz/.agent-company/context-v1
- Project: 67013557-afd7-431a-97fd-f5adf8d468c3
- L0 planner (Codex): f57f3ad6-92f4-43a9-b0f0-5dc8fdd32a1a
- L1 Muse: e1fe7e2a-4295-4425-a764-b6db0d2aa617
- L2 Flash: dd578764-f54f-4463-b24e-fdee489536ca
- L3 Grok: f7dbc06c-c832-44b0-b49a-33ad353f3ab2

Start Muse first, Flash after Muse, Grok after Flash. You start the provider sessions;
Loreforge stores the assignments and handoffs. Do not launch providers automatically.

## Paste into each provider session

```text
/goal Complete your assigned Loreforge landing task below in /Users/mnz/dev/loreforge.
Read docs/landing/START-HERE.md and docs/landing/PLAN.md before doing anything else.
Register your own agent identity, retrieve task context, claim your task, implement
only your owned files (Grok reviews only), verify, and submit a useful handoff.
Other agents share this checkout. Do not revert their work. No commits, push,
deployment, model launches, or root product changes. Stop with a clear report if
a dependency is unfinished. Do not mark blocked without asking a concrete question.
```

Append the appropriate task ID from the registry above to that prompt.

## Retrieve a task

Replace TASK_UUID below. This read requires no actor registration or claim.

```bash
node /Users/mnz/dev/loreforge/dist/cli/main.js context get \
  --home /Users/mnz/.agent-company/context-v1 --input - <<'JSON'
{"schemaVersion":1,"projectId":"67013557-afd7-431a-97fd-f5adf8d468c3","payload":{"taskId":"TASK_UUID","mode":"work"}}
JSON
```

Use work mode when reading planning/implementation prose. Review mode intentionally
omits narrative handoff summaries, so Grok must read PLAN.md directly and inspect
actual files. See docs/usage.md for agent register, task claim/renew, question ask,
and handoff submit request schemas. Claim reviewer work too: submitting a terminal
handoff currently requires a claim even when no product code is edited.

The planner used a frozen v1 CLI to avoid mixing ongoing notes implementation into
this registry. Future sessions should use a tested build compatible with the state;
do not rebuild the live checkout merely to run a task while other agents edit it.
If dist is temporarily broken, the planning CLI remains at:
/tmp/loreforge-release-source-b8_rv9kr/dist/cli/main.js

## Completion evidence

Use exact file paths, observed Git head/dirty state, commands/results, screenshot
paths, unresolved issues, and one useful finding. Never persist claim tokens in
these documents. Existing dirty work is unrelated and must be preserved.

Page approval, deployment, and further npm publication are outside these tasks.
