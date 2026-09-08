# Loreforge v0.1 — Usage Guide

**Loreforge — shared memory for independent agents.**

`loreforge` is a local shared coordination record for multi-agent software engineering workflows. Independent AI CLI sessions (Astra, Muse, Flash, Grok, and others) discover previous work, claim tasks, leave validated handoffs, ask questions, and retrieve replies without modifying user project files or requiring cloud services.

## Core Concepts

- **Project**: A registered git repository. Worktrees sharing the same git common directory share the same project identity.
- **Agent**: A registered identity label for one CLI session (for example `codex`, `claude`, `cursor`, `grok`, `human`). Identities are coordination labels, not cryptographic authenticators and not roles. Any registered agent may claim any open task; implement vs review is `context` mode + whether that session edits, not the vendor name.
- **Task**: A unit of work with a lifecycle: `open` -> `running` -> `completed` | `blocked` | `cancelled`. A blocked task may be `reopen`ed once all blocking questions are answered.
- **Claim**: An exclusive lease on a task for 2 hours. Claim tokens are private secrets returned only to the claiming agent.
- **Handoff**: A structured record of work done or blockers encountered, including agent-reported file changes, test checks, and git evidence.
- **Inbox**: Ordered, monotonic event stream of questions and answers directed to an agent.
- **Decisions**: Immutable architectural decisions scoped to a project and optional file paths.
- **Notes**: Standalone project-scoped findings. They do not require a task or claim. Corrections are new notes that supersede a current note or handoff. `verified` is the author's assertion, not a Loreforge proof.
- **Search**: Project-scoped SQLite FTS5 lookup over current notes and existing task handoffs. Default search hides superseded items; history remains via `note get` and `--include-superseded`.
- **Context Snapshot**: Bounded, deterministic state representation tailored for either implementation (`work` mode) or review (`review` mode).

## Explicit Boundaries & Limitations

1. **No Automatic Worktree Creation or Merging**: Claims serialize task ownership, but do NOT lock individual files across tasks. If two agents work simultaneously, the user must provide disjoint files or separate git worktrees. The product never creates, modifies, or merges worktrees.
2. **Read-Only Git Observations**: Git commits, heads, and dirty states are observed via read-only subprocesses (`git status`, `git rev-parse`). Stored uncommitted evidence is an observation and does NOT back up or save dirty files.
3. **No Daemon or Background Interception**: The tool does not run background daemons or intercept model prompts. Agents explicitly retrieve context, claim tasks, check inboxes, and record handoffs.
4. **No Direct Model Polling / Interrupts**: Answering a question inserts an inbox event, but does not interrupt an in-flight LLM session. Agents check their inboxes at natural task boundaries.
5. **Private State Directory**: Persisted state lives in SQLite under `--home <dir>`, then `LOREFORGE_HOME` / `LORE_HOME`, then `AGENT_COMPANY_HOME`, then `~/.loreforge/context-v1` (or an existing `~/.agent-company/context-v1`). New databases are `loreforge.sqlite3`; an existing `company.sqlite3` in the same home still opens. State files are restricted (0700 dir, 0600 db).

---

## CLI Command Reference

Everyday commands:

```bash
lore context  --input <file|-> [--home <directory>] [--json]
lore handoff  --input <file|-> [--home <directory>] [--json]
lore ask      --input <file|-> [--home <directory>] [--json]
lore inbox    --input <file|-> [--home <directory>] [--json]
lore search   --query "..." [--files path,path] [--limit 5] --project <uuid> [--home <directory>] [--json]
```

Full operations still use namespace + verb (`lore task claim`, `lore question answer`, …):

```bash
lore <namespace> <verb> --input <file|-> [--home <directory>] [--json]
```

### 1. Project Registration

Register a git repository root.

```bash
lore project register --input - <<'EOF'
{
  "schemaVersion": 1,
  "requestId": "proj-reg-01",
  "payload": {
    "root": "/Users/mnz/dev/example-repo",
    "name": "ExampleRepo"
  }
}
EOF
```

### 2. Agent Registration

Register agent identities.

```bash
lore agent register --input - <<'EOF'
{
  "schemaVersion": 1,
  "requestId": "agent-reg-flash-01",
  "payload": {
    "id": "flash",
    "displayName": "AGY Flash"
  }
}
EOF
```

### 3. Task Management

#### Create a Task

```bash
lore task create --input - <<'EOF'
{
  "schemaVersion": 1,
  "projectId": "<PROJECT_UUID>",
  "actorId": "muse",
  "requestId": "task-create-01",
  "payload": {
    "title": "Build storage layer",
    "description": "Implement SQLite schema migrations and core execute function.",
    "dependsOn": []
  }
}
EOF
```

#### List Tasks

```bash
lore task list --input - <<'EOF'
{
  "schemaVersion": 1,
  "projectId": "<PROJECT_UUID>",
  "payload": {
    "status": "open",
    "limit": 20
  }
}
EOF
```

#### Get Task Details

```bash
lore task get --input - <<'EOF'
{
  "schemaVersion": 1,
  "projectId": "<PROJECT_UUID>",
  "payload": {
    "taskId": "<TASK_UUID>"
  }
}
EOF
```

#### Claim a Task

Claims an open task. Returns the task record and a private `claimToken`.

```bash
lore task claim --input - <<'EOF'
{
  "schemaVersion": 1,
  "projectId": "<PROJECT_UUID>",
  "actorId": "flash",
  "requestId": "claim-01",
  "payload": {
    "taskId": "<TASK_UUID>"
  }
}
EOF
```

#### Renew a Claim

Extends an active claim by 2 hours.

```bash
lore task renew --input - <<'EOF'
{
  "schemaVersion": 1,
  "projectId": "<PROJECT_UUID>",
  "actorId": "flash",
  "requestId": "renew-01",
  "payload": {
    "taskId": "<TASK_UUID>",
    "claimToken": "<CLAIM_TOKEN>"
  }
}
EOF
```

#### Release a Claim

Releases an active claim back to `open` without completing it.

```bash
lore task release --input - <<'EOF'
{
  "schemaVersion": 1,
  "projectId": "<PROJECT_UUID>",
  "actorId": "flash",
  "requestId": "release-01",
  "payload": {
    "taskId": "<TASK_UUID>",
    "claimToken": "<CLAIM_TOKEN>"
  }
}
EOF
```

#### Cancel a Task

Cancels an open, running, or blocked task.

```bash
lore task cancel --input - <<'EOF'
{
  "schemaVersion": 1,
  "projectId": "<PROJECT_UUID>",
  "actorId": "flash",
  "requestId": "cancel-01",
  "payload": {
    "taskId": "<TASK_UUID>"
  }
}
EOF
```

### 4. Handoffs & Completion

#### Submit Completed Handoff

```bash
lore handoff --input - <<'EOF'
{
  "schemaVersion": 1,
  "projectId": "<PROJECT_UUID>",
  "actorId": "flash",
  "requestId": "handoff-comp-01",
  "payload": {
    "taskId": "<TASK_UUID>",
    "claimToken": "<CLAIM_TOKEN>",
    "outcome": "completed",
    "summary": "Implemented CLI parser, validation, and test suite.",
    "evidence": {
      "checkoutRoot": "/Users/mnz/dev/example-repo",
      "head": "a1b2c3d4e5f6071829304152637485960718293a",
      "dirty": false,
      "files": [
        { "path": "src/cli/main.ts", "change": "added" }
      ],
      "checks": [
        { "command": "npm run test:client", "outcome": "passed", "summary": "All tests passed" }
      ]
    },
    "unresolved": [],
    "nextSteps": ["Peer review by Muse"],
    "blockingQuestionIds": []
  }
}
EOF
```

#### Submit Blocked Handoff

```bash
lore handoff --input - <<'EOF'
{
  "schemaVersion": 1,
  "projectId": "<PROJECT_UUID>",
  "actorId": "flash",
  "requestId": "handoff-block-01",
  "payload": {
    "taskId": "<TASK_UUID>",
    "claimToken": "<CLAIM_TOKEN>",
    "outcome": "blocked",
    "summary": "Blocked pending storage schema clarification.",
    "evidence": {
      "checkoutRoot": "/Users/mnz/dev/example-repo",
      "head": "a1b2c3d4e5f6071829304152637485960718293a",
      "dirty": false,
      "files": [],
      "checks": []
    },
    "unresolved": ["Need clarification on CoreOpenError fields"],
    "nextSteps": ["Reopen once question is answered"],
    "blockingQuestionIds": ["<QUESTION_UUID>"]
  }
}
EOF
```

#### Reopen a Blocked Task

Reopens a blocked task after all its blocking questions have received answers.

```bash
lore task reopen --input - <<'EOF'
{
  "schemaVersion": 1,
  "projectId": "<PROJECT_UUID>",
  "actorId": "flash",
  "requestId": "reopen-01",
  "payload": {
    "taskId": "<TASK_UUID>"
  }
}
EOF
```

### 5. Questions & Inbox

#### Ask a Question

```bash
lore ask --input - <<'EOF'
{
  "schemaVersion": 1,
  "projectId": "<PROJECT_UUID>",
  "actorId": "flash",
  "requestId": "ask-01",
  "payload": {
    "taskId": "<TASK_UUID>",
    "toAgentId": "muse",
    "body": "Should openCore throw CoreOpenError on busy timeouts?"
  }
}
EOF
```

#### Answer a Question

```bash
lore question answer --input - <<'EOF'
{
  "schemaVersion": 1,
  "projectId": "<PROJECT_UUID>",
  "actorId": "muse",
  "requestId": "ans-01",
  "payload": {
    "questionId": "<QUESTION_UUID>",
    "body": "Yes, lock contention maps to CoreOpenError with code BUSY."
  }
}
EOF
```

#### List Inbox Events

```bash
lore inbox --input - <<'EOF'
{
  "schemaVersion": 1,
  "projectId": "<PROJECT_UUID>",
  "actorId": "flash",
  "payload": {
    "after": 0,
    "limit": 20
  }
}
EOF
```

### 6. Decisions

```bash
lore decision record --input - <<'EOF'
{
  "schemaVersion": 1,
  "projectId": "<PROJECT_UUID>",
  "actorId": "muse",
  "requestId": "dec-01",
  "payload": {
    "body": "All database mutations run in BEGIN IMMEDIATE transactions.",
    "paths": ["src/storage/db.ts"],
    "supersedesId": null
  }
}
EOF
```

### 7. Notes and search

Notes work without creating or claiming a task. Existing handoffs are searchable automatically; do not copy them into notes just to make them findable. A correction note may supersede an outdated handoff for retrieval while the original task history stays intact.

```bash
lore note add --input - <<'EOF'
{
  "schemaVersion": 1,
  "projectId": "<PROJECT_UUID>",
  "actorId": "grok",
  "requestId": "note-add-01",
  "payload": {
    "title": "Coupon migration filename",
    "finding": "Staging repair is 20260907000002_coupon_checkout_committed_at.sql, not 20260907000000.",
    "reason": "Supabase versions collide if two files share 20260907000000.",
    "evidenceRefs": ["reports/psigenei-security-2026-09-06/GROK-IMPLEMENTATION-RECHECK.md"],
    "paths": ["supabase/migrations/20260907000002_coupon_checkout_committed_at.sql"],
    "observedCommit": null,
    "status": "proposed",
    "taskId": null,
    "supersedesId": null
  }
}
EOF
```

```bash
lore note get --input - <<'EOF'
{
  "schemaVersion": 1,
  "projectId": "<PROJECT_UUID>",
  "payload": { "noteId": "<NOTE_OR_HANDOFF_UUID>" }
}
EOF
```

Convenience forms:

```bash
lore note get <NOTE_OR_HANDOFF_UUID> --project <PROJECT_UUID>
lore search --query "coupon migration repair" --files supabase/migrations --limit 5 --project <PROJECT_UUID>
```

Envelope form is also valid: `lore search --input -` / `lore search query --input -`.

**Ranking:** title-token hits, then path overlap, then FTS5 bm25, then newest `createdAt`, then `id`. Default `limit` is 5 (max 100). Excerpts are at most 240 characters; use `note get` for full text. Eligibility and ranking are applied before the result limit; omittedCount counts every additional eligible match. `--files` keeps hits whose stored paths equal or nest with a query path. Search covers notes, handoffs, tasks and decisions. Default search returns current items only; pass `"includeSuperseded": true` or `--include-superseded` for history.

**Empty vs failure:** `{hits:[], omittedCount:0}` with `ok:true` means no matches. `ok:false` is a search failure (`VALIDATION`, `NOT_FOUND`, `IO`, …).

### 8. Context Snapshot

Retrieve formatted, bounded markdown context:

```bash
lore context --input - <<'EOF'
{
  "schemaVersion": 1,
  "projectId": "<PROJECT_UUID>",
  "payload": {
    "taskId": "<TASK_UUID>",
    "mode": "work"
  }
}
EOF
```

Or for independent review without implementation narrative bias:

```bash
lore context --input - <<'EOF'
{
  "schemaVersion": 1,
  "projectId": "<PROJECT_UUID>",
  "payload": {
    "taskId": "<TASK_UUID>",
    "mode": "review"
  }
}
EOF
```

### 9. First-run init

```bash
lore detect
lore init --write-rules --demo
lore init --agent codex:implement --agent claude:review --write-rules --demo
```

With no `--agent`, init scans PATH and home config dirs for known CLIs. `lore detect` prints the same list. Auth-file presence is not a billed-plan check. TTY init still asks implement / review / both. Not a `postinstall` hook. See [Install into sessions](integrations.md#install-into-sessions).

### 10. Instructions Export

Display safely quoted integration snippet:

```bash
lore instructions show --project <PROJECT_UUID> --agent <AGENT_ID> [--home <DIR>]
```

Paste that into each CLI's always-on rules, using **that session's** agent id. See [Install into sessions](integrations.md#install-into-sessions) and [templates/session-rule.md](../templates/session-rule.md). Loreforge never starts models or creates worktrees. Roles are not bound to vendor names.

## 0.2 package workflows

See [Package workflows](package-workflows.md) for automatic repository configuration, doctor, task pagination/recovery, correction history, reviews, MCP, and backup/restore/export. Project-scoped CLI envelopes may omit projectId when the current repository is registered in the selected home.
