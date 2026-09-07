# Independent follow-up review — 2026-09-05

Verdict: **changes required before a real-project pilot**.

Reviewed source fingerprint:
`0ef592a36e579ab88f440807ca4a4cb12963ff7081cc223597eaa779e192654b`
(92 covered entries). Independently recomputed with a separate Python traversal,
then checked with the repository helper. It matches Grok's final pass and remained
unchanged during this inspection. No product source or tests were edited.

## Verification and current status

- Independently ran `npm run check`: typecheck/build passed; **169 tests passed,
  41 suites, zero failed, skipped or cancelled**. See `check.log`.
- Inspected core routing, transaction/receipt helpers, claims, handoffs, Git
  evidence, context selection, questions/inbox, CLI validation/output/instructions,
  test support, Grok's findings and implementer reports.
- Added temporary-fixture reproductions, not product fixes. See `reproduce.mjs`
  and `reproduce.log`. The diagnostic exits successfully when observations are
  collected; exit 0 is NOT an assertion that the defects are fixed.
- Grok found and verified three real earlier defects. His current pass is tied
  to the correct source tree, but the four cases below remain uncovered.
- S1 actual Muse/Flash/fresh-session evidence is still pending. Node subprocess
  tests establish persistence/protocol behavior, not provider compliance.
- Flash's final report/client-ready still use `9113834e...`, preceding the latest
  Muse repair. Muse's final.md is absent and progress still waits for Grok's
  already-written verdict. The final delivery records need reconciliation.

## CODEX-001 — P1: another repository can complete this project's task

Owner: Muse.

Location: `src/core/operations/handoffs.ts:134`, particularly the project lookup
at line 136 and head/dirty checks at lines 156–160; `src/evidence/git.ts:47`.

Trigger: register repo A, create and claim its task, then submit a completed
handoff with checkoutRoot pointing to unrelated repo B and B's accurate head/dirty.

Observed: success; A's task becomes completed with B's evidence. The reproduction
uses two freshly initialized repositories, including a separate commit in B.

Expected: reject the handoff without changing the task, inserting a handoff, or
recording success. CONTRACT.md explicitly requires a checkout of this project;
this is not just an optional enhancement to agent-reported file assertions.
Grok listed this case as optional; I disagree with that classification.

Suggested fix: retain receipt-first replay, then collect canonical checkout
identity and compare its Git common-directory realpath with the registered
project's identity. Accept linked worktrees of that project. Reject unrelated
repositories and independent clones, even when their HEAD hashes happen to match.
Do not hold a database transaction during Git subprocesses. Preserve project-
scoped NOT_FOUND behavior for missing IDs and receipt replay after checkout removal.

Required regression checks: different repo rejected, independent clone with same
HEAD rejected, same-project worktree accepted, no partial task/handoff/receipt on
failure, and exact successful retry still works after checkout removal.

## CODEX-002 — P1: waiting operations can use an expired lease

Owner: Muse.

Location: `src/core/dispatch.ts:49`, `src/core/operations/common.ts:143`,
`src/core/operations/claims.ts:101`, `src/core/operations/handoffs.ts:141`.

Trigger: a renewal begins before expiry, waits behind another process's SQLite
write lock, then obtains the lock after expiry.

Observed in the first reproduction: renewal started 1479 ms before expiry,
finished 1053 ms after expiry, and succeeded. The diagnostic uses the existing
test clock injection to create a near-expiry claim, then real wall time and an
independent process holding the lock for 2500 ms. No direct task-row manipulation.

Root cause: dispatch captures nowMs once before waiting; predicates inside the
write transaction compare against that old timestamp. Handoff observation also
runs after the clock capture and before the lease check, widening the gap. The
renewal failure is directly reproduced; other token operations share the pattern.

Suggested fix: pass the existing injectable clock through internal mutation
plumbing and sample it after acquiring the write transaction, immediately before
state/lease checks. Use that time for lease transitions and mutation timestamps.
Keep observation timestamps separate and meaningful. Preserve the public
openCore/execute API, strict expiry equality, and receipt-first exact replay.

Required regression checks: a real competing process holds a lock across expiry;
renew, release and new handoff must return STALE_CLAIM with no effects. Exercise
delay during evidence observation as well. Claims granted after a lock wait get
their full lease from acquisition time. Exact retries of recorded successes still
replay even after expiry; they do not silently renew ownership.

## CODEX-003 — P2: Git observation changes the user's index

Owner: Muse.

Location: `src/evidence/git.ts:24`, Git status calls at lines 63 and 93.

Trigger: change a tracked file's mtime without changing its contents, then invoke
observeCheckout. The working tree remains content-clean.

Observed: dirty=false, but `.git/index` SHA-256 changes. Git status refreshes
cached stat information because optional locking/writes are enabled.

Expected: the existing index and worktree remain unchanged by observation, as
required by A22 and the product's read-only Git collection contract.

Suggested fix: disable Git optional locks for observation subprocesses using
the supported Git mechanism (e.g. global `--no-optional-locks`), retaining
argument-array execution and existing timeouts. Apply consistently to checkout
and current-project observations. Do not change users' Git configuration.

Required regression checks: save index bytes, touch tracked-file metadata only,
observe checkout and retrieve context, assert clean state and identical index
bytes; repeat for a linked worktree's actual index path. Existing evidence
collection, SHA-256 repositories and foreign-cwd scenarios must still pass.

## CODEX-004 — P2: the published field exercise's handoff is invalid

Owner: Flash.

Location: `examples/two-agent/README.md:66`.

The math.test.js file entry has an extra `"math.test.js":"modified"` key in
addition to path/change. The strict evidence schema rejects it with
unrecognized_keys at files[1]. The actual published entry was checked against
EvidenceInputSchema. Following the walkthrough literally stops at A's handoff.

Suggested fix: remove the extra key and validate all walkthrough request examples
against the actual schemas after substituting fixture IDs/evidence. Also make
commands work when the session is editing inside the fixture checkout: use the
absolute built entry or an explicit package prefix. State the required import
for the example test so the test is independently runnable.

Required regression check: execute the documented protocol against a disposable
fixture using the actual example payloads. This verifies instructions only;
leave S1 pending until real provider sessions complete it.

## Follow-up order

1. Muse repairs CODEX-001/002/003 inside existing core/evidence/test ownership.
   Flash repairs CODEX-004 inside examples/acceptance/docs ownership. The two
   owners may work concurrently, preserving the frozen public contract.
2. Grok independently reruns each reproduction and full checks, then issues a
   new verdict for the new fingerprint. Treat these as new findings with their
   own two-round repair cap. Preserve his previous review as historical evidence;
   never silently relabel its optional checkout finding as already fixed.
3. Muse writes its missing final report. Flash refreshes its final/client-ready
   records. Both match Grok's new fingerprint and report actual check results.
4. Run S1 in actual user-launched Muse and Flash sessions, then a fresh session
   with only project/task/home IDs. Record commands and handoff/question/answer
   IDs. This is the next product validation milestone.
5. Trial one real project over several tasks. Track repeated explanations,
   incorrect or missing handoffs, duplicate investigation, manual steps, and
   whether the next agent correctly resumes. Preserve disjoint files/worktrees.
6. Use that evidence to prioritize CLI ergonomics and supported per-CLI
   instruction installation. For example, current human inbox output shows event
   IDs but omits message bodies; the generic snippet doesn't request JSON, so
   retrieving the actual question requires another step. Fix observed friction
   before expanding to background scheduling or a dashboard.

Grok's optional test-quality notes also remain useful: replace the tautological
fingerprint assertion and turn the full foreign-cwd/worktree reproduction into
a durable named acceptance test. These are smaller than the correctness fixes.

## Suggested continuation prompts

Muse:

```text
/goal Repair CODEX-001, CODEX-002 and CODEX-003 in /Users/mnz/dev/agent-company/reports/codex/review.md. Read the existing frozen implementation plan and retain Muse ownership. Use the saved diagnostic and add meaningful regression tests for each finding. Preserve receipt replay, public contracts, other workers' edits and legacy files. Do not apply Flash fixes. Run focused checks, publish repaired readiness, and freeze for Grok's independent recheck. No product publication. Record a final report matching Grok's new fingerprint only after review passes.
```

Flash:

```text
/goal Repair CODEX-004 in /Users/mnz/dev/agent-company/reports/codex/review.md within existing Flash ownership. Validate the real documented wire payloads and make the disposable walkthrough runnable from the editing checkout. Do not label protocol tests as live S1 verification. Preserve the frozen contract, core code and legacy files. Run focused acceptance checks, publish readiness and freeze for Grok. After his new pass, update your final/client-ready reports to its fingerprint. No product publication.
```

Grok:

```text
/goal Reopen Agent Company's independent review using /Users/mnz/dev/agent-company/reports/codex/review.md and your existing GROK-GOAL.md. Independently assess CODEX-001 through CODEX-004 against the frozen contract, then verify the owner repairs. Your previous pass matches the inspected source but misses these cases; the wrong-repository handoff is a contract requirement, not merely an optional suggestion. Do not edit product files or tests. Run regression reproductions and the full suite on the frozen repaired candidate, issue a new fingerprint-bound verdict, and keep live S1 evidence separate. Save reports in reports/grok and preserve historical review evidence.
```
