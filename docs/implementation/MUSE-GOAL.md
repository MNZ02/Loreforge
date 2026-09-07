# Muse Spark 1.3 xhigh — core implementation goal

Work in `/Users/mnz/dev/agent-company`. Read PLAN.md, CONTRACT.md, and
ACCEPTANCE.md first. Implement only your ownership below. You are not alone in
the codebase: Gemini Flash works concurrently on the client. Never revert,
reformat, or repair its files. No nested delegation, model substitution,
publication, or user-wide configuration changes.

Your objective is a fully tested local core, integrated software acceptance, and
repairs suggested by the independent reviewer, Grok 4.6 high. You do not review
Flash for release approval. S1 field verification is attempted
only as available and reported separately; do not fabricate a live-session pass.

## Ownership

Write only package.json, package-lock.json, tsconfig*.json, .gitignore,
src/core/**, src/storage/**, src/evidence/**, tests/core/**, tests/storage/**,
tests/support/**, scripts/test.mjs, and reports/muse/**. Read other files freely.
The disposable S1 fixture is an explicit later exception, after product freeze.
Never modify the frozen spec or legacy files. Do not initialize Git here.

## M0 — baseline and contract checkpoint

1. Confirm instructions and exact current tree. Record SHA-256 of existing
   legacy files and planning documents in reports/muse/baseline.json; do not
   read/store secrets or environment values. Record Node/npm versions and
   displayed model/effort if available.
2. Create package/tooling exactly as PLAN.md. Install only fixed dependency
   families and pin resolved patches. Record installation completion so Flash
   knows it can run tests. No npm postinstall hooks.
3. Implement exported data types, discriminated request/response unions, and
   complete strict validation from CONTRACT.md. Split schemas by domain if
   helpful; re-export from contracts.ts. Export parseRequest for the CLI and
   revalidate inputs in execute. Input schemas are pure and never open SQLite.
4. Add schema tests for valid operations, omitted required fields, unknown
   keys, nested limits, invalid paths/IDs, and mutually incompatible envelope
   fields. This checkpoint must not contain production fake success results.
5. Add test discovery script and fingerprint helper. Verify test:core and a
   focused compilation of your contract modules. Full build can wait for the
   client. Publish bootstrap.json with contractHash, installedVersions, checks.

After this checkpoint, exported types are frozen. Private implementation may
change freely inside ownership. If the spec is ambiguous enough to block a
public type, report the exact ambiguity before publishing the checkpoint.

## M1 — storage and project identity

Implement openCore, versioned migrations, database lifecycle, transaction helper,
request receipts, project and agent registration, task creation/get/list.
Keep Git discovery in src/evidence; all subprocesses are read-only argument-array
calls with timeouts. Do not copy worktree creation/integration logic from Blackboard.

Tables may be implemented together in migration 001, but test behavior one domain
at a time. Use real temporary Git repositories and SQLite files. Cover A01–A03
and receipt collision/replay basics in A07. Close connections in finally blocks.

Checkpoint: reopen DB retains rows, canonical worktree identity is stable,
cross-project lookups reveal nothing, duplicate registration is deterministic.

## M2 — claims and transitions

Implement task claim/renew/release/cancel, dependency gating, and attempt-scoped
leases. No daemon, heartbeats, scheduler, or UI. Use fixed 2h lease and injected
clock only in tests. Build A04–A06, cancellation state tests, and A23.

Checkpoint: actual competing Node processes produce one owner. Old attempts
cannot mutate reclaimed tasks. At exact expiry the old token is invalid.
No success-only in-memory simulations accepted as race coverage.

## M3 — handoffs and completion

Implement evidence observation, completed handoffs, receipt-first retries,
atomic state/handoff/receipt writes, and private test fault injection.
Implement blocked handoff/reopen state transitions together with M4's questions;
do not create temporary alternate semantics visible to Flash.

Cover A08–A11. Test killed/failed transaction recovery by reopening the DB,
not merely inspecting an in-memory object. Test original claim receipt replay
does not renew a lease or grant a second attempt. Do not run reported checks.

Checkpoint: completed handoff is durable, exactly once per attempt; retries work
even after the original checkout disappears; cancellations win correctly.

## M4 — questions, inbox, decisions, context

Implement questions/one answer, inbox events/cursors, blocked handoff/reopen,
decision supersession, and bounded project-scoped context selection. Export
work/review snapshot types exactly as the contract. Core must omit review prose
before it reaches JSON output; hiding it only in Markdown is insufficient.

Cover A12–A15 and core selection portions of A18/A19. Check concurrent answer
and supersession writes, optional unanswered questions on completed tasks, and
missing registered checkout during context retrieval.

Checkpoint: answer records survive restarts, blocked task needs explicit reopen,
and context requires no global history scan or prompt generation by an LLM.

## M5 — core-ready handoff

Run test:core. Run typecheck/build when Flash's files are ready enough; otherwise
record exact client dependency errors without declaring global checks passed.
Inspect actual transaction boundaries against A01–A15/A23, then publish
reports/muse/core-ready.json with contractHash, coverage map, check results,
known limits, and milestone=M5. No stubbed operations remain in core.

While Flash integrates, investigate its exact integration findings and repair only
your ownership. Reissue readiness after changes. Do not repeatedly broaden tests
without a change or unresolved concern. Never change shared types to fit a bug.

## M6 — Grok review, owner repairs, and final gate

Wait for reports/flash/client-ready.json; complete owned checkpoint work first.
Run your integrated checks, then freeze edits and pause shared build/check runs
while Grok reviews. Follow PLAN.md's dependency-wait rules.

Read reports/grok/findings.json. For findings targeted to Muse, implement the
smallest correct fix in your owned files and run the indicated regression checks.
Grok's suggested fix is guidance: if it is technically wrong, explain the evidence
and propose an alternative satisfying the same contract. Never edit Grok's
ledger or mark its finding closed. Optional suggestions need separate scope
authorization. After two failed repair rounds, report a blocker with evidence.

Reissue core-ready after repairs and refreeze so Grok can rerun checks. Require
reports/grok/review.json verdict=pass for the current final fingerprint. Record
that fingerprint in your final report; do not write your own review.json. Any
covered edit invalidates the verdict. Check legacy/planning baseline hashes.
Attempt S1 only after Grok's software pass; fixture edits do not change the
application fingerprint.

## Required final report

Write reports/muse/final.md with:
- completed M IDs and owned files;
- A-test coverage links and exact check outcomes;
- Grok findings, applied fixes, and final reviewed fingerprint;
- Blackboard code provenance or an explicit 'no code copied';
- actual field-test evidence or precise remaining steps;
- no claim that code was committed/published or all providers were verified.

Finish the software goal only after Grok's review and the integrated suite pass.
If external dependency waiting prevents that, leave a resumable WAITING/BLOCKED
checkpoint and state the missing milestone, not a misleading completion report.
