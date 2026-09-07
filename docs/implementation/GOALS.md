# Copy-paste /goal prompts

Open sessions in `/Users/mnz/dev/agent-company`. Select each requested model and
effort before issuing its goal; these prompts do not configure provider settings.

Start Muse first, then Flash immediately. They work concurrently with disjoint
ownership; Muse alone installs dependencies. Start Grok once core-ready and
client-ready reports exist. Grok may read the specification earlier, but waits
for both implementations before judging a candidate.

Grok is the sole independent reviewer. Muse and Flash apply his findings in their
owned files. During review they freeze edits and pause shared build/check runs.
No goal initializes Git or commits/publishes the application.

## Muse Spark 1.3 — xhigh

```text
/goal Implement /Users/mnz/dev/agent-company/docs/implementation/MUSE-GOAL.md to its software acceptance gate. First read PLAN.md, CONTRACT.md, and ACCEPTANCE.md in the same directory. AGY Gemini 3.8 Flash high implements the client concurrently; Grok 4.6 high is the sole independent reviewer. Stay within Muse ownership, preserve other edits and legacy files, and do not change frozen specs. Publish progress/readiness, then freeze for Grok. Apply findings assigned to Muse, run regression checks, and refreeze for verification. Do not review Flash for release approval or self-approve. No nested delegation, model substitution, application commits/pushes, external publication, or user-wide config changes. Git commits are allowed only in newly created disposable test fixtures. Completion requires full checks and Grok's pass for the current fingerprint. Attempt available S1 steps afterward and report missing live-session evidence honestly. Save resumable checkpoints for dependencies without taking over other files.
```

## AGY Gemini 3.8 Flash — high

```text
/goal Implement /Users/mnz/dev/agent-company/docs/implementation/FLASH-GOAL.md to its software acceptance gate. First read PLAN.md, CONTRACT.md, and ACCEPTANCE.md in the same directory. Muse Spark 1.3 xhigh implements the core concurrently; Grok 4.6 high is the sole independent reviewer. Stay within Flash ownership, preserve other edits and legacy files, and do not change frozen specs. Begin F0 while Muse bootstraps; Muse alone installs dependencies and edits tooling. Publish readiness after real integration checks, then freeze for Grok. Apply findings assigned to Flash, run regression checks, and refreeze for verification. Do not review Muse for release approval or self-approve. No nested delegation, model substitution, application commits/pushes, external publication, or user-wide config changes. Git commits are allowed only in newly created disposable test fixtures. Completion requires full checks and Grok's pass for the current fingerprint. Attempt available S1 steps afterward and report missing live-session evidence honestly. Save resumable checkpoints for dependencies without taking over other files.
```

## Grok 4.6 — high

```text
/goal Independently review Agent Company following /Users/mnz/dev/agent-company/docs/implementation/GROK-GOAL.md. First read PLAN.md, CONTRACT.md, and ACCEPTANCE.md in the same directory. Muse Spark 1.3 xhigh owns core/storage; AGY Gemini 3.8 Flash high owns CLI/context/integrations. You are the sole independent reviewer, not an implementer. Wait for both readiness reports and frozen edits, inspect the actual changes and invariants, independently run required checks, and suggest concrete owner-assigned fixes. Write only reports/grok/** and temporary reproduction artifacts; never edit product code, tests, dependencies, frozen specs or user config. Normal build/test outputs and disposable fixtures are allowed. Separate required defects from optional suggestions. Verify owner repairs, capped at two rounds per finding, then issue a truthful verdict for the unchanged final fingerprint. No nested delegation, model substitution, publication or self-application of fixes. Report software acceptance separately from actual S1 provider evidence; missing evidence is not a pass.
```

## Resuming any session

```text
/goal Resume your assigned Agent Company role from reports/<owner>/progress.json and the frozen docs/implementation specification. Read relevant readiness and findings, verify the current tree, then continue the next incomplete milestone. Preserve ownership, Grok's independent review gate, and no-publication constraints. Do not redo completed work or take over another role. Record waiting dependencies explicitly.
```

Replace `<owner>` with muse, flash, or grok and use its assigned model.
If implementation goals started with older prompts, tell those sessions Grok is
now the reviewer and send the resume prompt. They should re-read the updated
planning documents and refresh only planning-file baseline hashes; do not change
the legacy-file baseline to conceal unrelated edits.

## What to bring back

- reports/muse/final.md and reports/flash/final.md.
- reports/grok/review.json and final.md, matching both implementers' fingerprint.
- reports/grok/findings.json and suggestions.md.
- Coverage mappings, independent check logs, and S1 evidence or pending steps.
