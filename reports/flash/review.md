# Independent Peer Review: Muse Core & Storage Implementation

**Reviewer:** AGY Gemini 3.8 Flash (effort: high)  
**Target:** Muse Spark 1.3 (xhigh requested) — Core & Storage Modules  
**Reviewed Artifacts:** `src/core/**`, `src/storage/**`, `src/evidence/**`, `tests/core/**`, `tests/storage/**`  
**Workspace Fingerprint:** `e1b1bcb72615e2ffcec3444011531bfbe1904cb475f01fc1c6fb6fba8a3e0abb`  
**Contract Hash:** `783540612d791e6835b5e91a64f8bd40c749ed1374da33df6828dfc4d2eaf0ba`  
**Verdict:** **PASS** (0 blockers, 0 majors, 0 contract violations)

---

## Executive Summary

Flash conducted an independent, line-by-line review of the database lifecycle, transaction boundaries, receipt-replay mechanisms, claim lease semantics, Git observation gathering, and context selection authored by Muse. 

All 122 core tests and 9 multi-process acceptance tests pass cleanly without failures or skips. The implementation adheres strictly to `CONTRACT.md`, `PLAN.md`, and `ACCEPTANCE.md`.

---

## Detailed Evaluation by Acceptance Scenario

### 1. Storage Lifecycle & Concurrency (A01, A23)
- **Files:** `src/storage/db.ts`, `src/storage/schema.ts`
- **Verification:**
  - `openDatabase` enforces `0700` permissions on the directory and `0600` on `company.sqlite3`.
  - Foreign keys are explicitly enabled (`PRAGMA foreign_keys = ON`), WAL journal mode is set (`PRAGMA journal_mode = WAL`), and busy timeout is configured to 5000 ms (`PRAGMA busy_timeout = 5000`).
  - Schema migration is versioned and applied inside a `BEGIN IMMEDIATE` transaction; lock contention surfaces as `CoreOpenError("BUSY", ...)` and maps cleanly to exit code 6.
  - Multi-process concurrent initialization preserves data and executes migrations idempotently.

### 2. Project Identity & Git Common Directory (A02)
- **Files:** `src/evidence/git.ts`, `src/core/operations/register.ts`
- **Verification:**
  - `discoverProject` executes `git rev-parse --git-common-dir` using argument arrays without invoking a shell.
  - Both main worktrees and linked worktrees resolve to the identical canonical `gitCommonDir` via `realpathSync`, ensuring consistent project identity across worktrees.
  - Symlink aliases resolve to the same project root; independent clones have distinct common dirs and produce distinct project records. Non-Git roots are safely rejected with `OpError.validation`.

### 3. Entity Isolation & Security (A03)
- **Files:** `src/core/operations/common.ts`, `src/core/operations/tasks.ts`, `src/core/operations/context.ts`
- **Verification:**
  - All read and mutation queries strictly filter by `project_id`.
  - Queries querying an entity ID under an incorrect project return `NOT_FOUND` without indicating whether the entity exists in another project.
  - Context selection and inbox listing never cross project boundaries.

### 4. Claims, Leases, and State Transitions (A04, A05, A06, A10)
- **Files:** `src/core/operations/claims.ts`, `src/core/operations/tasks.ts`
- **Verification:**
  - Leases are attempt-scoped with a duration of 2 hours (`LEASE_MS = 7,200,000`).
  - Lease validity check evaluates `row.lease_until > nowMs`. At exact expiry (`leaseUntil <= nowMs`), the claim is strictly expired.
  - Competing claims execute inside `withMutation` (`BEGIN IMMEDIATE`), guaranteeing that exactly one claimant wins with `attempt = attempt + 1` while concurrent contenders receive `CONFLICT`.
  - Dependency gating blocks claims on tasks whose prerequisites have not reached `completed` status.
  - Terminal tasks (`completed`, `cancelled`) reject subsequent claim, renew, or release attempts.

### 5. Completed & Blocked Handoffs and Git Evidence (A08, A09, A11, A12)
- **Files:** `src/core/operations/handoffs.ts`, `src/evidence/git.ts`
- **Verification:**
  - Git observations (`observeCheckout`) run strictly outside the SQLite write transaction to prevent long locks during process execution.
  - `readReceipt` is invoked **before** Git collection in `submitHandoff`, enabling identical retries to succeed even if the checkout directory has been removed or HEAD has moved (A09).
  - Reported HEAD and dirty flags are strictly validated against the freshly collected observation; any discrepancy rejects the handoff with `CONFLICT` without modifying task state.
  - Handoff creation, task status update, and mutation receipt write occur atomically inside `transactMutation`. Rollback on simulated fault boundaries was verified using SQLite database reopen tests.
  - Blocked handoffs require >= 1 unanswered blocking question; task status changes to `blocked` and the claim lease is cleared. Reopen verifies that all blocking questions have recorded answers in the `answers` table before returning the task to `open`.

### 6. Questions, Answers, and Inbox Events (A13, A14)
- **Files:** `src/core/operations/messages.ts`
- **Verification:**
  - Asking a question emits an inbox event to `toAgentId`. Retries with identical request IDs replay the existing question and do not create duplicate events.
  - Answering is restricted to the addressed agent (`question.to_agent_id === request.actorId`). The `answers` table has a primary key on `question_id`, preventing multiple winning answers. Answering generates an inbox event to `question.from_agent_id`.
  - `listInbox` reads events with `id > after` ordered by `id ASC LIMIT limit + 1`. It never mutates or consumes events; cursors remain stable across repeated calls.

### 7. Architectural Decisions & Supersession (A15)
- **Files:** `src/core/operations/decisions.ts`
- **Verification:**
  - Decisions are immutable historical records.
  - Supersession enforces single active chains: `UPDATE decisions SET superseded_by_id = ? WHERE id = ? AND superseded_by_id IS NULL`. If `changes !== 1`, it fails with `CONFLICT`, preventing races between concurrent supersession attempts.

### 8. Request Receipts & Idempotency (A07)
- **Files:** `src/storage/receipts.ts`, `src/core/operations/common.ts`
- **Verification:**
  - Canonical request hashing sorts keys recursively while preserving array ordering.
  - Identical retries return cached responses verbatim without side effects.
  - Reusing a request ID with a different operation or payload throws `CONFLICT`.
  - Receipt identity scopes keys by `(projectId, actorId)` for mutations, ensuring independence across agents and projects.

---

## Test Suite Execution Results

| Check | Command | Exit Code | Result Summary |
|---|---|---|---|
| Core Suite | `npm run test:core` | 0 | 122 tests passed across 33 suites (0 failures, 0 skipped) |
| Client Suite | `npm run test:client` | 0 | 35 tests passed across 6 suites (0 failures, 0 skipped) |
| Acceptance Suite | `npm run test:acceptance` | 0 | 9 tests passed across 2 suites (0 failures, 0 skipped) |
| Full Suite | `npm run check` | 0 | 166 tests passed across 41 suites, TypeScript clean, build clean |
| Standalone CLI | `node dist/cli/main.js --help` | 0 | Clean execution from foreign cwd `/tmp` |

---

## Conclusion

The core and storage implementation satisfies all functional and non-functional requirements specified in `CONTRACT.md` and `ACCEPTANCE.md`. The independent review verdict is **PASS**.
