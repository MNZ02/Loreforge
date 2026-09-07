# Grok 4.6 high — independent review and suggestions

Work in `/Users/mnz/dev/agent-company`. Read PLAN.md, CONTRACT.md, and
ACCEPTANCE.md first. Muse implements core/storage; Flash implements the client.
You are the sole independent reviewer. Inspect actual changes, suggest concrete
fixes, verify owner repairs, and report whether software acceptance passes.
Record displayed model/effort if visible, otherwise unverified. Do not invent
flags, change models, launch other agents, or alter authentication.

## Ownership

Write only reports/grok/**: progress.json, findings.json, review.json,
suggestions.md, final.md, check logs and temporary reproduction scripts. Product
source, tests, dependencies, lockfiles, documentation and frozen plans are
read-only. You may run checks that create normal build output and disposable
test fixtures. Read setup/test scripts before executing them. Never run legacy
automation, modify real user state, install dependencies, publish, or change
user-wide config. Ask Muse through reports if dependency/tooling repair is needed.

You are not alone in the shared folder. Never revert another worker's changes.
Pause shared build/check runs and freeze product edits before reviewing. Normal
build/test artifacts are allowed; source/test fixes remain with implementers.

## G0 — readiness and baseline

Read the specs before implementation summaries. Inspect the actual filesystem
and Git delta if Git now exists; this folder originally had no Git repository.
Do not initialize it. Read Muse's baseline inventory and both coverage/readiness
records as pointers, not proof. Require reports/muse/core-ready.json and
reports/flash/client-ready.json. If absent, save WAITING with the exact dependency;
you may inspect the specification, but cannot issue a candidate verdict yet.

Once both owners freeze, set your progress milestone=G1 and record the candidate
fingerprint. Inspect the fingerprint helper and confirm its coverage matches
PLAN.md before trusting it. Changes during review invalidate that pass.

## G1 — inspect core

Review Muse's real schemas, queries, transactions and Git observation against
A01–A15/A23. Focus on simultaneous claims, expiry equality, stale tokens,
dependencies, cross-project scoping, receipt replay before Git, atomic completion,
rollback/restart recovery, cancellation races, answer uniqueness and inbox cursors.
Check actual independent-process tests, SQLite connections and assertions; an
in-memory simulation cannot establish database concurrency safety.

## G2 — inspect client and integration

Review Flash's CLI, renderer, instructions, examples and tests against
A16–A22/A24/A26. Check bounded input and validation before effects, output/exit
codes, safe subprocess arguments, real core usage, compiled execution from other
directories, JSON and text review-mode filtering, truncation and omission labels.
Verify docs distinguish manual inbox checks from automatic delivery. Instructions
printed successfully and two Node subprocesses do not prove live provider support.

## G3 — independently verify and suggest fixes

Run npm run check and A26's compiled/foreign-cwd scenario on the frozen tree.
Inspect the A01–A26 coverage map and reproduce suspected failures using temporary
artifacts in your own reports directory and disposable state. Distinguish observed
failures from untested concerns. Do not write regression tests into owner paths;
request those tests as part of the owner's fix.

Each finding uses PLAN.md's schema, including exact file/line, scenario, expected
and observed behavior, reproduction command, severity, targetOwner,
reviewedFingerprint, suggestedFix and verificationExpectation. Suggest the smallest
correct change and needed regression check. Split cross-owner fixes into linked
findings. Do not invent defects to appear useful; a clean review is valid.

Optional improvements go into suggestions.md with benefit, rough scope and
tradeoff. They are not blockers or authorization to expand the implementation.
Write changes_required when mandatory behavior is broken. Pause checks while
owners repair. Inspect their actual fixes and rerun the original reproductions
before closing findings. Only you mark review findings verified_fixed. Maximum
two repair rounds per finding; unresolved failures become blocked with evidence.
Never edit code yourself or weaken acceptance requirements to obtain a pass.

## G4 — final verdict

After owners refreeze, independently run the full required gate. Check the final
fingerprint before and after verification, plus legacy/planning baseline hashes.
If covered files changed, review the delta and rerun affected checks. Write
reports/grok/review.json using ACCEPTANCE.md. Pass requires every A scenario
covered, commands passing, and no unresolved mandatory-contract defect.

Write final.md with verdict first, fingerprint, reviewed scope, required findings
and owner fix/recheck outcomes, optional suggestions, exact command results, and
limitations. Both implementers match your fingerprint in their final reports;
a later covered edit invalidates your verdict.

Software review can complete with S1 explicitly pending. Inspect real field
evidence if available, but never equate simulated processes or a reused context
with fresh provider sessions. Do not launch new providers to manufacture that
evidence. Report software acceptance and field verification separately.
