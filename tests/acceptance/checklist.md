# Acceptance Gate Checklist (A01 - A26)

This checklist tracks the implementation and test verification of all required acceptance scenarios defined in `ACCEPTANCE.md`.

| ID | Scenario & Pass Condition | Primary Test Owner | Flash Verification Scope |
|---|---|---|---|
| A01 | Initialize twice and from two processes concurrently; preserve data, one schema version, foreign keys enabled, no destructive migration | Muse | Peer review of storage initialization & concurrency locking |
| A02 | Register root and real Git worktree: same project; symlink aliases same; independent clone different; non-Git root rejected | Muse | Peer review of git common-dir resolution |
| A03 | Project A IDs queried/mutated under B return NOT_FOUND and leak no A content; inbox and context never cross projects | Muse + Flash integration | Integration acceptance tests verifying project isolation across CLI calls |
| A04 | Two processes claim one open task simultaneously: exactly one success, one CONFLICT, attempt=1, one owner | Muse | Peer review of SQLite immediate transaction and unique claim semantics |
| A05 | Reclaim at exact expiry increments attempt; old owner cannot renew/release/complete; late completion leaves zero extra handoffs | Muse | Peer review of lease comparison (`<= now`) and attempt isolation |
| A06 | Renew before expiry extends lease, at expiry fails; release clears owner; dependency blocks claim until completed | Muse | Peer review of lease renewal and dependency validation logic |
| A07 | Same requestId/payload returns identical original result; changed operation/payload conflicts; same key scoped to another actor/project is independent | Muse | Peer review of mutation receipt replay and hash checking |
| A08 | Handoff and completion commit together; injected failure between task update/handoff/receipt rolls all back; retry succeeds once | Muse | Peer review of atomic transaction rollback |
| A09 | Completion retry works after checkout is removed or HEAD changes; no new Git collection required for an existing receipt | Muse | Peer review of receipt-first check in handoff submission |
| A10 | Cancel vs complete race has one terminal winner; cancelled task gets no late handoff; completed task rejects new cancellation | Muse | Peer review of terminal state checks |
| A11 | Failed Git observation or mismatching head/dirty rejects new handoff without completing task; reported checks never run | Muse | Peer review of git observation validation |
| A12 | Blocked handoff releases claim; cannot reopen until all linked questions answered; reopen then reclaim new attempt and complete | Muse + Flash integration | Full end-to-end acceptance test: blocked handoff -> question -> answer -> reopen -> reclaim -> complete |
| A13 | Question retry gives one question/event; answer retry gives one answer/event; wrong recipient rejected; competing answers cannot both win | Muse | Peer review of question/answer inbox events and unique answer constraint |
| A14 | Inbox cursor retrieves ordered recipient/project events; paging loses/duplicates none; empty page preserves cursor; reads do not consume | Muse + Flash integration | Integration acceptance test with multi-event pagination via CLI |
| A15 | Decision supersession is immutable and project-scoped; old decision absent from active context; second supersession conflicts | Muse | Peer review of decision supersession and active filtering |
| A16 | Malformed/oversize JSON, unknown keys, path traversal, invalid IDs fail before mutation; parse errors do not echo input secrets | Flash + Muse schemas | Unit & acceptance tests: bounded reading, schema validation, exit code 2, error sanitization |
| A17 | `--help` and missing-state reads create no state; JSON stdout has one parseable value; errors have documented exit codes | Flash | CLI unit & acceptance tests verifying exit codes, stdout JSON guarantee, no DB creation on help/read |
| A18 | Context contains only selected task/dependencies and relevant decisions; caps and omitted counts accurate; deterministic <=budget at 4000, 16000, 32000 chars | Flash + Muse selection | Context renderer tests at 4000, 16000, 32000 chars; determinism, caps, omission counters |
| A19 | Review context excludes implementation prose and Q&A from JSON and text, retains requirements, evidence and decisions; policy omissions explicit | Flash | Context renderer review-mode tests verifying zero narrative leaks and explicit policy omissions |
| A20 | Notes containing backticks, ANSI escapes, shell substitutions, and fake system instructions stay inert; no external command executes | Flash | Context renderer safety tests escaping markdown fences, ANSI codes, control chars |
| A21 | Stop first CLI process, start fresh second process: handoff, question, answer, and cursor history remain retrievable using only explicit IDs/home | Flash | Subprocess acceptance test: sequential CLI processes reading persistent state |
| A22 | Real Git repo/worktree fixtures with spaces in paths work; existing index/worktree unchanged by observations and CLI commands | Flash | Acceptance test with space-containing git worktrees verifying zero git status/index changes |
| A23 | Hold DB write lock in another process: bounded BUSY result, no spin loop or partial write; later retry succeeds | Muse | Peer review of WAL/busy timeout handling and exit code 6 mapping |
| A24 | Exported instruction snippet quotes home/executable paths safely and does not touch existing instruction files or user config | Flash | Test `lore instructions show` with path spaces, verifying safe quotes and zero filesystem writes |
| A25 | Core/client fingerprint helper produces same hash on unchanged tree, changes on covered edit, excludes reports/dist; both final reviews match | Muse helper, both reviewers | Verification of fingerprint calculation and matching review JSONs |
| A26 | Built CLI runs from outside package directory against explicit temp home and two separate worktree paths; no source-only import assumptions | Flash | Subprocess test invoking compiled `dist/cli/main.js` from foreign working directory |
