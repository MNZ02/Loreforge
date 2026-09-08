# Package workflows (0.2 alpha)

Loreforge records independent CLI work. These commands do not launch agents, schedule jobs, manage worktrees, merge, or deploy.

## Setup and discovery

```sh
lore init --agent codex:implement --agent claude:review --write-rules
lore doctor --json
lore project current --json
lore project list --json
lore agent list --json
```

Init stores a private `loreforge.json` binding in the repository's Git common directory, shared by its worktrees. Resolution is explicit `--home`, then `LOREFORGE_HOME` / `LORE_HOME` / `AGENT_COMPANY_HOME`, then that binding, then the default home. Init supports multiple projects in one home and roster updates. `--write-user-rules` writes generic current-repository instructions; it never pins a global rule to a project. Repository-local instructions retain their concrete project ID. An explicit home is never silently replaced by the binding.

Project-scoped CLI envelopes may omit `projectId` when the current repository is registered in the selected home. Scripts can continue supplying explicit IDs. The core API and MCP envelopes still require their documented project ID. Missing or malformed configuration produces an actionable error. `doctor` is diagnostic: it checks the selected project/binding, schema version, SQLite integrity/references, missing checkout paths, and conflicting repository rules. It does not silently migrate or repair state.

## Task discovery and recovery

```sh
lore task list --claimable --limit 20 --json
lore task list --expired --json
lore task list --status blocked --json
lore task list --limit 20 --cursor '<nextCursor>' --json
```

Task list returns `availability` keyed by task ID: `claimable`, `expired`, and `blockedBy` dependency IDs. Expired running tasks remain historically running until reclaimed; `--claimable` discovers them along with open tasks whose dependencies are complete. Claim is still authoritative and may lose a race after listing.

Pagination uses opaque `nextCursor`, or null at the end. Preserve the same status/claimable/expired filters between pages. Cursor order is creation time descending, then UUID ascending. `omittedCount` counts the remaining matching rows after that cursor. Listing is a point-in-time view; changing leases/status can change eligibility between requests. The envelope accepts `{limit,status?,claimable?,expired?,cursor?}`. `project list`, `agent list`, and `decision list` accept `{limit,after?}` envelopes and return `nextAfter`; decision list supports `includeSuperseded`.

## Search, history, and index maintenance

```sh
lore search --query 'retry recovery' --files ./src/ --limit 5 --json
lore note get '<id>' --json
lore decision list --json
lore index check --json
```

Search covers notes, handoffs, task titles/descriptions, and decisions. `note get` also loads a task or decision by ID. File filters are normalized (`src`, `src/`, and `./src` match the same scope). Eligibility and ranking apply before limiting; omission counts include all eligible matches. Do not combine envelope input with search filter flags.

For a source filter or commit comparison, use an envelope:

```sh
lore search --input - --json <<'EOF'
{"schemaVersion":1,"payload":{"query":"retry recovery","sources":["note","handoff"],"currentCommit":"<FULL_COMMIT_ID>","limit":5}}
EOF
```

Replace the commit placeholder before running. `sources` is optional; an empty list means all four sources. Hits include `observedCommit`, `evidenceDirty`, and `freshness`: `current_commit`, `different_commit`, `uncommitted`, or `unknown`. Different commit does not prove a finding is invalid; it means evidence needs rechecking. Without `currentCommit`, freshness is unknown unless the handoff recorded dirty changes. `verified` remains the author's assertion.

```sh
lore note history --input - --json <<'EOF'
{"schemaVersion":1,"payload":{"noteId":"<NOTE_OR_HANDOFF_ID>","limit":20}}
EOF
```

History walks the full correction chain from its original record, even if the starting ID is an intermediate correction. Supply `after: <nextAfter>` for the next page. Originals remain available; corrections do not rewrite task history.

```sh
lore index rebuild --input - --json <<'EOF'
{"schemaVersion":1,"actorId":"codex","requestId":"index-rebuild-1","payload":{}}
EOF
```

The actor must be registered. Check verifies source-document coverage/content and FTS consistency. Rebuild repairs derived search data transactionally and leaves records/receipts intact. Reuse a request ID only for an exact retry; use a new one for a later rebuild. Search indexes are rebuilt canonically during the v3 migration, including test evidence for both old and newly submitted handoffs.

## Structured reviews

```sh
lore review record --input - --json <<'EOF'
{"schemaVersion":1,"actorId":"claude","requestId":"review-1","payload":{"handoffId":"<HANDOFF_ID>","observedCommit":"<FULL_COMMIT_ID>","outcome":"changes_requested","body":"Describe the verified issue and evidence."}}
EOF
lore review list --input - --json <<'EOF'
{"schemaVersion":1,"payload":{"handoffId":"<HANDOFF_ID>","limit":20}}
EOF
```

Review outcomes are `approved` or `changes_requested`. The core binds each immutable record to the handoff's project, task, attempt and observed commit. An unknown/foreign handoff is rejected; a mismatched commit conflicts. Exact retries return the same review. No editing claim is required. Review does not complete/reopen tasks, merge work, certify an author's evidence, or assert that today's dirty files still match an earlier dirty handoff. Read the handoff evidence and recheck the current code. Reviews list by ID with an optional `after` cursor.

## MCP

Configure a stdio server in an MCP-capable client:

```json
{"command":"lore","args":["mcp","--home","/absolute/path/to/state"]}
```

Or run `lore mcp` with the client cwd set to the configured repository. The SDK handles protocol negotiation over stdio. Tools are named `lore_project_register`, `lore_task_list`, `lore_search_query`, and so on for all 27 core operations. Input is the normal core envelope without `operation`. Schemas expose required fields; mutations require caller-chosen request IDs. Tool errors carry the normal core error envelope. Application input is limited to 64 KiB and transport buffering to 128 KiB.

The adapter does not log arguments or results. A successful claim intentionally returns a private token to the caller; keep it out of shared notes. Read operations and exports do not expose claim tokens. No cloud, network listener, automatic model launch, or provider-specific authentication is introduced.

## Backup, restore and export

```sh
lore backup --output /safe/path/loreforge.sqlite3 --json
lore restore --input /safe/path/loreforge.sqlite3 --home /new/state/home --json
lore export --project '<PROJECT_ID>' --format json --output /safe/path/records.json
lore export --project '<PROJECT_ID>' --format markdown --output /safe/path/records.md
```

Backup uses SQLite's online backup API, including committed WAL content. It validates integrity and schema and refuses to overwrite an existing destination. The private binary backup includes the complete state, including private claim receipts; protect it like the original database.

Restore requires a **nonexistent** destination home. It validates a private copy, rejects incompatible future schema versions and broken databases, and applies supported migrations before publication. It never replaces an existing live home. Repository bindings are local Git metadata, not part of the database backup: after restore, use an explicit home or rerun init with that home to bind the repository.

JSON/Markdown export contains portable records, not an executable restore program. Optional `--project` restricts records and referenced agent identities to that project. Claim tokens and mutation receipts are excluded. Omit `--output` to write the export to stdout; file output refuses overwrite. Backups are the lossless restore format. Copying only a live SQLite main file is not a substitute for backup, and arbitrary network filesystems are not a synchronization protocol.
