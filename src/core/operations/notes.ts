import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { NoteAddData, NoteGetData, Request } from "../contracts.js";
import { OpError } from "../errors.js";
import { indexSearchDocument, isUniqueConstraint } from "../../storage/search-index.js";
import { tokenizeForSearch } from "../../storage/search-text.js";
import { withRead } from "../../storage/db.js";
import { requireAgent, requireProject, withMutation } from "./common.js";
import type { HandoffRow } from "./handoffs.js";
import {
  handoffToNoteRecord,
  loadSearchRecord,
  loadHandoffSuperseder,
  toNoteRecord,
  type NoteRow,
} from "./search.js";

type NoteAddRequest = Extract<Request, { operation: "note.add" }>;
type NoteGetRequest = Extract<Request, { operation: "note.get" }>;

function loadNote(db: DatabaseSync, projectId: string, noteId: string): NoteRow | undefined {
  return db.prepare("SELECT * FROM notes WHERE id = ? AND project_id = ?").get(noteId, projectId) as
    | unknown as NoteRow
    | undefined;
}

function loadHandoff(db: DatabaseSync, projectId: string, handoffId: string): HandoffRow | undefined {
  return db
    .prepare("SELECT * FROM handoffs WHERE id = ? AND project_id = ?")
    .get(handoffId, projectId) as unknown as HandoffRow | undefined;
}

function loadTaskInProject(
  db: DatabaseSync,
  projectId: string,
  taskId: string,
): { id: string } | undefined {
  return db.prepare("SELECT id FROM tasks WHERE id = ? AND project_id = ?").get(taskId, projectId) as
    | { id: string }
    | undefined;
}

function resolveSupersession(
  db: DatabaseSync,
  projectId: string,
  targetId: string,
): { kind: "note" | "handoff" } {
  const note = db.prepare("SELECT * FROM notes WHERE id = ?").get(targetId) as unknown as
    | NoteRow
    | undefined;
  if (note) {
    if (note.project_id !== projectId || note.superseded_by_id !== null) {
      throw OpError.conflict("superseded note is not current in this project");
    }
    return { kind: "note" };
  }
  const handoff = db.prepare("SELECT * FROM handoffs WHERE id = ?").get(targetId) as unknown as
    | HandoffRow
    | undefined;
  if (handoff) {
    if (handoff.project_id !== projectId) {
      throw OpError.conflict("superseded handoff is not current in this project");
    }
    const existing = loadHandoffSuperseder(db, projectId, targetId);
    if (existing !== null) {
      throw OpError.conflict("superseded handoff is not current in this project");
    }
    return { kind: "handoff" };
  }
  throw OpError.conflict("superseded item is not current in this project");
}

export function addNote(db: DatabaseSync, now: () => number, request: NoteAddRequest): NoteAddData {
  return withMutation(db, now, request, (nowMs) => {
    requireProject(db, request.projectId);
    requireAgent(db, request.actorId);
    const taskId = request.payload.taskId;
    if (taskId !== null && loadTaskInProject(db, request.projectId, taskId) === undefined) {
      throw OpError.notFound("task not found");
    }

    let supersedesKind: "note" | "handoff" | null = null;
    const target = request.payload.supersedesId;
    if (target !== null) {
      supersedesKind = resolveSupersession(db, request.projectId, target).kind;
    }

    const id = randomUUID();
    db.prepare(
      `INSERT INTO notes (
        id, project_id, author_id, title, finding, reason, evidence_refs_json, paths_json,
        observed_commit, status, task_id, supersedes_kind, supersedes_id, superseded_by_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    ).run(
      id,
      request.projectId,
      request.actorId,
      request.payload.title,
      request.payload.finding,
      request.payload.reason,
      JSON.stringify(request.payload.evidenceRefs),
      JSON.stringify(request.payload.paths),
      request.payload.observedCommit,
      request.payload.status,
      taskId,
      supersedesKind,
      target,
      nowMs,
    );

    if (target !== null && supersedesKind === "note") {
      const flipped = db
        .prepare(
          "UPDATE notes SET superseded_by_id = ? WHERE id = ? AND project_id = ? AND superseded_by_id IS NULL",
        )
        .run(id, target, request.projectId) as { changes: number | bigint };
      if (Number(flipped.changes) !== 1) {
        throw OpError.conflict("superseded note is not current in this project");
      }
    }
    if (target !== null && supersedesKind === "handoff") {
      try {
        db.prepare(
          "INSERT INTO handoff_supersessions (handoff_id, project_id, superseded_by_note_id, created_at) VALUES (?, ?, ?, ?)",
        ).run(target, request.projectId, id, nowMs);
      } catch (error) {
        if (isUniqueConstraint(error)) {
          throw OpError.conflict("superseded handoff is not current in this project");
        }
        throw error;
      }
    }

    const body = [
      request.payload.title,
      request.payload.finding,
      request.payload.reason,
      request.payload.evidenceRefs.join(" "),
      tokenizeForSearch(request.payload.paths.join(" ")),
    ].join(" ");
    indexSearchDocument(db, {
      projectId: request.projectId,
      source: "note",
      entityId: id,
      title: request.payload.title,
      body,
      paths: request.payload.paths,
      createdAt: nowMs,
    });

    const row = db.prepare("SELECT * FROM notes WHERE id = ?").get(id) as unknown as NoteRow;
    return { note: toNoteRecord(row) };
  });
}

export function getNote(db: DatabaseSync, request: NoteGetRequest): NoteGetData {
  return withRead(db, () => {
    requireProject(db, request.projectId);
    const note = loadNote(db, request.projectId, request.payload.noteId);
    if (note) return { note: toNoteRecord(note) };
    const handoff = loadHandoff(db, request.projectId, request.payload.noteId);
    if (handoff) {
      const supersededById = loadHandoffSuperseder(db, request.projectId, handoff.id);
      return { note: handoffToNoteRecord(handoff, supersededById) };
    }
    const other = loadSearchRecord(db, request.projectId, request.payload.noteId);
    if (other) return { note: other };
    throw OpError.notFound("note not found");
  });
}
