# Frozen v1 contract

## Core boundary

Muse provides `src/core/contracts.ts` (exported request/response/data types and
`parseRequest(value: unknown): Request`), `src/core/index.ts` (exports `openCore`),
and complete runtime schemas under `src/core/schemas/`. Flash imports these types,
parser, and factory; no SQL or core state machine in client files. parseRequest
throws a Zod validation error; CLI maps it to VALIDATION without echoing values.
Core execute also calls parseRequest and maps validation failures to its envelope.

`openCore({ home: string, now?: () => number })` returns
`{ execute(request: unknown): Promise<Response>, close(): void }`.
`home` is already an absolute state directory. `now` is milliseconds since epoch,
test injection only; no user-supplied clock or lease bypass in CLI. Opening may
throw an IO error; execute returns the error envelope for expected failures.
The database filename is `company.sqlite3` directly under home. Existence checks
in the CLI use this exact path. Opening/migration lock exhaustion is BUSY, not IO;
export a CoreOpenError with the same code/message fields for CLI error mapping.

Request: `{schemaVersion:1, operation:Operation, projectId?:string,
actorId?:string, requestId?:string, payload:object}`. Operation names are listed
below. Unknown keys are validation errors throughout requests and nested payloads.
Successful response: `{schemaVersion:1,ok:true,data:object}`. Error response:
`{schemaVersion:1,ok:false,error:{code,message,details?:object}}`.
Export the operation union, Request union, Response union, public records, and
ContextSnapshot types. Concrete payloads/results must match the tables below;
no `any` or generic record in place of the public operation contracts.
For registration operations, projectId and actorId are forbidden; for all other
operations projectId is required. For reads other than inbox.list, actorId and
requestId are forbidden. For inbox.list actorId is required and requestId forbidden.
Validation error details contain only issue paths/codes, never submitted values.

`execute` is asynchronous at the interface so read-only Git collection can use
spawn; SQLite transactions are synchronous and never span an await or process.
Do not log requests, claim tokens, environment contents, or raw stack traces.

Error codes and CLI exit codes:

| Error | Exit | Meaning |
|---|---:|---|
| VALIDATION | 2 | Invalid shape, size, path, identifier or missing argument |
| NOT_FOUND | 3 | Project-scoped entity absent; includes wrong-project IDs |
| CONFLICT | 4 | Held claim, dependencies unmet, bad transition, idempotency mismatch |
| STALE_CLAIM | 5 | Wrong/expired/replaced claim token or owner |
| BUSY | 6 | SQLite lock not acquired within timeout |
| IO | 7 | File/Git/database access failure |
| INTERNAL | 1 | Unexpected fault; sanitized message |

## Common validation and public records

Generated IDs: UUIDs. Agent IDs: `[a-z][a-z0-9_-]{0,63}`, labels such as `muse`,
`flash`, `codex`, `human`. Identities are coordination labels, not authentication.
requestId: nonempty string <=128 characters; callers reuse it only for an exact
retry. Times stored as integer milliseconds and returned as UTC ISO strings.

Limits (characters unless noted): title 200; description 4000; summary 2000;
question/answer/decision body 4000; each string in unresolved/nextSteps 500;
arrays 20 items unless specified; JSON input 64 KiB in UTF-8; relative paths 400
chars and 100 entries max. No silent truncation on write. Reject absolute file
paths, `..` path segments, NUL, and duplicate paths in evidence. Relative paths
use `/`. Length limits apply after trim; required strings cannot become empty.

Project: `{id,name,root,gitCommonDir,createdAt}`. root and gitCommonDir are
canonical absolute realpaths. Name <=100. Git repositories only in v0.1.
Project registration uses read-only Git discovery. Worktrees with the same
realpath Git common directory resolve to the same project ID. Distinct clones
are distinct projects, even with the same remote URL. No remote URLs stored.

Agent: `{id,displayName,createdAt}`, global to this home; displayName <=100.
All actorId/toAgentId fields must refer to registered agents. Agent labels do
not prevent another local process running as the same user impersonating them.

Task: `{id,projectId,title,description,status,dependsOn,ownerId,attempt,
leaseUntil,createdAt,updatedAt}`. status=open|running|blocked|completed|cancelled;
ownerId and leaseUntil nullable. Do NOT include claimToken in task/context/list.
dependsOn <=20 unique task IDs in the same project, all must already exist.
Dependencies immutable; existing-only edges prevent cycles without graph editing.
Task ID is generated only at create, so self-dependency is impossible.

Evidence input: `{checkoutRoot,head,dirty,files,checks}`:
- checkoutRoot absolute canonicalizable path to a checkout of this project.
- head full 40- or 64-hex commit ID observed by agent; dirty boolean.
- files <=100 `{path,change}`; change=added|modified|deleted. Agent-reported.
- checks <=20 `{command,outcome,summary}`; command <=500, summary <=1000;
  outcome=passed|failed|not_run. Agent-reported; never executed by the product.

Handoff input: `{taskId,claimToken,outcome,summary,evidence,unresolved,nextSteps,
blockingQuestionIds}`; outcome=completed|blocked. unresolved/nextSteps arrays
can be empty. blockingQuestionIds required array (empty for completed; nonempty
for blocked), unique, same project/task, still unanswered on submission.

Stored Handoff removes claimToken from its input and adds `{id,projectId,taskId,actorId,attempt,createdAt,
observed:{checkoutRoot,head,dirty,collectedAt},evidenceSource:'agent_reported'}`
and never exposes the claimToken. observed is collected with read-only Git by
the core; reject mismatching reported head/dirty as CONFLICT. It does not verify
file assertions, test outcomes, or snapshot dirty content. Explicitly document
that dirty work can change later and immutable uncommitted content is not retained.

Question: `{id,projectId,taskId,fromAgentId,toAgentId,body,createdAt,
answer:Answer|null}`. Answer: `{id,actorId,body,createdAt}`. One answer per question;
only its addressed agent may answer. For a human answer, address it to `human`.

Decision: `{id,projectId,actorId,body,paths,supersedesId,createdAt}`. paths <=20
relative paths; empty means project-wide. SupersedesId nullable; must identify
an active decision in the same project. No destructive update/delete commands.

## Operations

Every operation other than project.register and agent.register requires
projectId. Every mutation requires actorId and requestId except the two register
operations, which require requestId but no actorId. Reads never require requestId.
Only inbox.list additionally requires actorId for recipient selection.

| Operation | payload | success data |
|---|---|---|
| project.register | `{root,name}` | `{project}` (existing canonical identity returns existing record, does not rename) |
| agent.register | `{id,displayName}` | `{agent}` (same id/name returns existing; different name CONFLICT) |
| task.create | `{title,description,dependsOn}` | `{task}` |
| task.get | `{taskId}` | `{task}` |
| task.list | `{status?:TaskStatus,limit?:number}` | `{tasks,omittedCount}` |
| task.claim | `{taskId}` | `{task,claimToken}` |
| task.renew | `{taskId,claimToken}` | `{task}` |
| task.release | `{taskId,claimToken}` | `{task}` |
| task.reopen | `{taskId}` | `{task}` |
| task.cancel | `{taskId}` | `{task}` |
| handoff.submit | Handoff input above | `{task,handoff}` |
| question.ask | `{taskId,toAgentId,body}` | `{question}` |
| question.answer | `{questionId,body}` | `{question}` |
| inbox.list | `{after?:number,limit?:number}` | `{events,nextCursor,hasMore}` |
| decision.record | `{body,paths,supersedesId}` | `{decision}` |
| context.get | `{taskId,mode?:'work'|'review'}` | `{snapshot:ContextSnapshot}` |

Read lists have default limit 20, range 1..100; no offset needed for task.list,
which returns newest-created first with ID ascending tie-break. task.get retrieves
an omitted task. context.get defaults mode to work. Context and inbox ordering
are defined separately below. Validation applies defaults before canonical hashing.

## SQLite tables and atomicity

Muse chooses indexes/SQL spelling but must implement these logical tables:
schema_migrations, projects, agents, tasks, task_dependencies, handoffs,
questions, answers, decisions, inbox_events, mutation_receipts.
Use strict schema constraints where feasible, parameterized queries, composite
project/entity foreign keys or equivalent transaction checks. UNIQUE answer per
question, UNIQUE handoff per (taskId,attempt), UNIQUE Git common dir, UNIQUE
receipt per (scope,actorKey,requestId). All foreign keys enforced on every connection.

Scope is projectId for project operations and a literal `global` for register
operations. actorKey is actorId, or `registration` for registrations. Canonical
request hash includes operation, project, actor, and validated payload with
object keys recursively sorted (array order preserved). Hash before adding
observations/timestamps; do not persist raw claim-token payloads in receipts.

All mutations use a short BEGIN IMMEDIATE transaction: look up receipt first;
same hash returns original response, different hash returns CONFLICT. Then check
state, mutate records, insert inbox events, insert receipt, commit. Any error
rolls back every effect and receipt. Do not cache failed requests. Receipt
responses to claim must retain the original token for exact retry; private DB
permissions protect them, and receipts are never included in public context.

For handoffs, check for an existing receipt before Git collection so a retry
still succeeds after the checkout moves/disappears; recheck it in the final
transaction. Collect Git observations outside the transaction, then validate
current task/lease/questions and write the handoff atomically. Git observations
are timestamped observations, not a filesystem lock.

Migrations are versioned and additive, never DROP existing state. First startup
and concurrent startup must serialize safely. WAL/busy setup must map contention
to BUSY rather than exposing raw SQLite errors. Close DB on every CLI exit.

## Task state machine

- New task: open, attempt 0, no owner/token/lease.
- Claim open or running with leaseUntil <= now: all dependencies completed;
  atomically running, attempt+1, owner=actor, new random token, leaseUntil=now+2h.
- Claim a live running task: CONFLICT, including same owner with a new requestId.
  Exact replay of the original request returns its original token/response.
- Renew: live running task + matching owner/token; leaseUntil=now+2h. At exact
  expiry renewal fails STALE_CLAIM. No automatic renewal process in v0.1.
- Release: matching live claim; task becomes open, owner/token/lease cleared;
  attempt is retained. No handoff needed; next claim increments attempt.
- Handoff completed: matching live claim; task completed, owner/token/lease
  cleared. Reject if blockingQuestionIds nonempty. Unanswered optional questions
  do not prevent completion.
- Handoff blocked: matching live claim and all supplied blocking questions
  unanswered; task blocked, owner/token/lease cleared, handoff retained.
- Reopen: blocked only, every question in its latest blocked handoff answered;
  task becomes open. Any registered actor can reopen. Answering alone does not
  change task status. Completed/cancelled cannot reopen in v0.1.
- Cancel: open/running/blocked -> cancelled, clears owner/token/lease. Any
  registered actor can cancel; this is coordination, not an authorization system.
  New cancellation of a terminal task is CONFLICT; exact retry remains successful.
- After terminal transition, late renew/release/handoff without matching receipt
  fails STALE_CLAIM; it never changes the task or adds a handoff.

Question ask is allowed on open/running/blocked tasks, with any registered actor;
terminal tasks reject new questions. Answers remain permitted after terminal
state because they can still help the asker. Decisions do not require task claims.

## Inbox

Events have monotonic integer id assigned by DB, projectId, recipientId,
kind=question|answer, questionId, taskId, body, createdAt. Asking inserts exactly
one event for toAgentId; answering inserts exactly one event for original asker.
Both event writes are in their parent transaction. No event for exact retries.

inbox.list filters project AND recipient AND event.id > after (default 0),
ascending event.id. nextCursor is the last returned id, or input after if empty.
hasMore indicates additional matching events. Reads never mark consumed.
No background delivery, unread count, acknowledgments, or agent wakeup claims.

## Context snapshot and rendering boundary

Core owns selection and project scoping. Flash owns formatting and final output
budget. Export ContextSnapshot with these named fields:
`{project,task,dependencies,handoffs,questions,decisions,currentGit,omitted,mode}`.

- dependencies: direct dependencies' Task records, at most 20.
- handoffs: current task and direct dependencies, newest first (createdAt desc,
  id asc), max 20. Include taskId on each. In review mode remove summary,
  unresolved, and nextSteps entirely; retain evidence/observed/outcome metadata.
  Use an explicit WorkHandoff|ReviewHandoff union, not empty placeholder strings.
- questions: current task only, unanswered first, then createdAt desc/id asc,
  max 20. Omit all questions in review mode to preserve independent judgment.
- decisions: active project-wide decisions plus active decisions whose paths
  exactly match any reported file path on selected handoffs, newest first,
  max 20. No fuzzy search/embeddings. Review mode includes these same decisions.
- currentGit: `{head,dirty,collectedAt,error}` for registered project.root;
  if absent/unreadable return null head/dirty and a sanitized error, not a
  failed context request. Evidence can be from a different worktree; differing
  heads are flagged for relevance checks, not declared incorrect or stale solely
  because they differ. Dirty observations are explicitly not immutable snapshots.
- omitted: counts omitted by selection for handoffs/questions/decisions; review
  omissions additionally identified as policy omissions, not presented as empty
  history. Cap data loaded and returned; do not return entire global history.

Exact omitted shape: `{handoffs:number,questions:number,decisions:number,
policy:{handoffNarratives:boolean,questions:number}}`. Top-level numbers count
records excluded by caps, not policy. In work mode policy is `{handoffNarratives:
false,questions:0}`. In review mode policy.questions counts all matching task
questions omitted; top-level questions is 0. policy.handoffNarratives is true.
For currentGit, collectedAt is always an ISO timestamp and error is string|null.
Review handoff shape is the stored handoff minus summary, unresolved, nextSteps;
blockingQuestionIds may remain as IDs with no question bodies.

All reads forming a snapshot use one SQLite read transaction. Git observation
happens outside it and has its own timestamp. Do not hold DB locks during Git.

Flash exports `renderContext(snapshot, maxChars=16000): string` from
`src/context/render.ts`. Pure function, no database or Git access. Range 4000..
32000; deterministic for the same snapshot and limit; JavaScript string length
is the budget unit, not tokens. Include task ID/status/title/description,
dependency IDs/statuses, observation limits, and omission counts before optional
detail. Task ID/status/title must remain complete. Description and dependency
titles may be visibly shortened to fit, but all direct dependency IDs/statuses
must remain. Reserve room for a truncation notice. Never exceed maxChars; truncate
optional bodies/rows deterministically and visibly. Escape terminal control
characters and Markdown fence injection in peer text; label it peer-provided
data, never executable instructions. JSON output remains valid structured data.

## CLI and file boundary

Syntax: `company <namespace> <verb> --input <file|-> [--home <directory>] [--json]`.
namespace.verb maps exactly to an Operation (e.g. `task claim`, `context get`).
Input contains the envelope fields EXCEPT operation; CLI inserts it. A supplied
operation key is an error. Required schemaVersion is 1. `--input -` reads bounded
stdin. Unknown flags, positionals, and commands fail VALIDATION before mutation.
Validate JSON/schema before opening state. CLI byte limit is applied while
reading, not after buffering an unbounded stream; files are also bounded while
reading because their size can change. Accept UTF-8 only. No input filename
extension restrictions. Do not read `.env` files automatically.

Global `--help` and `<namespace> <verb> --help` print help and exit 0 without
opening/creating a state directory. `--home` resolution is in CLI; core never
reads environment. Do not use a shell to run Git; use argument arrays with a
controlled cwd and timeout, and never execute user-supplied checks/paths as code.

With --json: emit exactly one response JSON value + newline on stdout, including
errors. Without --json: print concise human results; context.get uses renderer;
claim output must visibly include claimToken (needed for renew/handoff). All
other human output excludes tokens. Error messages human-readable on stderr.
Token returned to the caller is intentional; never copy it to progress reports.
Never output environment secrets, raw input on parse error, or full stack traces.

Additional local command: `company instructions show --project <uuid>
--agent <agent-id> [--home <directory>]`. Prints the generic integration snippet
with safely quoted concrete home/IDs and local executable path. Does not modify
files, execute a provider, open DB, or promise verified provider hooks. UUID and
agent-id validated syntactically. Output clearly explains required initialization.

State directory created only by a valid mutation or a valid read against existing
state; missing state on a read returns NOT_FOUND and must not create an empty DB.
Because openCore can initialize, Flash must avoid opening it for missing-state
reads. Core creates directory 0700 and DB 0600; WAL/SHM stay within that private
directory. No attempt to scan all user files for secrets or guarantee user-entered
messages contain none. State directories on network/shared filesystems unsupported.

## Example wire inputs (illustrative, not initialized data)

For `company project register --input - --json`:

```json
{"schemaVersion":1,"requestId":"register-fixture-1","payload":{"root":"/tmp/example-repo","name":"Example"}}
```

For `company task claim --input - --json`, after registration/task creation:

```json
{"schemaVersion":1,"projectId":"11111111-1111-4111-8111-111111111111","actorId":"muse","requestId":"claim-task-1","payload":{"taskId":"22222222-2222-4222-8222-222222222222"}}
```

For `company context get --input -`:

```json
{"schemaVersion":1,"projectId":"11111111-1111-4111-8111-111111111111","payload":{"taskId":"22222222-2222-4222-8222-222222222222","mode":"work"}}
```

Examples must replace illustrative IDs with actual returned IDs. Mutation callers
choose a new requestId for a new action and persist/reuse it for exact retries.
