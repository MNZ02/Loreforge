# Loreforge — Wire Input Examples

This directory contains validated example inputs matching the Loreforge frozen specification (`CONTRACT.md`).

## CLI Invocation Format

All product CLI operations follow this command structure:

```bash
lore <namespace> <verb> --input <file|-> [--home <directory>] [--json]
```

Or during local development:

```bash
npm run lore -- <namespace> <verb> --input <file|-> [--home <directory>] [--json]
```

The CLI receives input without the `operation` field; the CLI automatically maps `<namespace> <verb>` to the required contract `operation` (for example, `task claim` maps to `task.claim`). Passing an explicit `operation` field inside the input file is a validation error.

## Example Input Index

| Operation | Input File | Description | Required Metadata |
|---|---|---|---|
| `project.register` | [`inputs/project-register.json`](file:///Users/mnz/dev/loreforge/examples/inputs/project-register.json) | Register a project by its git repository root | `requestId` |
| `agent.register` | [`inputs/agent-register-flash.json`](file:///Users/mnz/dev/loreforge/examples/inputs/agent-register-flash.json) | Register an agent identity | `requestId` |
| `task.create` | [`inputs/task-create-1.json`](file:///Users/mnz/dev/loreforge/examples/inputs/task-create-1.json) | Create a new root task | `projectId`, `actorId`, `requestId` |
| `task.create` | [`inputs/task-create-2-dependent.json`](file:///Users/mnz/dev/loreforge/examples/inputs/task-create-2-dependent.json) | Create a task with dependencies | `projectId`, `actorId`, `requestId` |
| `task.get` | [`inputs/task-get.json`](file:///Users/mnz/dev/loreforge/examples/inputs/task-get.json) | Retrieve task details | `projectId` (read) |
| `task.list` | [`inputs/task-list.json`](file:///Users/mnz/dev/loreforge/examples/inputs/task-list.json) | List tasks by status/limit | `projectId` (read) |
| `task.claim` | [`inputs/task-claim.json`](file:///Users/mnz/dev/loreforge/examples/inputs/task-claim.json) | Claim an open task | `projectId`, `actorId`, `requestId` |
| `task.renew` | [`inputs/task-renew.json`](file:///Users/mnz/dev/loreforge/examples/inputs/task-renew.json) | Renew an active 2h claim lease | `projectId`, `actorId`, `requestId` |
| `task.release` | [`inputs/task-release.json`](file:///Users/mnz/dev/loreforge/examples/inputs/task-release.json) | Release a claim back to open | `projectId`, `actorId`, `requestId` |
| `handoff.submit` | [`inputs/handoff-completed.json`](file:///Users/mnz/dev/loreforge/examples/inputs/handoff-completed.json) | Submit completed work with git evidence | `projectId`, `actorId`, `requestId` |
| `handoff.submit` | [`inputs/handoff-blocked.json`](file:///Users/mnz/dev/loreforge/examples/inputs/handoff-blocked.json) | Submit blocked status with questions | `projectId`, `actorId`, `requestId` |
| `task.reopen` | [`inputs/task-reopen.json`](file:///Users/mnz/dev/loreforge/examples/inputs/task-reopen.json) | Reopen a blocked task after questions answered | `projectId`, `actorId`, `requestId` |
| `task.cancel` | [`inputs/task-cancel.json`](file:///Users/mnz/dev/loreforge/examples/inputs/task-cancel.json) | Cancel an open, running, or blocked task | `projectId`, `actorId`, `requestId` |
| `question.ask` | [`inputs/question-ask.json`](file:///Users/mnz/dev/loreforge/examples/inputs/question-ask.json) | Ask a task-linked question | `projectId`, `actorId`, `requestId` |
| `question.answer` | [`inputs/question-answer.json`](file:///Users/mnz/dev/loreforge/examples/inputs/question-answer.json) | Answer a pending question | `projectId`, `actorId`, `requestId` |
| `inbox.list` | [`inputs/inbox-list.json`](file:///Users/mnz/dev/loreforge/examples/inputs/inbox-list.json) | List notifications for an agent | `projectId`, `actorId` (read) |
| `decision.record` | [`inputs/decision-record.json`](file:///Users/mnz/dev/loreforge/examples/inputs/decision-record.json) | Record an architectural decision | `projectId`, `actorId`, `requestId` |
| `context.get` | [`inputs/context-get-work.json`](file:///Users/mnz/dev/loreforge/examples/inputs/context-get-work.json) | Fetch work context snapshot | `projectId` (read) |
| `context.get` | [`inputs/context-get-review.json`](file:///Users/mnz/dev/loreforge/examples/inputs/context-get-review.json) | Fetch review context snapshot | `projectId` (read) |
| `note.add` | [`inputs/note-add.json`](inputs/note-add.json) | Record a standalone finding | `projectId`, `actorId`, `requestId` |
| `note.get` | [`inputs/note-get.json`](inputs/note-get.json) | Retrieve a note or searchable handoff | `projectId` (read) |
| `search.query` | [`inputs/search-query.json`](inputs/search-query.json) | Search current notes and handoffs | `projectId` (read) |

## Note on IDs

The UUIDs in these examples are illustrative. In practice, use actual returned IDs from previous operations:
- Replace `projectId` with the UUID returned by `project.register`.
- Replace `taskId` with the UUID returned by `task.create`.
- Replace `claimToken` with the secret token returned by `task.claim` (do not commit or publish tokens).
- Use distinct `requestId` strings for distinct mutation attempts, but reuse the exact `requestId` to safely retry an operation.
