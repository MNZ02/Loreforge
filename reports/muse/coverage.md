# Muse A-test coverage (core side)

Concrete test paths/names for every mandatory scenario. Muse owns A01–A15,
A23, and the A25 helper; Flash owns the CLI/rendering/integration scenarios
(A16–A22, A24, A26) with shared rows noted. All paths are workspace-relative.

| ID | Muse test file :: test name | Notes |
|---|---|---|
| A01 | tests/storage/lifecycle.test.ts :: initializes twice, preserves data, and keeps one schema version | reopen retains rows; single migration version |
| A01 | tests/storage/lifecycle.test.ts :: initializes from two processes concurrently without losing data | IPC gate barrier; two independent processes, one schema version |
| A01 | tests/storage/lifecycle.test.ts :: enables foreign keys, uses a private database file, and guards schema | FK enforced, 0600/0700 perms |
| A02 | tests/storage/projects.test.ts :: maps a root and its real worktree to one project | same git common dir |
| A02 | tests/storage/projects.test.ts :: treats symlink aliases as the same project | realpath identity |
| A02 | tests/storage/projects.test.ts :: treats an independent clone as a different project | distinct common dirs |
| A02 | tests/storage/projects.test.ts :: rejects non-Git and missing roots without mutating | VALIDATION, no receipt cached |
| A03 | tests/storage/tasks.test.ts :: reveals nothing across projects | get/create/list/actor under wrong project; no content leak |
| A03 | tests/storage/messages.test.ts :: rejects questions on terminal tasks and foreign question IDs | wrong-project answer is NOT_FOUND |
| A03 | tests/storage/context.test.ts :: rejects foreign tasks without leaking | wrong-project context is NOT_FOUND |
| A03 | Flash integration | inbox/context cross-project CLI checks (Flash-owned) |
| A04 | tests/storage/claims.test.ts :: two processes claiming at once produce exactly one owner | IPC gate; attempt=1; replay returns original token |
| A05 | tests/storage/claims.test.ts :: expires at exactly 2h | renew/release at exact expiry STALE; reclaim attempt+1; old tokens dead |
| A05 | tests/storage/context.test.ts :: reclaimed tasks complete once | late original token STALE; exactly one handoff |
| A06 | tests/storage/claims.test.ts :: renews before expiry, releases cleanly, and reclaims | lease extension; release clears; attempt retained |
| A06 | tests/storage/claims.test.ts :: blocks claims until dependencies complete | unmet deps CONFLICT; live double-claim CONFLICT |
| A06 | tests/storage/context.test.ts :: unblocks dependent claims once the dependency completes | completion tail |
| A07 | tests/storage/tasks.test.ts :: replays identical retries and conflicts on changed payloads | same hash replays; changed payload/operation CONFLICTS |
| A07 | tests/storage/tasks.test.ts :: scopes identical keys independently by actor and project | scope/actor isolation |
| A07 | tests/storage/tasks.test.ts :: does not cache failed requests | failure leaves no receipt |
| A07 | tests/storage/claims.test.ts :: two processes replaying one key get the identical original result | concurrent duplicate race |
| A08 | tests/storage/handoffs.test.ts :: commits task, handoff, and receipt atomically | exactly-once-per-attempt; replay durable |
| A08 | tests/storage/handoffs.test.ts :: rolls back every effect when a write boundary fails, verified by reopen | fault seam at handoff.task/row/receipt; DB reopened |
| A09 | tests/storage/handoffs.test.ts :: replays after the checkout is removed | no new Git collection |
| A09 | tests/storage/handoffs.test.ts :: replays after HEAD moves on | observation pinned to receipt |
| A10 | tests/storage/handoffs.test.ts :: exactly one terminal winner across two processes | cancel CONFLICT vs handoff STALE by outcome |
| A11 | tests/storage/handoffs.test.ts :: rejects mismatching head or dirty without completing | task stays claimed |
| A11 | tests/storage/handoffs.test.ts :: rejects new handoffs when observation fails and never runs checks | sentinel file never created |
| A12 | tests/storage/messages.test.ts :: releases claim, requires answers, then reclaims and completes | blocked→answer→reopen→attempt 2→complete; optional Q&A allowed |
| A13 | tests/storage/messages.test.ts :: retries yield one question and one event each | single question/answer/event on replay |
| A13 | tests/storage/messages.test.ts :: rejects wrong recipients and concurrent double answers | two-process answer race; restart persistence |
| A13 | tests/storage/messages.test.ts :: rejects questions on terminal tasks and foreign question IDs | answers allowed post-terminal |
| A14 | tests/storage/messages.test.ts :: pages without loss or duplication and never consumes | cursor paging; empty page preserves cursor |
| A15 | tests/storage/decisions.test.ts :: keeps immutable history with project-scoped single-active chains | double supersession CONFLICTS |
| A15 | tests/storage/decisions.test.ts :: scopes supersession targets to their own project | cross-project CONFLICT, no leak |
| A15 | tests/storage/context.test.ts :: selects task, dependencies, handoffs, questions, and relevant decisions | superseded decisions absent from selection |
| A16 | tests/core/schemas.test.ts + tests/core/schemas-limits.test.ts (Muse schemas) | valid ops, required fields, unknown keys, limits, paths/IDs, envelope rules, sanitized details |
| A16 | Flash-owned CLI tests | malformed/oversize transport, exit codes |
| A18 | tests/storage/context.test.ts :: selects task… / orders unanswered… / caps… | selection, caps, omitted counts, determinism |
| A18 | Flash-owned rendering tests | budgets 4000/16000/32000, truncation |
| A19 | tests/storage/context.test.ts :: omits prose and Q&A from selection | review policy at selection, not just rendering |
| A19 | Flash-owned rendering tests | review text output |
| A23 | tests/storage/busy.test.ts :: returns bounded BUSY with no partial write, then succeeds on retry | cross-process holder; 5s bound; retry wins |
| A25 | tests/core/fingerprint.test.ts (Muse helper) | stability, change detection, order-independence, symlink refusal, coverage exclusions |
| A25 | Both final reviews | fingerprint match at M6 |

Not Muse-owned and not mapped here: A17, A20, A21, A22, A24, A26 (Flash).
M3 checkpoint extras: tests/storage/handoffs.test.ts :: replaying the original
claim never renews the lease or adds an attempt; guards blocked/completed
outcome mismatches before questions exist.

Codex follow-up findings (Muse-owned; CODEX-004 is Flash):
| CODEX-001 | tests/storage/handoffs.test.ts :: rejects handoffs from an unrelated repository without effects | foreign checkout CONFLICT; no task/handoff/receipt effects; own-repo retry succeeds |
| CODEX-001 | tests/storage/handoffs.test.ts :: rejects an independent clone even when HEAD matches | same HEAD, different common dir still CONFLICT |
| CODEX-001 | tests/storage/handoffs.test.ts :: accepts a linked worktree of the registered project | same common dir completes |
| CODEX-002 | tests/storage/claims.test.ts :: renew, release, and handoff that wait behind a lock across expiry are STALE | real lock holder + wall-moving clock; STALE_CLAIM, row unchanged |
| CODEX-002 | tests/storage/claims.test.ts :: a claim granted after a lock wait starts its full lease at acquisition | lease start >=1.5s after dispatch under 3s hold |
| CODEX-002 | tests/storage/claims.test.ts :: an exact retry of a recorded renew replays after expiry | replay returns recorded lease; no ownership change |
| CODEX-003 | tests/storage/handoffs.test.ts :: leaves the Git index untouched during observation | mtime-only touch; index bytes identical after submit+context+worktree observe |
