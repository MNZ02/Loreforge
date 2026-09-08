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

// v2: project-scoped notes, handoff supersession, and FTS5 search documents.
// Existing handoffs are copied into search_docs so retrieval does not require
// rewriting them as notes. Token separators match src/storage/search-text.ts.
const V002 = `
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects (id),
  author_id TEXT NOT NULL REFERENCES agents (id),
  title TEXT NOT NULL,
  finding TEXT NOT NULL,
  reason TEXT NOT NULL,
  evidence_refs_json TEXT NOT NULL,
  paths_json TEXT NOT NULL,
  observed_commit TEXT NULL,
  status TEXT NOT NULL,
  task_id TEXT NULL REFERENCES tasks (id),
  supersedes_kind TEXT NULL,
  supersedes_id TEXT NULL,
  superseded_by_id TEXT NULL REFERENCES notes (id),
  created_at INTEGER NOT NULL,
  CHECK (status IN ('proposed', 'verified')),
  CHECK (
    (supersedes_kind IS NULL AND supersedes_id IS NULL)
    OR (supersedes_kind IN ('note', 'handoff') AND supersedes_id IS NOT NULL)
  )
) STRICT;
CREATE INDEX notes_by_project ON notes (project_id, created_at DESC, id ASC);
CREATE INDEX notes_current ON notes (project_id, superseded_by_id, created_at DESC);

CREATE TABLE handoff_supersessions (
  handoff_id TEXT PRIMARY KEY REFERENCES handoffs (id),
  project_id TEXT NOT NULL REFERENCES projects (id),
  superseded_by_note_id TEXT NOT NULL REFERENCES notes (id),
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX handoff_supersessions_by_note ON handoff_supersessions (superseded_by_note_id);

CREATE TABLE search_docs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects (id),
  source TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  paths_json TEXT NOT NULL,
  paths_text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (source, entity_id),
  CHECK (source IN ('note', 'handoff'))
) STRICT;
CREATE INDEX search_docs_by_project ON search_docs (project_id, created_at DESC, entity_id ASC);

CREATE VIRTUAL TABLE search_fts USING fts5(
  title,
  body,
  paths_text,
  content='search_docs',
  content_rowid='id',
  tokenize='unicode61'
);

INSERT INTO search_docs (project_id, source, entity_id, title, body, paths_json, paths_text, created_at)
SELECT
  h.project_id,
  'handoff',
  h.id,
  h.summary,
  replace(replace(replace(replace(replace(
    h.summary || ' ' || h.unresolved_json || ' ' || h.next_steps_json || ' ' || h.evidence_json,
    '_', ' '), '-', ' '), '/', ' '), '.', ' '), '\\', ' '),
  COALESCE(
    (
      SELECT json_group_array(json_extract(f.value, '$.path'))
      FROM json_each(json_extract(h.evidence_json, '$.files')) AS f
    ),
    '[]'
  ),
  replace(replace(replace(replace(replace(
    COALESCE(h.evidence_json, ''),
    '_', ' '), '-', ' '), '/', ' '), '.', ' '), '\\', ' '),
  h.created_at
FROM handoffs h;

INSERT INTO search_fts (rowid, title, body, paths_text)
SELECT id, title, body, paths_text FROM search_docs;
`;

// Only derived search tables are replaced. Original records remain intact.
const V003 = `
ALTER TABLE tasks ADD COLUMN created_by TEXT REFERENCES agents(id);
DROP TABLE search_fts;
DROP TABLE search_docs;
CREATE TABLE search_docs (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 project_id TEXT NOT NULL REFERENCES projects(id),
 source TEXT NOT NULL CHECK(source IN ('note','handoff','task','decision')),
 entity_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
 paths_json TEXT NOT NULL, paths_text TEXT NOT NULL, created_at INTEGER NOT NULL,
 UNIQUE(source, entity_id)
) STRICT;
CREATE INDEX search_docs_by_project ON search_docs(project_id, created_at DESC, entity_id ASC);
CREATE VIRTUAL TABLE search_fts USING fts5(title, body, paths_text, content='search_docs', content_rowid='id', tokenize='unicode61');
CREATE TABLE reviews (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id),
 handoff_id TEXT NOT NULL REFERENCES handoffs(id),
 task_id TEXT NOT NULL REFERENCES tasks(id),
 attempt INTEGER NOT NULL,
 actor_id TEXT NOT NULL REFERENCES agents(id),
 observed_commit TEXT NOT NULL,
 outcome TEXT NOT NULL CHECK(outcome IN ('approved','changes_requested')),
 body TEXT NOT NULL,
 created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX reviews_by_handoff ON reviews(project_id, handoff_id, id);
`;

export const MIGRATIONS: Migration[] = [
  { version: 1, sql: V001 },
  { version: 2, sql: V002 },
  { version: 3, sql: V003 },
];
