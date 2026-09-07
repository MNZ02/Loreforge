# Agent Company: shared context for independent CLIs

Status: proposal grounded in local source inspection, 2026-09-05. No runtime
migration or provider integration has been performed.

## Product

Keep working in each provider's own CLI. Agent Company supplies a persistent,
project-scoped record of tasks, handoffs, decisions, and questions that those
sessions can read and update. A web UI and automatic agent launching are optional
clients of this shared service, not requirements for using it.

First success case: agent A completes work and records evidence; a fresh session
with agent B receives the relevant handoff and continues without the user copying
the conversation. Second: B asks a task-linked question, works on something
independent, and retrieves the answer on its next inbox check.

## Existing code

- `orchestrator/*.sh`: GitHub issue dispatch, development, review, repair, digest,
  and merge automation. Keep as legacy automation during migration. Do not run
  these scripts to initialize shared context: they perform external writes.
- `agents/*.md`: useful handoff and review conventions, currently tied to PRs.
- `orchestrator/policy.env`: currently enables auto-merge. This is an existing
  automation setting, not authorization for the new system to publish or merge.
- This folder has no Git repository or application package manifest.
- Existing billing and model guidance is historical and needs current provider
  verification before reuse.

Blackboard extraction candidates:

- `controller/git-tree.ts`, `controller/worktree.ts`: Git evidence and optional
  isolation when multiple agents edit concurrently.
- `lib/work-log.ts`: bounded change records and immutable revision references;
  extract the data concepts and parsing without its board/prompt dependencies.
- `lib/job-claim.ts`: claim-token checks as a starting point. Real atomic claims
  belong in database transactions, not the in-memory simulation.
- `lib/run-manifest.ts`: project identity and recorded execution settings.
- `controller/adapters.ts`, `controller/process.ts`: optional future background
  workers. Audit flags and verify each provider before extracting. The current
  Meta path uses an API key; it does not establish subscription CLI integration.

Blackboard has uncommitted completion changes. Select a reviewed source revision
for extraction and record provenance; do not copy the entire working tree.

## Proposed structure

```text
src/
  core/           # Tasks, ownership, handoffs, decisions, questions
  storage/        # SQLite transactions and schema migrations
  context/        # Relevant context bundles and Markdown rendering
  cli/            # Human- and agent-callable commands
  integrations/   # Per-CLI instructions and supported hooks
  worker/         # Optional later question delivery and agent launch
templates/       # Short instruction snippets and handoff examples
docs/
legacy/          # Existing scripts, moved only during implementation
```

Use SQLite as canonical task/message state for concurrent local sessions.
Generate Markdown views and JSON exports from that state. Do not maintain
independently editable database and file copies of the same record. A local CLI
can access the database directly in the first version; no daemon is required.

Project identity must be explicit and stable across worktrees. Every task,
question, and handoff belongs to a project. Cross-project sharing is opt-in.

## Interaction contract

Proposed commands (not implemented):

```text
company context <task-id>
company claim <task-id>
company handoff <task-id> --file result.json
company ask <task-id> --to <agent-role> --file question.md
company inbox
company answer <question-id> --file answer.md
```

At task start, fetch relevant context and claim ownership before editing. At
completion, submit a validated handoff: outcome, summary, changed files, revision
or captured tree, checks with outcomes, unresolved issues, and next action.
Keep agent-reported test results distinct from independently executed checks.
An exit without a valid handoff is an incomplete session, not successful work.

Questions persist independently of process lifetime. A reply becomes available
on the next explicit inbox check. Live notifications or waking an idle agent
require a supported provider mechanism or the optional worker; writing a record
does not interrupt an existing CLI session. A required answer blocks only the
dependent task, not unrelated work.

Provider-native instructions point to the context commands. Supported hooks can
improve reliability, but prompts alone cannot guarantee compliance. Expose the
same operations through MCP later where useful; it is not required for the MVP.

## Reliability requirements

- Atomic ownership with expiring leases and attempt-scoped tokens; stale agents
  cannot complete reclaimed tasks.
- Idempotent handoff/message submission so retries do not duplicate records.
- Record source revision and provenance; supersede stale findings explicitly.
- Bound context size and retrieve by task, dependency, and relevant paths.
- Treat peer messages as evidence or requests, not permission overrides.
- Give independent reviewers requirements and patch evidence before optional
  implementer explanations.
- Preserve existing user instructions when installing integration snippets.
- Keep credentials out of shared context.

## Delivery sequence

1. Establish a Git baseline for this folder; preserve historical scripts.
2. Implement local storage, CLI operations, and validated handoffs. Prove two
   manually started agents can exchange context on one project.
3. Add task questions, replies, ownership expiry, and focused race/retry tests.
4. Verify provider-specific instruction/hook integration one CLI at a time.
5. Add a worker only if manual inbox checks are a demonstrated bottleneck.
6. Add a read-only dashboard if inspecting records through the CLI is awkward.

The initial system does not automatically dispatch agents, push branches, open
PRs, or merge. Those are separate capabilities to add when requested.

Evaluate on real tasks: context the user had to repeat, duplicate investigation,
handoff recovery success, defects caught, elapsed time, and quota consumption
where observable. Compare against the same workflow without the shared records.
