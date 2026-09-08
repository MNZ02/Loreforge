# Package improvements

Implements the 2026-09-08 package review and the six accepted feature areas. No website work, agent launching, commits, publishing, or worktree management.

Acceptance checklist:
- [x] Fix project-specific global rules, retry-safe init/roster updates, inbox bodies, bounded Git dirty observation, terminal sanitization, and review-mode instructions.
- [x] Fix search candidate eligibility, path normalization, mixed CLI flags, consistent indexing, and excerpt budget.
- [x] Repository-aware configuration, automatic current-project resolution, project/agent discovery, and actionable doctor checks.
- [x] Cursor pagination plus expired/claimable task discovery and dependency blockers.
- [x] Search tasks/decisions/notes/handoffs; correction history, evidence freshness, index check/rebuild.
- [x] Immutable review outcomes tied to a handoff, attempt and commit, with same-project validation and idempotency, without an editing claim.
- [x] Stdio MCP adapter exposing typed existing core operations, bounded input and private claim handling, verified using a real protocol client.
- [x] WAL-safe SQLite backup; restore into a fresh home with version/integrity validation; JSON and Markdown export without claim tokens or receipt secrets.
- [x] Focused regressions, full typecheck/build/tests, installed-tarball CLI/MCP smoke tests, documentation and final requirement audit.

Compatibility: keep existing envelopes and CLI commands; extend additively. Keep canonical mutation receipts and lease guards. Global rules resolve the current repository instead of storing a fixed project. Restore never overwrites a live state home. JSON exports are portable records, not executable instructions or implicit DB restores.


## Completion evidence

- `npm run check`: typecheck/build and 237 tests across 52 suites passed.
- `npm run test:package`: actual npm tarball installed in a temporary prefix; both bins, init/doctor/project resolution, claim/handoff/review, search/history/index, backup/restore, JSON/Markdown export, validation and a 27-tool MCP client round trip passed.
- `tests/storage/package-improvements.test.ts`: search candidate overflow/path normalization, history/freshness, equal-timestamp pagination and expiry/dependency blockers, review idempotency/project/commit guards, index damage/rebuild, committed WAL backup/restore with corrupt/future/incomplete schema rejection, large Git status.
- `tests/cli/package-improvements.test.ts`: multi-project init/roster updates, generic global rules, automatic project/home resolution, inbox sanitization, consistent review instructions, and real stdio MCP protocol tests.
- Migration v3 preserves source records, adds review records and task creator attribution, and rebuilds canonical derived search documents for tasks/decisions/notes/handoffs.
- `git diff --check`: passed. The pre-existing dirty work was retained; no website files were changed by this implementation.
- Package version is `0.2.0-alpha.1`. No commit, global installation, npm publication, model launch or deployment was performed.

Usage and explicit limitations are documented in `docs/package-workflows.md`: point-in-time task eligibility; author-asserted evidence; review records do not alter task status; binary backups contain private receipts; restore requires a fresh home; provider-specific rule loading requires client-side setup/verification.
