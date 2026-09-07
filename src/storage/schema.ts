// Versioned additive migrations. Never DROP existing state; each version
// applies once inside the startup transaction in db.ts.

export interface Migration {
  version: number;
  sql: string;
}

// v1 creates every logical table from CONTRACT.md in one additive step so
// later milestones add behavior, not schema. Domains are still implemented
// and tested one milestone at a time.
const V001 = `
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root TEXT NOT NULL,
  git_common_dir TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL,
  owner_id TEXT NULL REFERENCES agents (id),
  claim_token TEXT NULL,
  attempt INTEGER NOT NULL,
  lease_until INTEGER NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX tasks_by_project ON tasks (project_id, created_at DESC, id ASC);

CREATE TABLE task_dependencies (
  task_id TEXT NOT NULL REFERENCES tasks (id),
  depends_on_task_id TEXT NOT NULL REFERENCES tasks (id),
  PRIMARY KEY (task_id, depends_on_task_id)
) STRICT;
CREATE INDEX task_dependencies_by_parent ON task_dependencies (depends_on_task_id);

CREATE TABLE handoffs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id),
  task_id TEXT NOT NULL REFERENCES tasks (id),
  actor_id TEXT NOT NULL REFERENCES agents (id),
  attempt INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  summary TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  unresolved_json TEXT NOT NULL,
  next_steps_json TEXT NOT NULL,
  blocking_ids_json TEXT NOT NULL,
  observed_checkout_root TEXT NOT NULL,
  observed_head TEXT NOT NULL,
  observed_dirty INTEGER NOT NULL,
  observed_collected_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (task_id, attempt)
) STRICT;
CREATE INDEX handoffs_by_task ON handoffs (task_id, created_at DESC, id ASC);

CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id),
  task_id TEXT NOT NULL REFERENCES tasks (id),
  from_agent_id TEXT NOT NULL REFERENCES agents (id),
  to_agent_id TEXT NOT NULL REFERENCES agents (id),
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX questions_by_task ON questions (task_id, created_at DESC, id ASC);

CREATE TABLE answers (
  question_id TEXT PRIMARY KEY REFERENCES questions (id),
  id TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES agents (id),
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE decisions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id),
  actor_id TEXT NOT NULL REFERENCES agents (id),
  body TEXT NOT NULL,
  paths_json TEXT NOT NULL,
  supersedes_id TEXT NULL REFERENCES decisions (id),
  superseded_by_id TEXT NULL REFERENCES decisions (id),
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX decisions_by_project ON decisions (project_id, created_at DESC, id ASC);

CREATE TABLE inbox_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects (id),
  recipient_id TEXT NOT NULL REFERENCES agents (id),
  kind TEXT NOT NULL,
  question_id TEXT NOT NULL REFERENCES questions (id),
  task_id TEXT NOT NULL REFERENCES tasks (id),
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX inbox_by_recipient ON inbox_events (project_id, recipient_id, id ASC);

CREATE TABLE mutation_receipts (
  scope TEXT NOT NULL,
  actor_key TEXT NOT NULL,
  request_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (scope, actor_key, request_id)
) STRICT;
`;

export const MIGRATIONS: Migration[] = [{ version: 1, sql: V001 }];
