import type { DatabaseSync } from "node:sqlite";
import { tokenizeForSearch } from "./search-text.js";

export type SearchDocSource = "note" | "handoff" | "task" | "decision";

export function indexSearchDocument(
  db: DatabaseSync,
  doc: {
    projectId: string;
    source: SearchDocSource;
    entityId: string;
    title: string;
    body: string;
    paths: string[];
    createdAt: number;
  },
): void {
  const titleText = tokenizeForSearch(doc.title);
  const bodyText = tokenizeForSearch(doc.body);
  const pathsText = tokenizeForSearch(doc.paths.join(" "));
  const inserted = db
    .prepare(
      "INSERT INTO search_docs (project_id, source, entity_id, title, body, paths_json, paths_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      doc.projectId,
      doc.source,
      doc.entityId,
      titleText,
      bodyText,
      JSON.stringify(doc.paths),
      pathsText,
      doc.createdAt,
    ) as { lastInsertRowid: number | bigint };
  const rowid = Number(inserted.lastInsertRowid);
  db.prepare("INSERT INTO search_fts (rowid, title, body, paths_text) VALUES (?, ?, ?, ?)").run(
    rowid,
    titleText,
    bodyText,
    pathsText,
  );
}

export function indexHandoffDocument(
  db: DatabaseSync,
  row: {
    id: string;
    project_id: string;
    summary: string;
    unresolved_json: string;
    next_steps_json: string;
    evidence_json: string;
    created_at: number;
  },
): void {
  let paths: string[] = [];
  try {
    const evidence = JSON.parse(row.evidence_json) as { files?: Array<{ path?: string }> };
    paths = (evidence.files ?? [])
      .map((file) => file.path)
      .filter((path): path is string => typeof path === "string");
  } catch {
    paths = [];
  }
  const body = [row.summary, row.unresolved_json, row.next_steps_json, row.evidence_json, paths.join(" ")].join(" ");
  indexSearchDocument(db, {
    projectId: row.project_id,
    source: "handoff",
    entityId: row.id,
    title: row.summary,
    body,
    paths,
    createdAt: row.created_at,
  });
}

export function isUniqueConstraint(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "errcode" in error) {
    const code = (error as { errcode?: unknown }).errcode;
    if (code === 19) return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /UNIQUE constraint failed/i.test(message);
}

export function indexTaskDocument(db: DatabaseSync, row: { id: string; project_id: string; title: string; description: string; created_at: number }): void {
  indexSearchDocument(db, { projectId: row.project_id, source: "task", entityId: row.id, title: row.title, body: row.description, paths: [], createdAt: row.created_at });
}

export function indexDecisionDocument(db: DatabaseSync, row: { id: string; project_id: string; body: string; paths_json: string; created_at: number }): void {
  indexSearchDocument(db, { projectId: row.project_id, source: "decision", entityId: row.id, title: row.body.slice(0, 200), body: row.body, paths: JSON.parse(row.paths_json), createdAt: row.created_at });
}

// Rebuild derived data only; authoritative records and receipts are untouched.
export function rebuildSearchIndex(db: DatabaseSync, projectId?: string): void {
  const where = projectId ? " WHERE project_id = ?" : "";
  const args = projectId ? [projectId] : [];
  db.exec("INSERT INTO search_fts(search_fts) VALUES ('delete-all')");
  db.prepare(`DELETE FROM search_docs${where}`).run(...args);
  for (const row of db.prepare(`SELECT * FROM notes${where}`).all(...args)) {
    const paths = JSON.parse(String(row.paths_json)) as string[];
    indexSearchDocument(db, { projectId: String(row.project_id), source: "note", entityId: String(row.id), title: String(row.title), body: [row.title, row.finding, row.reason, (JSON.parse(String(row.evidence_refs_json)) as string[]).join(" "), tokenizeForSearch(paths.join(" "))].join(" "), paths, createdAt: Number(row.created_at) });
  }
  for (const row of db.prepare(`SELECT * FROM handoffs${where}`).all(...args)) indexHandoffDocument(db, row as unknown as Parameters<typeof indexHandoffDocument>[1]);
  for (const row of db.prepare(`SELECT * FROM tasks${where}`).all(...args)) indexTaskDocument(db, row as unknown as Parameters<typeof indexTaskDocument>[1]);
  for (const row of db.prepare(`SELECT * FROM decisions${where}`).all(...args)) indexDecisionDocument(db, row as unknown as Parameters<typeof indexDecisionDocument>[1]);
  db.exec("INSERT INTO search_fts(search_fts) VALUES ('rebuild')");
}

export function checkSearchIndex(db: DatabaseSync, projectId: string): { healthy: boolean; documents: number; expected: number } {
  const documents = Number((db.prepare("SELECT count(*) AS n FROM search_docs WHERE project_id = ?").get(projectId) as {n: number}).n);
  let expected = 0;
  let healthy = true;
  for (const [source, table] of [["note", "notes"], ["handoff", "handoffs"], ["task", "tasks"], ["decision", "decisions"]]) {
    expected += Number((db.prepare(`SELECT count(*) AS n FROM ${table} WHERE project_id = ?`).get(projectId) as {n:number}).n);
    const rows = db.prepare(`SELECT * FROM ${table} WHERE project_id = ?`).all(projectId);
    for (const row of rows) {
      const doc = db.prepare("SELECT * FROM search_docs WHERE project_id = ? AND source = ? AND entity_id = ?").get(projectId, source, row.id);
      if (!doc) { healthy = false; continue; }
      let title = "", body = "", paths: string[] = [];
      if (source === "note") {
        title = String(row.title); paths = JSON.parse(String(row.paths_json));
        body = [row.title, row.finding, row.reason, (JSON.parse(String(row.evidence_refs_json)) as string[]).join(" "), tokenizeForSearch(paths.join(" "))].join(" ");
      } else if (source === "handoff") {
        title = String(row.summary);
        paths = ((JSON.parse(String(row.evidence_json)) as {files:Array<{path:string}>}).files ?? []).map(file => file.path);
        body = [row.summary, row.unresolved_json, row.next_steps_json, row.evidence_json, paths.join(" ")].join(" ");
      } else if (source === "task") { title = String(row.title); body = String(row.description); }
      else { title = String(row.body).slice(0, 200); body = String(row.body); paths = JSON.parse(String(row.paths_json)); }
      if (doc.title !== tokenizeForSearch(title) || doc.body !== tokenizeForSearch(body) || doc.paths_json !== JSON.stringify(paths) || doc.paths_text !== tokenizeForSearch(paths.join(" ")) || doc.created_at !== row.created_at) healthy = false;
    }
  }
  try { db.exec("INSERT INTO search_fts(search_fts, rank) VALUES ('integrity-check', 1)"); } catch { healthy = false; }
  return { healthy: healthy && documents === expected, documents, expected };
}
