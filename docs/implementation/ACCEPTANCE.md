# Acceptance and review gates

Tests below are mandatory behavior checks, not instructions to mirror the code.
Use fresh temporary directories and actual SQLite. Multi-process tests must use
independent Node processes/connections synchronized with an IPC barrier; merely
calling the same JS function twice is not a concurrency test. Use injected time
for lease tests; do not sleep for hours or expose a production clock override.

## Required scenarios

| ID | Scenario and pass condition | Primary test owner |
|---|---|---|
| A01 | Initialize twice and from two processes concurrently; preserve data, one schema version, foreign keys enabled, no destructive migration | Muse |
| A02 | Register root and real Git worktree: same project; symlink aliases same; independent clone different; non-Git root rejected | Muse |
| A03 | Project A IDs queried/mutated under B return NOT_FOUND and leak no A content; inbox and context never cross projects | Muse + Flash integration |
| A04 | Two processes claim one open task simultaneously: exactly one success, one CONFLICT, attempt=1, one owner | Muse |
| A05 | Reclaim at exact expiry increments attempt; old owner cannot renew/release/complete; late completion leaves zero extra handoffs | Muse |
| A06 | Renew before expiry extends lease, at expiry fails; release clears owner; dependency blocks claim until completed | Muse |
| A07 | Same requestId/payload returns identical original result; changed operation/payload conflicts; same key scoped to another actor/project is independent | Muse |
| A08 | Handoff and completion commit together; injected failure between task update/handoff/receipt rolls all back; retry succeeds once | Muse |
| A09 | Completion retry works after checkout is removed or HEAD changes; no new Git collection required for an existing receipt | Muse |
| A10 | Cancel vs complete race has one terminal winner; cancelled task gets no late handoff; completed task rejects new cancellation | Muse |
| A11 | Failed Git observation or mismatching head/dirty rejects new handoff without completing task; reported checks never run | Muse |
| A12 | Blocked handoff releases claim; cannot reopen until all linked questions answered; reopen then reclaim new attempt and complete | Muse + Flash integration |
| A13 | Question retry gives one question/event; answer retry gives one answer/event; wrong recipient rejected; competing answers cannot both win | Muse |
| A14 | Inbox cursor retrieves ordered recipient/project events; paging loses/duplicates none; empty page preserves cursor; reads do not consume | Muse + Flash integration |
| A15 | Decision supersession is immutable and project-scoped; old decision absent from active context; second supersession conflicts | Muse |
| A16 | Malformed/oversize JSON, unknown keys, path traversal, invalid IDs fail before mutation; parse errors do not echo input secrets | Flash + Muse schemas |
| A17 | --help and missing-state reads create no state; JSON stdout has one parseable value; errors have documented exit codes | Flash |
| A18 | Context contains only selected task/dependencies and relevant decisions; caps and omitted counts accurate; deterministic <=budget at 4000,16000,32000 chars | Flash + Muse selection |
| A19 | Review context excludes implementation prose and Q&A from JSON and text, retains requirements, evidence and decisions; policy omissions explicit | Flash |
| A20 | Notes containing backticks, ANSI escapes, shell substitutions, and fake system instructions stay inert; no external command executes | Flash |
| A21 | Stop first CLI process, start fresh second process: handoff, question, answer, and cursor history remain retrievable using only explicit IDs/home | Flash |
| A22 | Real Git repo/worktree fixtures with spaces in paths work; existing index/worktree unchanged by observations and CLI commands | Flash |
| A23 | Hold DB write lock in another process: bounded BUSY result, no spin loop or partial write; later retry succeeds | Muse |
| A24 | Exported instruction snippet quotes home/executable paths safely and does not touch existing instruction files or user config | Flash |
| A25 | Core/client fingerprint helper produces same hash on unchanged tree, changes on covered edit, excludes reports/dist; Grok verdict and implementer reports match | Muse helper, Grok reviewer |
| A26 | Built CLI runs from outside package directory against explicit temp home and two separate worktree paths; no source-only import assumptions | Flash |

Fault injection for A08 belongs in an internal test seam in storage, never an
environment variable, CLI flag, or normal operation. Inject throws at each
write boundary and verify rollback by reopening the DB. Implementing a generic
fault injection framework is unnecessary.

## Exact check sequence

During development run the narrow owner group after each milestone:

```sh
npm run test:core
npm run test:client
npm run test:acceptance
```

At the integrated gate, the implementers run their checks, then Grok independently
runs the following after they freeze edits and pause shared build output:

```sh
npm run check
```

Also run compiled entry `node /Users/mnz/dev/agent-company/dist/cli/main.js
--help` from a temporary cwd and the A26 fixture scenario. Use npm ci only if
dependencies need restoring, and only Muse may run it while coordinating with
Flash. Do not invent a lint requirement or add a linter to satisfy the report.

Save command, exit code, concise stdout/stderr and test counts under own reports.
A skipped test, simulation substituted for IPC concurrency, or unchecked fixture
assertion is not a pass. Tests need not use a prescribed count, but all A IDs
must be mapped to concrete test paths/test names in `reports/<owner>/coverage.md`.

## Independent review instructions

Grok reviews Muse source/storage against A01–A15 and A23, particularly actual
transaction boundaries, receipt replay ordering, lease expiry equality, project
scoping, and state recovery. Tests passing do not replace code inspection.

Grok reviews Flash source and integration against A16–A22/A24/A26, particularly
bounded stdin, no side effects on help/error, real core usage, compiled imports,
review-mode omissions, deterministic truncation, and honest integration claims.

Each finding needs a concrete failure case and source location. Do not invent
findings to appear independent. Report no findings when none are found. For each
finding suggest a bounded fix, assign Muse or Flash, and state the verification
expectation. Grok must not apply product fixes. If a failure spans ownership,
identify both affected contracts and assign each owner its part. Do not change
the frozen interface unilaterally. Optional improvements belong in a separate
suggestions.md and are not acceptance blockers or implementation authorization.

Final review JSON is written only by Grok at `reports/grok/review.json`:
`{schemaVersion:1,reviewer,scope,fingerprint,verdict,findings,checks,limitations}`.
verdict=pass|changes_required|blocked. A pass has no unresolved blocker/major
and no minor that violates a mandatory contract. Future enhancements may remain
as explicitly nonblocking notes. Fingerprint must match after every repair and
match both implementers' final reports. Muse and Flash do not self-approve or
substitute their checks for Grok's independent verdict.

## S1 — real two-provider exercise (separate from software tests)

This exercise must run in actual user-launched AGY and Muse sessions, not two
Node processes pretending to be models. No provider flags or auth modifications.
Use a disposable Git fixture and temp home created by the test/example setup.
No changes to real application repos, no network or model API requests by product.

1. Flash publishes an exact executable scenario in `examples/two-agent/README.md`,
   with an initialization script that creates only a caller-specified new temp
   directory, tiny committed Git fixture, registered project, `muse` and `flash`
   agents, task A and task B (B depends on A), and JSON request examples.
   Git commits are permitted only inside these newly created disposable test
   fixtures; never in the application folder or user projects.
2. In Muse's real session: retrieve A context, claim A, add a small fixture
   function and meaningful test, run that test, submit completed handoff with
   observed Git evidence. Report only task ID and fixture/home location to peer.
3. In Flash's real session: retrieve B context (no pasted Muse conversation),
   identify A's changed paths and check evidence, claim B, ask Muse a specific
   task-linked clarification, submit blocked handoff referencing that question.
4. Muse checks its inbox and answers through the CLI. Flash checks its own inbox,
   reopens B, claims a new attempt, implements a small dependent fixture change,
   verifies it, and submits the final handoff.
5. Start a fresh available session or have the user start one. It retrieves the
   records using only task/project/home IDs and states what was done and remains.
   If a fresh session is unavailable, persistence tests may pass, but this step
   remains pending. Do not label a reused context as a fresh session.

Do not launch extra model sessions from worker scripts. The two /goal agents may
perform steps 2–4 themselves after code freeze if their actual runtime permits
local command execution. Coordinate IDs through their own reports, not by
copying implementation transcripts. If S1 would require user action, save
precise remaining steps and mark field verification pending without blocking
already-completed software review indefinitely.

Record in `reports/<owner>/field-test.md`: actual provider identity if visible,
task IDs, commands, persisted record IDs, observed results, and pending steps.
Redact claim tokens. No fabricated quota measurements. A field pass asserts
only the configurations actually exercised, never all supported vendor products.
