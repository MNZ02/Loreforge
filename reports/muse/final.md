# Muse final report — Agent Company v0.1 software acceptance

Owner: Muse (Muse Spark 1.3; xhigh requested, displayed identity unverified).
Scope: Muse-owned product files only. Flash owned the client; Grok 4.6 was the
sole independent reviewer. This report makes no release-approval verdict over
Flash's work; the approval is Grok's `reports/grok/review.json`.

## Final reviewed fingerprint

- `workspaceFingerprint`: `6596c5c536478d39deabb9379674fbcd7c2d9127c9436aa78dac5b4f4667968d` (93 covered entries)
- `contractHash`: `783540612d791e6835b5e91a64f8bd40c749ed1374da33df6828dfc4d2eaf0ba` (unchanged since M0)
- Grok verdict: `pass` for exactly this fingerprint (`reports/grok/review.json`,
  scope A01–A26 plus Codex follow-ups). All seven findings `verified_fixed`.
- The delta from my `27d43306…` freeze to this hash is Flash-owned CODEX-004
  material only (walkthrough test, README, setup). My product files were frozen
  before that delta; I made no product edit after it.

## Completed milestones and owned files

M0 (baseline, tooling, frozen contract types/schemas), M1 (storage, identity),
M2 (claims, leases), M3 (handoffs, completion), M4 (questions, inbox,
decisions, context), M5 (core-ready), M6 repairs (GROK-001, GROK-003,
CODEX-001/002/003), final freeze.

Owned files written (nothing else touched):

- Manifests/tooling: `package.json`, `package-lock.json`, `tsconfig.json`,
  `tsconfig.build.json`, `.gitignore`, `scripts/test.mjs`
- Core: `src/core/contracts.ts`, `src/core/dispatch.ts`, `src/core/errors.ts`,
  `src/core/index.ts`, `src/core/operations/` (claims, common, context,
  decisions, handoffs, messages, register, tasks), `src/core/schemas/`
  (common, context, decisions, handoffs, questions, registration, request, tasks)
- Storage/evidence: `src/storage/db.ts`, `src/storage/faults.ts`,
  `src/storage/receipts.ts`, `src/storage/schema.ts`, `src/evidence/git.ts`
- Tests: `tests/core/` (fingerprint, schemas, schemas-limits),
  `tests/storage/` (busy, claims, context, decisions, handoffs, lifecycle,
  messages, projects, tasks), `tests/support/`
  (fingerprint, flow, harness, proc)
- Reports: `reports/muse/` (baseline, bootstrap, core-ready, coverage,
  findings, progress, reuse, this file)

## Coverage and exact check outcomes

- Coverage map: `reports/muse/coverage.md` (A01–A15, A16-schema halves, A18/A19
  selection halves, A23, A25 helper, plus CODEX-001/002/003 rows).
- My gate on the final tree: `npm run check` exit 0 — typecheck clean, build
  clean, **178 tests / 45 suites / 0 fail / 0 skipped** (includes Flash's
  walkthrough test; my freeze added the last 7 CODEX regression tests).
- Grok's independent gate on the same fingerprint: `npm run check` exit 0
  (178/45), `reports/codex/reproduce.mjs` exit 0 (foreign-checkout CONFLICT,
  lock-wait renew STALE_CLAIM, index unchanged, extra key absent),
  `repro-a26-foreign.mjs` exit 0, `repro-a01-concurrent.mjs` 12/12, fingerprint
  stable across the check run.

## Grok findings and applied Muse fixes

| Finding | Severity | Fix (owned files only) |
|---|---|---|
| GROK-001 (64-hex SHA-256 HEAD rejected by observation) | major | `src/evidence/git.ts`: shared `GIT_HEAD_RE` (40- or 64-hex, mirroring `HeadSchema`) in `observeCheckout`/`observeCurrentGit`; new SHA-256 fixture test in `tests/storage/handoffs.test.ts` |
| GROK-003 (concurrent first open: loser got IO) | major | `src/storage/db.ts`: `openDatabase` retries setup on lock contention within the 5000 ms budget, maps exhaustion to BUSY never IO; 6-round fresh-home race test in `tests/storage/lifecycle.test.ts` |
| CODEX-001 (foreign-repo handoff accepted) | major | `src/core/operations/handoffs.ts`: compare checkout Git common-dir realpath with the registered project inside the transaction (worktrees pass, clones fail); 3 tests |
| CODEX-002 (lock-wait across expiry used stale clock) | major | `src/core/operations/common.ts` + all 10 mutation handlers + `src/core/dispatch.ts`: sample the injectable clock after acquiring the write transaction; observation keeps its own timestamp; 3 tests (2 fail on dispatch-time sampling, verified by temporary revert) |
| CODEX-003 (observation rewrote the Git index) | minor | `src/evidence/git.ts`: `--no-optional-locks` on all Git subprocesses; index-bytes test incl. linked worktree (fails without the flag, verified by temporary revert) |

GROK-002 and CODEX-004 were Flash-owned; I did not touch them. No finding
required a contract change; none was made.

## Code provenance

No Blackboard code copied — see `reports/muse/reuse.md`. All core, storage,
and evidence code was written fresh against `CONTRACT.md`.

## Field test (S1): pending, with precise remaining steps

No live two-provider exercise has run; software acceptance does not claim a
field pass. Flash published the disposable scenario in
`examples/two-agent/README.md` with `examples/two-agent/setup.mjs`
(CODEX-004 fixed the walkthrough payload). Remaining, in order:

1. Run the setup script to create a caller-specified temp dir, tiny Git
   fixture, registered project, `muse`/`flash` agents, tasks A and B (B depends
   on A). Git commits only inside that disposable fixture.
2. In a real Muse session: context/claim task A, small fixture change + test,
   completed handoff; report only task ID and fixture/home location.
3. In a real Flash session: context task B, claim B, task-linked question to
   Muse, blocked handoff referencing it.
4. Muse answers via CLI inbox; Flash reopens B, reclaims, completes.
5. A fresh session retrieves everything from IDs alone and reports state.
6. Record task/command/record IDs (tokens redacted) in
   `reports/<owner>/field-test.md`.

## What is not claimed

No application commit, push, PR, deployment, or external publication was made
by Muse. No user-wide configuration was changed. Nothing here verifies all
supported vendor products — only the configurations actually exercised
(Node 24.15.0, npm 11.12.1, local Git) are asserted.
