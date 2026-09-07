# Optional suggestions (not acceptance blockers)

These are not authorization to expand v0.1 and do not change the `changes_required` verdict.

## Thicken the named A26 test

The mapped A26 test in `tests/acceptance/cli-basics.test.ts` only runs compiled `--help` from a foreign cwd. Independent Grok reproduction (`reports/grok/repro-a26-foreign.mjs`) already passed the fuller scenario: explicit temp home plus a repo root and a linked worktree resolving to one project. Adding that fixture to the named test would make coverage match ACCEPTANCE.md without changing product behavior.

Benefit: the coverage map would stop overclaiming. Scope: Flash test only. Tradeoff: a slightly slower acceptance test.

## Fingerprint helper tautology

`tests/core/fingerprint.test.ts` asserts `first.json.indexOf(" ") === -1 || true`, which always passes. The helper itself emits compact JSON. Replacing `|| true` with a real no-space assertion would make the test mean what it says.

Benefit: A25 test honesty. Scope: one Muse test line. Tradeoff: none.

## Handoff checkout identity

`handoff.submit` compares reported vs collected head/dirty at `checkoutRoot` but does not check that the checkout shares the registered project's `gitCommonDir`. Worktrees of the same repository work (A02/A22). A checkout of a different clone can still be attached if the agent reports that clone's head.

Benefit: evidence cannot silently describe a different project. Scope: Muse handoff path plus one test. Tradeoff: rejects a class of agent mistakes that the current contract may treat as caller obligation, since file assertions are already agent-reported.

## Git observation failure codes

`observeCheckout` maps missing/unreadable checkouts to CONFLICT, but `runGit` maps spawn timeout and `maxBuffer` overflow to IO. Both reject the handoff without completing the task (A11), so this is not a mandatory defect. Using CONFLICT for every collection failure would match the function comment.

Benefit: one error code for "could not observe". Scope: small Muse mapping change. Tradeoff: callers that treat IO as retryable vs CONFLICT as a bad report would see a code change.
