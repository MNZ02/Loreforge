# Muse S1 field-test record — partial (Muse leg only)

Provider identity: Muse Spark 1.3 (this session; xhigh requested, displayed
identity unverified). Date: 2026-09-06. No claim tokens are recorded here.

## Fixture (disposable; only place where Git commits were made)

- Setup: `node examples/two-agent/setup.mjs /tmp/agent-company-s1` exit 0.
- Fixture home: `/tmp/agent-company-s1/home`; repo: `/tmp/agent-company-s1/repo`.
- Project ID: `a32ccee9-e677-4324-b29e-190f6bc2075e` (TwoAgentFixture).
- Task A ID: `aa1cde31-9828-414e-8ef7-0ee7cecbae33` (add function, no deps).
- Task B ID: `68329e4e-5016-4e4b-80ff-aebf59b6e28e` (multiply, depends on A).

## Step 2 — Muse leg (done, real session, real CLI)

- `context get` Task A (work): ok; task open, attempt 0, no owner; task record
  contains no claim token; `currentGit` reported fixture HEAD with no error.
- `task claim` Task A (`requestId muse-claim-a-1`): ok; attempt 1, owner muse,
  2 h lease. Token held privately for the handoff call, then destroyed.
- Fixture change: added `add(a, b)` to `math.js`, extended `math.test.js`;
  `node math.test.js` printed `math tests pass`; committed in the fixture repo
  (`Implement add function`, HEAD `c4725e094059af65570cf1994e1204601d3f0056`,
  tree clean afterwards).
- `handoff submit` (`requestId muse-handoff-a-1`, outcome completed): ok; task
  completed, owner/lease cleared; handoff ID
  `cf6acefa-6efa-4548-8722-edd19cbbcaed`, attempt 1, observed head/dirty match
  the report, `evidenceSource agent_reported`.

## Pending (needs other live sessions; not attempted here)

- Step 3 (Flash session): context/claim Task B with no pasted conversation,
  ask Muse a task-linked question, submit blocked handoff naming it.
- Step 4: Muse answers via inbox (available to do when the question exists);
  Flash reopens B, reclaims (attempt 2), implements multiply, final handoff.
- Step 5: fresh third session retrieves A/B records from IDs alone.
- Nothing above asserts a field pass. The protocol-fixture acceptance test is
  not live-provider evidence.
