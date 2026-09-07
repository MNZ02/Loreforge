# Loreforge: product-direction audit

Verdict: **keep the implementation foundation; correct the product boundaries
and fill the shared-memory gap before adding more workflow conventions.**

The current project is still a local CLI and record store, not an agent execution
harness. Setup, CLI discovery, aliases and optional rule installation can help
the original idea. But task-management requirements now dominate the experience,
and installed rules impose restrictions on the host agents that the memory
tool itself does not need.

## Evidence and attribution limits

Inspected snapshot: `/tmp/loreforge-design-audit-tq4q6lwo`.
Covered fingerprint: `8be907d473a1220ed62b537012aa3a379f744b3130e3fa48e0abb80958f44ed4`,
98 entries. Snapshot copied during this audit because files were changing; all
107 copied files still matched the live tree at the subsequent comparison.
Source manifest saved in design-snapshot-2026-09-07.json.

Snapshot `npm run check`: typecheck/build passed, 190 tests / 47 suites passed,
zero failures/skips. Log: design-check-2026-09-07.log. Added isolated reproductions
for uncovered setup/workflow issues; see design-reproduce.mjs. That diagnostic
prints observations; exit 0 is not an assertion that each behavior is correct.
No product code or user instruction files changed during this design audit.

Grok's latest stored review covers `6596c5c5...`, not this newer tree. Its pass
does not establish correctness of the init/detection/rule-installation additions.
There is no Git history establishing authorship of every edit. The user's report
attributes the direction changes to Grok; this audit establishes the behavior,
not personal authorship beyond the available records.

The earlier task-first narrowing was also in Codex's original specification.
It would be inaccurate to blame all of it on Grok. The implementation/reviewer
assignments for building Loreforge were never intended to be mandatory provider
roles for everyone using Loreforge.

## Original intent versus current behavior

| Original need | Current behavior | Assessment |
|---|---|---|
| Continue using independent CLIs | CLI operates against local SQLite; no model dispatcher | Correct foundation |
| Agents leave records of what they learn/do | Claimed task handoffs and project decisions | Useful, but too narrow for ordinary discoveries/reviews |
| Other agents find relevant prior context | Current task + direct dependencies + selected decisions | Works for an explicitly connected task chain, not broad discovery |
| Ask another agent and continue independent work | Durable questions, answers and inbox retrieval | Correct mechanism; manual checkpoints must actually be adopted |
| Agents consistently consult shared context | Generated instructions plus new rule installation | Sensible convenience, not proof that every provider loads/follows them |
| Any provider can take any useful role | Agent labels independent from soft role preferences | Correct; build-time Muse/Flash/Grok ownership is not a product rule |
| Shared context without running everything through a harness | Core does not start agents | Correct; should not prohibit the host agent's otherwise authorized actions |

## Findings

### D01 — Installed rules overreach into the host workflow

`src/cli/init.ts:86` emits: "Do not start other models, create worktrees, merge,
or deploy." This is written into repository AGENTS.md through init at line 343.

It changes a boundary of Loreforge's implementation into a directive governing
the user's other agents. A memory tool not creating worktrees does not imply
that an agent using it must stop using worktrees. This is especially inconsistent
with the original plan recommending separate worktrees for simultaneous edits.

Keep: Loreforge's core does not launch models or perform Git integration.
Change: generated instructions should govern context retrieval, recording,
ownership and inbox checks; otherwise defer to the user's workflow and permissions.
Avoid turning the core's current absence of scheduling into a permanent ban on
optional notifications or an external coordinator. Running agents can already
coordinate by checking messages; a launcher is not required for that.

### D02 — Shared-memory retrieval only works when task links are known

`src/core/operations/context.ts:81` builds the handoff scope from the task and
its direct dependencies. Questions are restricted to the current task. There is
no general notes/search operation in the request union. Project-wide decisions
do supply some reusable knowledge, but general discoveries must be forced into
a decision or found by manually navigating old tasks.

Reproduced: complete an old task with a reusable finding, create a new task with
no explicit dependency, retrieve context. It returns zero handoffs from the old
task. This matches the old specification; it is a product limitation, not an
implementation regression.

Add later, after agreeing the product direction: append-only notes/findings/reviews
with optional task linkage, paths/tags, author/session and source evidence, plus
bounded project/path/text lookup. Preserve relevance limits and provenance; do
not put the entire transcript into every prompt. No vector database is needed
just to establish that this retrieval is useful.

### D03 — The review demo conflicts with the completion protocol

`src/cli/init.ts:92` says "Claim only to edit"; role guidance discourages
reviewers from claiming. The second demo task is explicitly review-only.
`src/core/operations/handoffs.ts:151` requires an active claim for any handoff.

Reproduced: a review task depending on completed work cannot submit its completed
review without a claim; it returns STALE_CLAIM. Review context mode filters what
is shown; it is not a review-result operation or an alternative completion path.

Decide the meaning once: task claims may represent ownership of review work as
well as edits, or a review can be an append-only report without claiming an
implementation task. Either is coherent. "Do not claim, then submit a claimed
completion" is not. For general shared memory, an independent record/report path
is useful beyond this particular demo.

### D04 — Init cannot onboard a second repository in one home

`src/cli/init.ts:254` always uses global registration requestId `init-project-1`.
The receipt system correctly rejects the second different payload under that
same key. Reproduced with two disposable Git repos and one fresh shared home:
first init succeeds; second fails with requestId conflict.

Use retry identities scoped to canonical project registration input, or persist
an actual initialization operation identity. Keep intentional retries idempotent;
do not weaken the receipt core or work around this with a database per project.

### D05 — Init cannot update its role roster

`src/cli/init.ts:278` uses a fixed roster-decision receipt key. Re-running init
with the same first agent but a changed role/roster conflicts. Reproduced by
changing codex from implement to both. It can also leave newly registered agents
behind before failing, since onboarding spans multiple mutations.

Treat roster/preferences as intentionally updateable configuration; keep a
clear change record if needed. Do not reuse an old mutation's idempotency key
for changed content. Preflight and recover partial setup explicitly.

### D06 — Optional global rules pin a project into unrelated sessions

`src/cli/init.ts:359` writes per-agent global rules using a concrete project ID,
home and roster. The latest snapshot makes these writes separately opt-in via
writeUserRules, which is an improvement over combining them with repo writes.
However, the resulting instruction still points every session at one project,
and writeFileSync replaces an existing loreforge rule file wholesale.

Generic global instructions should discover the current checkout's project;
repo-scoped configuration should carry the concrete project ID. Preserve marked
user content and detect incompatible existing configuration. Test onboarding
two projects and switching between them before claiming seamless session setup.

## What I recommend keeping

- Existing storage, task identities, idempotency, lease handling and evidence fixes.
- Durable Q&A and explicit bounded context rendering.
- Short command aliases and an onboarding command.
- Provider-neutral identity and optional role preferences.
- Separate software tests and real-provider adoption tests.

## Product definition to agree before further implementation

**Loreforge gives independently operated AI agents shared project memory and
asynchronous communication. Agents retain their own tools and workflow; Loreforge
helps them discover relevant prior work, record findings, and exchange questions.**

The core can remain a local library/CLI. Separate optional integrations can
provide context at session/task boundaries and notify or schedule through another
tool if later needed. Neither a compulsory coding pipeline nor a full autonomous
company is needed to deliver the original benefit.

## Suggested sequence

1. Correct the installed-rule boundary, init multi-project/roster behavior, and
   review completion semantics. These are concrete defects/inconsistencies.
2. Add a minimal general record and retrieval path, with task IDs optional for
   observations. Keep task ownership for work that needs coordination.
3. Exercise a real memory scenario: agent A records a useful discovery; agent B
   on a different task finds it by project/path/topic without being handed A's
   task ID. B asks A a question and can work elsewhere until a later inbox check.
   A genuinely fresh third session reconstructs the facts from stored records.
4. Verify rule loading and identity selection in the actual two CLIs the user
   uses. Finding an executable/config file does not establish this behavior.
5. Add optional notification/integration features only where that test exposes
   friction. Keep model execution outside the core unless the user chooses it.

This is a proposal for direction and repair scope, not authorization to implement
it. The existing implementation should be extended, not thrown away.
