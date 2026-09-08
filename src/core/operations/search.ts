import type { DatabaseSync } from "node:sqlite";
import type {
  NoteRecord,
  Request,
  SearchHit,
  SearchHitStatus,
  SearchQueryData,
  StoredEvidence,
} from "../contracts.js";
import { OpError } from "../errors.js";
import {
  SEARCH_EXCERPT_MAX,
  makeExcerpt,
  queryTokens,
  toFtsMatch,
} from "../../storage/search-text.js";
import { withRead } from "../../storage/db.js";
import { requireProject, toIso } from "./common.js";
import type { HandoffRow } from "./handoffs.js";

type SearchQueryRequest = Extract<Request, { operation: "search.query" }>;

export interface NoteRow {
  id: string;
  project_id: string;
  author_id: string;
  title: string;
  finding: string;
  reason: string;
  evidence_refs_json: string;
  paths_json: string;
  observed_commit: string | null;
  status: string;
  task_id: string | null;
  supersedes_kind: string | null;
  supersedes_id: string | null;
  superseded_by_id: string | null;
  created_at: number;
}

function parseStringArray(json: string): string[] {
  const value = JSON.parse(json) as unknown;
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function handoffPaths(row: HandoffRow): string[] {
  const evidence = JSON.parse(row.evidence_json) as StoredEvidence;
  return (evidence.files ?? []).map((file) => file.path);
}

function handoffEvidenceRefs(row: HandoffRow): string[] {
  const evidence = JSON.parse(row.evidence_json) as StoredEvidence;
  const refs: string[] = [];
  for (const file of evidence.files ?? []) refs.push(file.path);
  for (const check of evidence.checks ?? []) {
    if (check.summary) refs.push(check.summary);
  }
  return refs;
}

function handoffTitle(summary: string): string {
  const line = summary.replace(/\s+/g, " ").trim();
  return line.length <= 200 ? line : `${line.slice(0, 199)}…`;
}

export function toNoteRecord(row: NoteRow): NoteRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    source: "note",
    title: row.title,
    finding: row.finding,
    reason: row.reason,
    evidenceRefs: parseStringArray(row.evidence_refs_json),
    paths: parseStringArray(row.paths_json),
    authorId: row.author_id,
    createdAt: toIso(row.created_at),
    observedCommit: row.observed_commit,
    status: row.status as SearchHitStatus,
    taskId: row.task_id,
    supersedesId: row.supersedes_id,
    supersededById: row.superseded_by_id,
    current: row.superseded_by_id === null,
  };
}

export function handoffToNoteRecord(
  row: HandoffRow,
  supersededById: string | null,
): NoteRecord {
  const unresolved = parseStringArray(row.unresolved_json);
  const nextSteps = parseStringArray(row.next_steps_json);
  const reasonParts = [...unresolved, ...nextSteps];
  return {
    id: row.id,
    projectId: row.project_id,
    source: "handoff",
    title: handoffTitle(row.summary),
    finding: row.summary,
    reason: reasonParts.length > 0 ? reasonParts.join("\n") : "Task handoff; see finding and evidence.",
    evidenceRefs: handoffEvidenceRefs(row),
    paths: handoffPaths(row),
    authorId: row.actor_id,
    createdAt: toIso(row.created_at),
    observedCommit: row.observed_head,
    evidenceDirty: Boolean(row.observed_dirty),
    status: row.outcome as SearchHitStatus,
    taskId: row.task_id,
    supersedesId: null,
    supersededById,
    current: supersededById === null,
  };
}

export function loadHandoffSuperseder(
  db: DatabaseSync,
  projectId: string,
  handoffId: string,
): string | null {
  const row = db
    .prepare(
      "SELECT superseded_by_note_id FROM handoff_supersessions WHERE handoff_id = ? AND project_id = ?",
    )
    .get(handoffId, projectId) as { superseded_by_note_id: string } | undefined;
  return row?.superseded_by_note_id ?? null;
}

function toHit(note: NoteRecord, excerpt: string): SearchHit {
  return {
    id: note.id,
    source: note.source,
    title: note.title,
    excerpt,
    status: note.status,
    evidenceRefs: note.evidenceRefs,
    paths: note.paths,
    authorId: note.authorId,
    taskId: note.taskId,
    current: note.current,
    observedCommit: note.observedCommit,
    evidenceDirty: note.evidenceDirty ?? null,
    revision: {
      supersedesId: note.supersedesId,
      supersededById: note.supersededById,
      createdAt: note.createdAt,
      current: note.current,
    },
  };
}

export function loadSearchRecord(db: DatabaseSync, projectId: string, id: string): NoteRecord | undefined {
  const note = db.prepare("SELECT * FROM notes WHERE id = ? AND project_id = ?").get(id, projectId) as unknown as NoteRow | undefined;
  if (note) return toNoteRecord(note);
  const handoff = db.prepare("SELECT * FROM handoffs WHERE id = ? AND project_id = ?").get(id, projectId) as unknown as HandoffRow | undefined;
  if (handoff) return handoffToNoteRecord(handoff, loadHandoffSuperseder(db, projectId, id));
  const task = db.prepare("SELECT * FROM tasks WHERE id = ? AND project_id = ?").get(id, projectId);
  if (task) return { id, projectId, source: "task", title: String(task.title), finding: String(task.description), reason: "Task record", evidenceRefs: [], paths: [], authorId: task.created_by === null || task.created_by === undefined ? null : String(task.created_by), createdAt: toIso(Number(task.created_at)), observedCommit: null, status: task.status as SearchHitStatus, taskId: id, supersedesId: null, supersededById: null, current: true };
  const decision = db.prepare("SELECT * FROM decisions WHERE id = ? AND project_id = ?").get(id, projectId);
  if (decision) return { id, projectId, source: "decision", title: String(decision.body).slice(0, 200), finding: String(decision.body), reason: "Architectural decision", evidenceRefs: [], paths: parseStringArray(String(decision.paths_json)), authorId: String(decision.actor_id), createdAt: toIso(Number(decision.created_at)), observedCommit: null, status: decision.superseded_by_id === null ? "active" : "superseded", taskId: null, supersedesId: decision.supersedes_id as string | null, supersededById: decision.superseded_by_id as string | null, current: decision.superseded_by_id === null };
  return undefined;
}

export function searchQuery(db: DatabaseSync, request: SearchQueryRequest): SearchQueryData {
  return withRead(db, () => {
    requireProject(db, request.projectId);
    const tokens = queryTokens(request.payload.query);
    const match = toFtsMatch(request.payload.query);
    if (!match) throw OpError.validation("query has no searchable tokens");
    const { files, sources, includeSuperseded, currentCommit } = request.payload;
    const conditions = ["d.project_id = ?", "search_fts MATCH ?", "lore_paths_overlap(d.paths_json, ?) = 1"];
    const params: Array<string | number> = [request.projectId, match, JSON.stringify(files)];
    if (sources.length) { conditions.push(`d.source IN (${sources.map(() => "?").join(",")})`); params.push(...sources); }
    if (!includeSuperseded) conditions.push(`
      (d.source != 'note' OR EXISTS(SELECT 1 FROM notes n WHERE n.id = d.entity_id AND n.superseded_by_id IS NULL)) AND
      (d.source != 'handoff' OR NOT EXISTS(SELECT 1 FROM handoff_supersessions h WHERE h.handoff_id = d.entity_id)) AND
      (d.source != 'decision' OR EXISTS(SELECT 1 FROM decisions x WHERE x.id = d.entity_id AND x.superseded_by_id IS NULL))`);
    const from = `FROM search_fts JOIN search_docs d ON d.id = search_fts.rowid WHERE ${conditions.join(" AND ")}`;
    const total = (db.prepare(`SELECT count(*) AS n ${from}`).get(...params) as {n:number}).n;
    // Filter and rank before limiting. An irrelevant or superseded record can
    // never consume the result budget or make a real match look absent.
    const rows = db.prepare(`SELECT d.entity_id ${from}
      ORDER BY lore_title_hits(d.title, ?) DESC, lore_path_hits(d.paths_json, ?) DESC,
      search_fts.rank ASC, d.created_at DESC, d.entity_id ASC LIMIT ?`).all(...params, request.payload.query, JSON.stringify(files), request.payload.limit) as { entity_id: string }[];
    const hits = rows.flatMap(row => {
      const note = loadSearchRecord(db, request.projectId, row.entity_id);
      if (!note) return [];
      const hit = toHit(note, makeExcerpt(note.finding, tokens, SEARCH_EXCERPT_MAX));
      hit.freshness = note.evidenceDirty ? "uncommitted" : !currentCommit || !note.observedCommit ? "unknown" : note.observedCommit.toLowerCase() === currentCommit.toLowerCase() ? "current_commit" : "different_commit";
      return [hit];
    });
    return { hits, omittedCount: Math.max(0, total - hits.length) };
  });
}
