# S1 Field Exercise Report

**Owner:** Flash (Gemini 3.8 Flash, high)  
**Date:** 2026-09-06  
**Fixture Tooling:** `examples/two-agent/setup.mjs`, `examples/two-agent/README.md`  
**Status:** Protocol & Fixture Verified / Live Provider Execution Pending User Session Launch

---

## 1. Disposable Fixture Verification

The setup tool `examples/two-agent/setup.mjs` was tested in a disposable fixture directory (`/tmp/test-s1-setup-fixture`):
- Cleanly initialized a disposable Git repository with initial commit.
- Registered project identity (`project register`).
- Registered `muse` and `flash` agents (`agent register`).
- Created root Task A (assigned to Muse) and dependent Task B (assigned to Flash, depends on A).
- Outputted generated IDs, `packageRoot`, and `cliBin` to `ids.json`.
- Refused to overwrite an existing non-empty directory when re-run.
- Fixture was cleanly cleaned up after verification.

---

## 2. Multi-Process Protocol Verification (Automated Gate)

The multi-process interaction sequence specified by S1 was tested end-to-end in `tests/acceptance/full-integration.test.ts`:
1. Independent Node subprocesses running against an SQLite database in WAL mode.
2. Agent A claims Task A and submits a completed handoff with verified Git commit evidence.
3. Agent B claims dependent Task B.
4. Agent B asks Agent A a clarification question and submits a blocked handoff.
5. Task status transitions to `blocked`; claim lease is cleared.
6. Agent A lists its inbox using `inbox list` with pagination cursor and submits an answer via `question answer`.
7. Agent B receives notification in inbox, calls `task reopen` (succeeds only because question is answered).
8. Agent B claims Task B under attempt 2, implements changes, and submits completed handoff.
9. All records persist across process termination and remain fully retrievable by fresh processes using explicit IDs and `--home`.

---

## 3. CODEX-004 Walkthrough Payload & Checkout CWD Verification

In response to CODEX-004, `examples/two-agent/README.md` was repaired and verified in `tests/acceptance/two-agent-walkthrough.test.ts`:
- **Payload Schema Conformance:** Removed the extraneous `"math.test.js": "modified"` key from the evidence files array in Task A handoff. All walkthrough request payloads strictly conform to `parseRequest` and `EvidenceInputSchema`.
- **Independently Runnable Tests:** Stated explicit test imports (`import { subtract, add }` and `import { subtract, add, multiply }`) in `math.test.js` so fixture unit tests run without `ReferenceError`.
- **Foreign CWD Invocations:** Documented and verified using the absolute built entry (`node .../dist/cli/main.js`) and explicit package prefix (`npm run --prefix ...`) so CLI commands run cleanly when the terminal working directory is inside the fixture repo (`/tmp/agent-company-s1/repo`).
- **End-to-End Walkthrough Automation:** `tests/acceptance/two-agent-walkthrough.test.ts` executes the exact walkthrough sequence against a disposable fixture from the checkout cwd.

---

## 4. Live Provider Execution Status

Per `ACCEPTANCE.md` (lines 125-130) and `PLAN.md` (lines 232-235):
> "Do not launch extra model sessions from worker scripts... If live provider integration is unavailable, report software complete / field verification pending. Do not fake a transcript or mark S1 passed."

Because Flash is executing as an autonomous paired agent within Antigravity without authorization to spawn external provider interactive sessions or simulate user terminal interactions, the live provider interactive steps remain **pending user launch** of the respective external sessions using the exact steps documented in `examples/two-agent/README.md`.

