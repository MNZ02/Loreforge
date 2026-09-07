# Agent Company v0.1 — implementation plan

Date: 2026-09-05. Status: specification only; no product code implemented.
This plan supersedes `../shared-context-proposal.md` where details differ.

## Outcome

Two independently launched AI CLIs use a local shared record to discover prior
work, claim a task, leave a validated handoff, ask questions, and retrieve replies.
The user continues using each provider's own interface. Agent Company does not
host, launch, resume, or intercept model sessions in v0.1.

Success means a fresh second session can continue the first session's work using
stored facts and evidence without the user copying the first conversation.
It does not mean the agents share hidden reasoning or continuously receive updates.

## Read order and authority

1. Applicable user/workspace instructions.
2. This plan, then `CONTRACT.md`, then `ACCEPTANCE.md`.
3. Your own `MUSE-GOAL.md`, `FLASH-GOAL.md`, or `GROK-GOAL.md`.
4. Your own progress record and pending review findings on resume.

All seven documents in this directory are frozen planning inputs. No worker
edits them to make an implementation pass. Report contradictions as blockers with
a proposed smallest resolution. Routine implementation choices within the
specified contracts do not require clarification.

## Why this division

Use exactly Muse Spark 1.3 at the user's `xhigh` setting and AGY Gemini 3.8 Flash
at `high`. Muse owns the transaction-heavy core; Flash owns the CLI, deterministic
context rendering, examples, and consumer-facing acceptance tests. Neither owns
the other's product files. Grok 4.6 at the user's `high` setting is the sole
independent reviewer for both implementations and their integration. Grok inspects
actual changes, runs checks, and suggests owner-assigned fixes; it does not edit
product code. This reviewer choice is the user's instruction, not a benchmark claim.

This is a conservative engineering assignment, not a measured subsystem ranking.
Google documents Gemini 3.8 Flash as supporting software engineering workflows
and high thinking. Meta describes improved long-horizon coding and instruction
following in Muse Spark 1.3. These vendor descriptions support trying both on
bounded tasks; they do not establish reliability on our database invariants.
No speed or token-budget estimates are promised.

- [Google model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash)
- [Google model card](https://deepmind.google/models/model-cards/gemini-3-8-flash/)
- [Meta release description](https://research.meta.ai/blog/introducing-muse-spark-1-3)

Meta's fetched release page now says max reasoning is available. It does not
establish that the user's CLI spelling `xhigh` equals that mode. Each model must
record its displayed model/effort identity at startup if visible; otherwise mark
it unverified. Do not change models or invent CLI flags. No API key is needed by
the product: its integration is a local command callable by the existing sessions.

## Grounded starting point

Workspace: `/Users/mnz/dev/agent-company`. On inspection it contained README,
two agent prompts, roadmap, example environment file, and six shell scripts plus
policy/repo configuration. It has no `.git`, package manifest, or tests. Local
Node is 24.15.0 and npm is 11.12.1. Recheck before implementation.

Existing scripts can publish and auto-merge. Do not execute, move, edit, import,
or invoke them from new scripts. Existing `agents/`, `orchestrator/`,
`.env.example`, and `docs/roadmap.md` remain historical. Flash may rewrite README
to explain the new entry point and clearly label historical automation.

Use a new `src/` tree alongside the old files. Archiving the legacy scripts and
initializing Git are deferred; neither is required to prove the product. No
commit, push, PR, merge, deployment, global installation, or real project
instruction modification is authorized by these worker briefs.

Blackboard source at `/Users/mnz/dev/messageboard` has HEAD
`5f4f56fc8a2775aba3fff0b554f8f929c99e8d9f` and uncommitted completion changes.
It is reference-only. Inspect fixed-revision files with `git show` if useful.
Record file, revision, and adaptation in `reports/muse/reuse.md` for any copied
logic. Do not import Blackboard or copy its current dirty completion files.

Useful references: `lib/work-log.ts` for bounded change records,
`lib/job-claim.ts` for attempt-token concepts, and `controller/git-tree.ts` for
Git identity. Avoid copying process adapters, cloud database, worktree management,
web UI, or workflow scheduling into this MVP. There is no reuse quota: small
fresh implementations against this contract are acceptable.

## Fixed technical choices

- Single local TypeScript ESM package, name `agent-company`, private true,
  version 0.1.0, Node >=24.15.0, npm lockfile.
- Node built-ins for CLI parsing, processes, crypto, paths, and tests.
- SQLite through `node:sqlite` DatabaseSync; synchronous short transactions,
  foreign keys ON, WAL, busy timeout 5000 ms. No ORM or server.
- Zod 4 for runtime input validation; TypeScript 5.9, tsx 4, @types/node 24 as
  development dependencies. Resolve and lock exact compatible patch versions
  once during bootstrap. Do not add libraries outside these without a documented
  blocker. No install lifecycle scripts authored by this project.
- TypeScript strict + NodeNext module/moduleResolution. Use `.js` import
  specifiers in TS source for compiled ESM. Build only `src/` to `dist/`.
- Package bin `company` points to `dist/cli/main.js`; development invocation is
  `npm run company -- ...`, implemented as `tsx src/cli/main.ts ...`.
- All persisted product state under explicit `--home`, then `AGENT_COMPANY_HOME`,
  then `~/.agent-company/context-v1`. Keep it separate from old work/tick state.
  Tests always use temporary homes; no real home state is created during tests.
- Native SQLite can emit runtime warnings on Node 24; do not suppress arbitrary
  stderr or describe the API as stable. [Node documentation](https://nodejs.org/api/sqlite.html)

ContractHash in readiness files uses the same sorted path/content-hash algorithm
as the final fingerprint, limited to src/core/contracts.ts and all files under
src/core/schemas/. M0 freezes this entire surface, not just one re-export file.

## Ownership

| Owner | Exclusive write ownership |
|---|---|
| Muse | package.json, package-lock.json, tsconfig*.json, .gitignore; src/core/**, src/storage/**, src/evidence/**; tests/core/**, tests/storage/**, tests/support/**; scripts/test.mjs; reports/muse/** |
| Flash | src/cli/**, src/context/**, src/integrations/**; tests/cli/**, tests/context/**, tests/acceptance/**; examples/**, templates/**; README.md, docs/usage.md, docs/integrations.md; reports/flash/** |
| Grok | reports/grok/** only; read-only access to product source and tests |
| Nobody | Existing legacy paths, frozen planning documents, Blackboard, user-wide config, other repositories |

All three may read all source and run checks. Only Muse installs dependencies or edits
the lockfile. Flash requests needed script changes through its findings file.
Do not run npm install concurrently. Do not revert another worker's changes.
No nested agents or external CLI delegation: the user launches these three sessions.

Required package scripts, created by Muse at bootstrap:

| Script | Behavior |
|---|---|
| company | tsx src/cli/main.ts |
| typecheck | tsc --noEmit; includes src and tests |
| build | tsc with build config; emits src only to dist |
| test | node scripts/test.mjs all |
| test:core | node scripts/test.mjs core |
| test:client | node scripts/test.mjs client |
| test:acceptance | node scripts/test.mjs acceptance |
| check | typecheck, build, test sequentially, fail on first failure |

The test runner discovers `.test.ts` recursively and invokes node --import tsx
--test with explicit filenames. Groups: core=core+storage; client=cli+context;
acceptance=acceptance; all=all groups. Empty groups must fail, except bootstrap
uses only test:core after its first test exists. No skipped/todo acceptance tests.

## Dependency and execution schedule

Both /goal sessions can start together in the SAME folder under this ownership
agreement. No separate worktrees are needed for disjoint files in a non-Git folder.
Start Grok once core-ready and client-ready exist. It may start earlier for a
read-only specification pass, but must wait for both before judging the candidate.

1. **M0, Muse:** inspect baseline; bootstrap tooling and complete exported
   contract types; write `reports/muse/bootstrap.json` with contract SHA-256 and
   dependency versions only after focused bootstrap checks pass.
   **F0, Flash concurrently:** write fixture definitions, examples, instruction
   template, and acceptance scenario skeletons from the frozen spec. Do not
   install dependencies or fabricate a second core.
2. **M1–M4, Muse:** implement storage, claims, handoffs, messages, decisions,
   context snapshot. **F1–F3, Flash:** once bootstrap exists, implement pure
   rendering, CLI, and integration exports against exported types. Fake service
   injection is allowed in unit tests only; actual CLI always opens the real core.
3. **M5, Muse:** pass core checks and publish core-ready evidence. **F4, Flash:**
   run real multi-process acceptance tests, integrate the CLI, and report
   integration defects to Muse. Do not repair Muse files.
4. **F5, Flash:** pass full checks and publish client-ready. Both implementers
   freeze product edits. **G1–G3, Grok:** inspect the entire candidate against the
   contract, independently run checks, and publish findings with suggested fixes.
5. **M6/F5 repairs:** each owner applies fixes only in its scope. Grok reruns
   reproductions and closes verified findings. Maximum two repair rounds per
   finding. Unresolved contract/invariant failures are BLOCKED, never waived.
6. Both owners refreeze after repairs. **G4, Grok:** independently run the full
   gate and record a pass for the final source fingerprint. Muse and Flash match
   that fingerprint in their final reports; they do not issue independent review
   verdicts. Only then is software acceptance complete. Field evidence is separate.

## Coordination files (created by assigned workers)

Each worker owns `reports/<owner>/progress.json` and `findings.json`, where owner
is muse, flash, or grok. Grok's findings are the authoritative review ledger;
implementer findings remain integration reports, not approval verdicts.
Write to a temporary sibling then rename for an atomic update. Never edit the
peer's reports. Progress is updated at each milestone and before a dependency wait.

Progress fields: `schemaVersion:1`, `owner`, `modelReported`, `effortReported`,
`milestone`, `status` (working|waiting|ready_for_review|repairing|complete|blocked),
`completedSteps` (IDs), `waitingFor` (string|null), `checks` (command, exitCode,
logPath), `updatedAt` (UTC ISO), `limitations` (strings).

Findings is an array: `id`, `targetOwner`, `severity` (blocker|major|minor),
`file`, `line`, `scenario`, `expected`, `observed`, `reproductionCommand`,
`status` (open|verified_fixed), `reviewedFingerprint`, `suggestedFix`,
`verificationExpectation`. Suggested fixes name the smallest owned change and
needed regression check; they do not authorize scope expansion. Grok owns review
finding closure; implementers record attempted fixes in their own progress notes.
Optional enhancements go in reports/grok/suggestions.md, separate from defects.

Before Grok runs build/check, both implementers must be paused from product
edits and build/check runs. Grok records reviewing in its progress file. During
repair windows Grok pauses its checks; owners coordinate any shared dist/ writes.
If files change during review, that pass is invalid and Grok reviews the new
fingerprint after owners refreeze. Readiness records do not imply a lock.

Absent readiness files mean not ready, not failed. Finish independent work, then
check at most once per 60 seconds using the CLI's available interruptible waiting
mechanism. Do not hot-poll, relaunch the peer, consume model turns in a tight loop,
or implement its scope. If the peer isn't running or the session cannot wait,
save a WAITING checkpoint and explicitly report the dependency; do not claim
completion. Resuming /goal must continue from that checkpoint.

Final fingerprint: SHA-256 over a deterministic JSON array of `[relativePath,
sha256(fileBytes)]` sorted by path, covering all files in src/, tests/, scripts/,
templates/, examples/, plus package.json, package-lock.json, tsconfig*.json,
.gitignore, README.md, docs/usage.md, docs/integrations.md. Exclude reports,
dist, node_modules, databases, and frozen plans. Muse supplies the helper in
tests/support/fingerprint.ts. Any covered edit invalidates prior verdicts.
Hash file bytes exactly, use `/` relative paths, UTF-8 JSON without extra spaces,
lowercase hex digests, and do not follow symlinks. Unexpected symlinks in covered
paths fail the fingerprint check rather than hashing data outside this workspace.

## Boundaries and truthful completion

v0.1 includes local records, manual inbox checks, exported instructions, and
deterministic context. It excludes UI, daemon, schedulers, notifications, MCP,
embeddings, fine-tuning, automatic Git writes/worktrees, quota routing, and
provider API integrations. Agents can work independently between checks; no
claim is made that a running session sees a reply immediately.
Claims prevent duplicate ownership of the same task; they do not lock file paths
across different tasks. For simultaneous edits to a project, the user supplies
separate existing worktrees or disjoint files. The product never creates or
merges those worktrees. Stored uncommitted evidence is an observation and does
not back up dirty files. These limits belong in usage documentation.

Instructions are printed/exported, not installed into actual user projects.
A successful software gate requires every A-test in ACCEPTANCE.md plus Grok's
passing independent review for the unchanged final fingerprint. A successful field gate additionally requires the real two-session
exercise S1. If live provider integration is unavailable, report software
complete / field verification pending. Do not fake a transcript or mark S1 passed.

Final owner report: owned files changed, checkpoints, exact commands and exit
codes, Grok finding disposition, final fingerprint, field-test status,
and remaining limitations. No publication is part of any goal.
