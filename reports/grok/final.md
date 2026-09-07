# Grok independent review — G4

**Verdict: pass**

Fingerprint: `6596c5c536478d39deabb9379674fbcd7c2d9127c9436aa78dac5b4f4667968d` (93 covered files)
Contract hash: `783540612d791e6835b5e91a64f8bd40c749ed1374da33df6828dfc4d2eaf0ba`
Before and after `npm run check`: unchanged.

This supersedes the previous Grok pass on `0ef592a3…`, which covered-file edits invalidated (Muse CODEX-001/002/003, Flash CODEX-004). Historical review files remain; this document is the current verdict.

Reviewer: Grok 4.6. Effort flag not visible (PLAN requests high; unverified).

Software acceptance is complete for this fingerprint. **S1 field verification is pending** and is not a software pass.

## Muse implementation (CODEX-001/002/003)

Inspected the actual source, not Muse's summaries.

**CODEX-001** — `submitHandoff` still collects Git outside the transaction, then inside `transactMutation` compares `discoverProject(checkout).gitCommonDir` to `project.git_common_dir`. Mismatch is CONFLICT with no task/handoff/receipt writes. Linked worktrees share the common dir and complete. Independent `reports/codex/reproduce.mjs` foreign-checkout: `accepted=false`, `taskStatus=CONFLICT`.

**CODEX-002** — `transactMutation` now takes `now: () => number` and samples it **after** `BEGIN IMMEDIATE`, immediately before produce/lease checks. Dispatch no longer stamps mutations with a pre-lock clock. Codex diagnostic: renew started 1475 ms before expiry, finished 1054 ms after, `STALE_CLAIM`.

**CODEX-003** — `runGit` prefixes `--no-optional-locks` on the argument array (no user config change). Codex diagnostic: `indexChanged=false`, `reportedDirty=false`.

Regression tests exist in `tests/storage/handoffs.test.ts` and `tests/storage/claims.test.ts`. All passed under the independent gate.

## Flash CODEX-004

`examples/two-agent/README.md` files[] entries are `{path,change}` only. Commands use `node /Users/mnz/dev/agent-company/dist/cli/main.js`. `tests/acceptance/two-agent-walkthrough.test.ts` executes the documented protocol. That is a fixture walkthrough, not live S1.

Flash added that test file after Muse's `27d43306` freeze, which is why the bound hash is `6596c5c5` (93 files), not Muse's published `27d43306` (92 files).

## Required findings

| ID | Owner | Severity | Status |
|---|---|---|---|
| GROK-001 | muse | major | verified_fixed |
| GROK-002 | flash | major | verified_fixed |
| GROK-003 | muse | major | verified_fixed |
| CODEX-001 | muse | major | verified_fixed |
| CODEX-002 | muse | major | verified_fixed |
| CODEX-003 | muse | minor | verified_fixed |
| CODEX-004 | flash | minor | verified_fixed |

No unresolved mandatory-contract defect.

## Command results

| Command | Exit | Result |
|---|---:|---|
| fingerprint before check | 0 | `6596c5c5…`, 93 entries |
| `npx tsx reports/codex/reproduce.mjs` | 0 | foreign CONFLICT; lock-wait STALE; index unchanged; extra README key absent |
| `npm run check` | 0 | typecheck/build clean; **178 tests / 45 suites / 0 fail** |
| `npx tsx reports/grok/repro-a26-foreign.mjs` | 0 | compiled CLI, foreign cwd, two worktrees |
| `npx tsx reports/grok/repro-a01-concurrent.mjs` | 0 | 12/12 |
| fingerprint after check | 0 | unchanged |

## Owner finals (checked 2026-09-06)

Independently recomputed the workspace fingerprint: still `6596c5c5…` (93 entries). Covered files have not changed since the G4 gate, so that pass still holds. No product re-review or extra `npm run check` was required.

- Muse `core-ready.json` and `reports/muse/final.md` cite this fingerprint.
- Flash `client-ready.json` and `reports/flash/final.md` cite this fingerprint.

## Limitations

- **S1 incomplete.** Muse's Task A leg in `reports/muse/field-test.md` was independently confirmed against `/tmp/agent-company-s1`: Task A `aa1cde31-…` completed, handoff `cf6acefa-6efa-4548-8722-edd19cbbcaed`, observed HEAD `c4725e0…`, `add` present, no claim token in task/context JSON. Task B is still `open` attempt 0. Flash has not run a live session (question + blocked handoff). No fresh third session. Walkthrough/acceptance tests are not a field pass.
- M0 baseline drift: PLAN/ACCEPTANCE/GOAL docs and README.md. CONTRACT.md matches baseline `f52bb1faeed398470da6cb7d5616b70a528c4b86848f8e030ab2b61d234b65e4`.
- A later covered-file edit invalidates this verdict.

## Next

S1 remaining, in live sessions only: Flash Task B (context/claim/question/blocked handoff), Muse inbox answer, Flash reopen/reclaim/complete, then a fresh session using only project/task/home IDs. Record in `reports/<owner>/field-test.md` with tokens redacted.
