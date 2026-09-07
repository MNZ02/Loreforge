# Agent Company v0.1 — Flash Implementation Final Report

**Owner:** Flash (AGY Gemini 3.8 Flash, effort: high)  
**Date:** 2026-09-06  
**Workspace:** `/Users/mnz/dev/agent-company`  
**Software Acceptance Gate:** **PASSED**  
**Final Workspace Fingerprint:** `6596c5c536478d39deabb9379674fbcd7c2d9127c9436aa78dac5b4f4667968d`  
**Contract Hash:** `783540612d791e6835b5e91a64f8bd40c749ed1374da33df6828dfc4d2eaf0ba`  

---

## 1. Completed Milestones

| Milestone | Description | Artifacts Produced | Status |
|---|---|---|---|
| **F0** | Contract fixtures, wire examples, instructions template, acceptance checklist | `examples/inputs/*.json` (19 files), `templates/instructions.template.md`, `tests/acceptance/checklist.md`, `reports/flash/progress.json` | **Complete** |
| **F1** | Deterministic context renderer (4000..32000 char budget, review mode prose omission, ANSI safety) | `src/context/render.ts`, `tests/context/render.test.ts`, `tests/context/fixtures/sample-snapshots.ts` | **Complete** |
| **F2** | CLI argument parsing, 64 KiB bounded input, output formatting, home resolution, error mapping | `src/cli/args.ts`, `src/cli/input.ts`, `src/cli/output.ts`, `src/cli/home.ts`, `src/cli/main.ts`, `tests/cli/*.test.ts` (35 unit tests) | **Complete** |
| **F3** | Instructions generator, documentation, integrations table, two-agent S1 setup tool | `src/cli/instructions.ts`, `src/integrations/index.ts`, `README.md`, `docs/usage.md`, `docs/integrations.md`, `examples/two-agent/setup.mjs`, `examples/two-agent/README.md` | **Complete** |
| **F4** | Multi-process acceptance test suite (A03, A12, A14, A16, A17, A21, A22, A24, A26) | `tests/acceptance/cli-basics.test.ts`, `tests/acceptance/full-integration.test.ts` (9 acceptance tests) | **Complete** |
| **F5** | Client-ready publication, independent code review of Muse, final software gate verification | `reports/flash/client-ready.json`, `reports/flash/coverage.md`, `reports/flash/review.json`, `reports/flash/review.md`, `reports/flash/field-test.md`, `reports/flash/final.md` | **Complete** |
| **Repairs** | Fixed GROK-002: protected non-optional header and dependency IDs/statuses at 4000 budget | `src/context/render.ts`, `tests/context/render.test.ts` (new regression test) | **Complete** |
| **CODEX-004** | Repaired walkthrough handoff schema, runnable commands from checkout cwd, test imports | `examples/two-agent/README.md`, `examples/two-agent/setup.mjs`, `tests/acceptance/two-agent-walkthrough.test.ts`, thickened `tests/acceptance/cli-basics.test.ts` | **Complete** |

---

## 2. Flash Owned Files

All modifications were strictly confined to Flash ownership boundaries without altering legacy files (`agents/`, `orchestrator/`), frozen planning documents, or Muse-owned files:
- **CLI Implementation:**
  - `src/cli/args.ts` — Command-line argument parsing and operation validation.
  - `src/cli/home.ts` — Home directory resolution and missing-state check.
  - `src/cli/input.ts` — Streaming 64 KiB bounded input reader with encoding validation.
  - `src/cli/instructions.ts` — Protocol instruction snippet generator with shell-safe quoting.
  - `src/cli/output.ts` — Single-line JSON stdout and human-readable output formatting.
  - `src/cli/main.ts` — CLI entry point, dispatch routing, and error exit mapping.
- **Context Renderer:**
  - `src/context/render.ts` — Pure deterministic context renderer with 4000..32000 char budget, review-mode prose exclusion, terminal safety, and binary search title shortening for dependency ID/status preservation.
- **Integrations:**
  - `src/integrations/index.ts` — Programmatic exports for context rendering and instructions.
- **Tests:**
  - `tests/cli/args.test.ts`
  - `tests/cli/input.test.ts`
  - `tests/cli/instructions.test.ts`
  - `tests/cli/main.test.ts`
  - `tests/cli/output.test.ts`
  - `tests/context/render.test.ts`
  - `tests/context/fixtures/sample-snapshots.ts`
  - `tests/acceptance/checklist.md`
  - `tests/acceptance/cli-basics.test.ts`
  - `tests/acceptance/full-integration.test.ts`
  - `tests/acceptance/two-agent-walkthrough.test.ts`
- **Documentation & Templates:**
  - `README.md` — Project overview, architecture, and CLI usage.
  - `docs/usage.md` — Comprehensive CLI operation reference with concrete JSON examples.
  - `docs/integrations.md` — Provider capability table and integration instructions.
  - `templates/instructions.template.md` — Generic session instructions template.
  - `examples/README.md` — Wire example catalog.
  - `examples/inputs/*.json` — 19 validated JSON payload fixtures covering all operations.
  - `examples/two-agent/setup.mjs` — Disposable S1 fixture initialization script.
  - `examples/two-agent/README.md` — Multi-agent field exercise guide.
- **Reports:**
  - `reports/flash/client-ready.json`
  - `reports/flash/progress.json`
  - `reports/flash/coverage.md`
  - `reports/flash/findings.json`
  - `reports/flash/review.json`
  - `reports/flash/review.md`
  - `reports/flash/field-test.md`
  - `reports/flash/final.md`

---

## 3. Concrete Test Coverage & Check Outcomes

### Full Integrated Suite (`npm run check`)
- **Command:** `npm run check`
- **Exit Code:** `0`
- **TypeScript Check:** `tsc --noEmit` — Clean over `src` and `tests` (0 errors).
- **Build:** `tsc -p tsconfig.build.json` — Clean compilation of `src/` to `dist/`.
- **Test Execution:**
  - Total Tests: **178**
  - Total Suites: **45**
  - Passed: **178**
  - Failed: **0**
  - Skipped: **0**
  - Cancelled: **0**
  - Duration: ~23.8 seconds

### Individual Test Suites
- `npm run test:core`: **131 passed**, 36 suites, 0 failed, 0 skipped (including CODEX-001/002/003 tests).
- `npm run test:client`: **36 passed**, 6 suites, 0 failed, 0 skipped.
- `npm run test:acceptance`: **11 passed**, 3 suites, 0 failed, 0 skipped (including CODEX-004 walkthrough and thickened A26).
- `reports/grok/repro-a18-render.mjs`: **exit 0** (0 missing dependency IDs, length <= 4000).
- `reports/grok/repro-sha256-head.mjs`: **exit 0** (SHA-256 64-hex head supported).
- `reports/codex/reproduce.mjs`: **exit 0** (`publishedEntryPresent: false` verifying clean schema).

### Foreign CWD Verification (A26)
- **Command:** `node /Users/mnz/dev/agent-company/dist/cli/main.js` executed from foreign cwd against an explicit temp home and two worktree paths of one repository.
- **Exit Code:** `0`
- **Result:** CLI successfully displays help and registers both the root and worktree to the same project without dependencies on local working directory files.

---

## 4. Review Findings & Resolution

- **`MUSE-001` (TS2345):** Muse reported an un-narrowed catch variable in `src/cli/main.ts:160`. Flash narrowed `err` to `err instanceof z.ZodError`, restoring clean typechecking. Muse verified the fix and marked it `verified_fixed` in `reports/muse/findings.json`.
- **`GROK-002` (Major):** Grok reported that 20 legal 200-character dependency titles overflowed the 4000-character budget and caused the trailing hard slice to cut off 7 dependency IDs.
  - **Resolution:** Updated `renderContext` in `src/context/render.ts` to reserve the non-optional header and dependency ID/status prefixes. When `baseContent` exceeds the target budget, dependency titles are deterministically shortened using binary search to find the optimal title length, ensuring `baseContent.length <= budget` and preventing the hard slice from ever touching dependency IDs or statuses.
  - **Verification:** `reports/grok/repro-a18-render.mjs` exits 0 with 0 missing dependency IDs and length 3,987 <= 4,000. Added regression test in `tests/context/render.test.ts`.
- **`CODEX-004` (Field Exercise Walkthrough Schema & Usability):** Independent review found that `examples/two-agent/README.md:66` contained an unrecognized `"math.test.js": "modified"` key rejected by `EvidenceInputSchema`, that fixture commands failed when run inside the checkout cwd, and that example tests lacked necessary imports.
  - **Resolution:** Removed the extra key from the evidence files array in `examples/two-agent/README.md`. Stated required imports (`subtract`, `add`, `multiply`) in `math.test.js` so tests run independently without `ReferenceError`. Documented and updated all CLI invocations to use the absolute built CLI entry (`node .../dist/cli/main.js`) and explained explicit package prefix (`npm run --prefix ...`) so commands execute properly when the session working directory is inside `/tmp/agent-company-s1/repo`. Added `packageRoot` and `cliBin` to `ids.json` in `examples/two-agent/setup.mjs`.
  - **Verification:** Added `tests/acceptance/two-agent-walkthrough.test.ts` which asserts the absence of the invalid key, validates all markdown payload blocks against strict schemas, and executes the complete documented two-agent protocol end-to-end against a disposable fixture from the checkout cwd. Verified passing with exit code 0.

---

## 5. Final Fingerprints

- **Workspace Fingerprint:** `6596c5c536478d39deabb9379674fbcd7c2d9127c9436aa78dac5b4f4667968d`  
  Calculated using `tests/support/fingerprint.ts` across all 93 covered product files.
- **Contract Hash:** `783540612d791e6835b5e91a64f8bd40c749ed1374da33df6828dfc4d2eaf0ba`  
  Calculated across `src/core/contracts.ts` and `src/core/schemas/*.ts`. Matches Muse's contract hash exactly.

---

## 6. Runnable Local Entry Commands

The CLI is compiled and fully runnable locally:

```bash
# 1. Print help
node /Users/mnz/dev/agent-company/dist/cli/main.js --help

# 2. Display project instructions
node /Users/mnz/dev/agent-company/dist/cli/main.js instructions show \
  --project <PROJECT_UUID> \
  --agent <AGENT_ID> \
  [--home <STATE_HOME>]

# 3. Standard operation via file input
node /Users/mnz/dev/agent-company/dist/cli/main.js task get \
  --home /tmp/my-company-home \
  --input examples/inputs/task-get.json \
  --json

# 4. Standard operation via stdin input
node /Users/mnz/dev/agent-company/dist/cli/main.js task claim \
  --home /tmp/my-company-home \
  --input - <<'EOF'
{
  "schemaVersion": 1,
  "projectId": "<PROJECT_UUID>",
  "actorId": "<AGENT_ID>",
  "requestId": "req-claim-1",
  "payload": {
    "taskId": "<TASK_ID>"
  }
}
EOF
```

---

## 7. Field Verification (S1) Status

- Automated fixture setup (`examples/two-agent/setup.mjs`) is verified and enforces directory safety guards.
- Multi-process protocol flow is fully verified by automated acceptance tests in `tests/acceptance/full-integration.test.ts`.
- Live provider interactive execution remains pending user-initiated launch of separate external sessions, per `ACCEPTANCE.md` (lines 125-130).

---

## 8. Software Acceptance Gate Conclusion

All acceptance criteria (A01 through A26) are verified by passing unit, core, and multi-process acceptance tests. GROK-002 and CODEX-004 have been repaired and verified. Full checks pass cleanly against the final workspace fingerprint `6596c5c536478d39deabb9379674fbcd7c2d9127c9436aa78dac5b4f4667968d`. The software acceptance gate is **COMPLETE**.
