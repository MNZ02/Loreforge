import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Request, ExtensionData, Review } from "../contracts.js";
import { OpError } from "../errors.js";
import { withRead, withWrite } from "../../storage/db.js";
import { checkSearchIndex, rebuildSearchIndex } from "../../storage/search-index.js";
import { requireProject, requireAgent, withMutation, toProject, toAgent, toIso } from "./common.js";
import { toDecision, type DecisionRow } from "./decisions.js";
import { loadSearchRecord } from "./search.js";

function toReview(row: Record<string, any>): Review {
  return { id: row.id, projectId: row.project_id, taskId: row.task_id, handoffId: row.handoff_id,
    attempt: row.attempt, actorId: row.actor_id, observedCommit: row.observed_commit,
    outcome: row.outcome, body: row.body, createdAt: toIso(row.created_at) };
}

export function extensionOperation(db: DatabaseSync, now: () => number, request: Request): ExtensionData {
  if (request.operation === "project.list" || request.operation === "agent.list") {
    const table = request.operation === "project.list" ? "projects" : "agents";
    const rows = db.prepare(`SELECT * FROM ${table} WHERE id > ? ORDER BY id LIMIT ?`).all(request.payload.after ?? "", request.payload.limit + 1);
    const more = rows.length > request.payload.limit;
    const page = rows.slice(0, request.payload.limit);
    return { ...(table === "projects" ? { projects: page.map(row => toProject(row as any)) } : { agents: page.map(row => toAgent(row as any)) }), nextAfter: more ? String(page.at(-1)!.id) : null };
  }
  if (request.operation === "review.record") return withMutation(db, now, request, nowMs => {
    requireProject(db, request.projectId); requireAgent(db, request.actorId);
    const h = db.prepare("SELECT * FROM handoffs WHERE id = ? AND project_id = ?").get(request.payload.handoffId, request.projectId);
    if (!h) throw OpError.notFound("handoff not found");
    if (String(h.observed_head).toLowerCase() !== request.payload.observedCommit.toLowerCase()) throw OpError.conflict("review commit must match the handoff observation");
    const id = randomUUID();
    db.prepare("INSERT INTO reviews (id,project_id,handoff_id,task_id,attempt,actor_id,observed_commit,outcome,body,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(id, request.projectId, h.id, h.task_id, h.attempt, request.actorId, request.payload.observedCommit.toLowerCase(), request.payload.outcome, request.payload.body, nowMs);
    return { review: toReview(db.prepare("SELECT * FROM reviews WHERE id = ?").get(id)!) };
  });
  if (request.operation === "index.rebuild") return withMutation(db, now, request, () => {
    requireProject(db, request.projectId); requireAgent(db, request.actorId);
    rebuildSearchIndex(db, request.projectId);
    return { index: { ...checkSearchIndex(db, request.projectId), rebuilt: true } };
  });
  if (request.operation === "index.check") return withWrite(db, () => {
    requireProject(db, request.projectId);
    return { index: checkSearchIndex(db, request.projectId) };
  });
  return withRead(db, () => {
    if (!("projectId" in request)) throw OpError.validation("project is required");
    requireProject(db, request.projectId);
    if (request.operation === "review.list") {
      if (!db.prepare("SELECT id FROM handoffs WHERE id = ? AND project_id = ?").get(request.payload.handoffId, request.projectId)) throw OpError.notFound("handoff not found");
      const rows = db.prepare("SELECT * FROM reviews WHERE project_id = ? AND handoff_id = ? AND id > ? ORDER BY id LIMIT ?").all(request.projectId, request.payload.handoffId, request.payload.after ?? "", request.payload.limit + 1);
      const page = rows.slice(0, request.payload.limit);
      return { reviews: page.map(toReview), nextAfter: rows.length > page.length ? String(page.at(-1)!.id) : null };
    }
    if (request.operation === "decision.list") {
      const rows = db.prepare(`SELECT * FROM decisions WHERE project_id = ? AND id > ? ${request.payload.includeSuperseded ? "" : "AND superseded_by_id IS NULL"} ORDER BY id LIMIT ?`).all(request.projectId, request.payload.after ?? "", request.payload.limit + 1) as unknown as DecisionRow[];
      const page = rows.slice(0, request.payload.limit);
      return { decisions: page.map(toDecision), nextAfter: rows.length > page.length ? page.at(-1)!.id : null };
    }
    if (request.operation === "note.history") {
      let row = loadSearchRecord(db, request.projectId, request.payload.noteId);
      if (!row) throw OpError.notFound("note not found");
      // Traverse backwards to the root, then forward. Detect corrupt cycles.
      const visited = new Set<string>();
      while (row.supersedesId) {
        if (visited.has(row.id)) throw OpError.io("correction history contains a cycle");
        visited.add(row.id);
        const previous = loadSearchRecord(db, request.projectId, row.supersedesId);
        if (!previous) throw OpError.io("correction history is incomplete");
        row = previous;
      }
      const history: NonNullable<ExtensionData["history"]> = [];
      visited.clear();
      let pastCursor = request.payload.after === undefined;
      let foundCursor = pastCursor;
      while (row) {
        if (visited.has(row.id)) throw OpError.io("correction history contains a cycle");
        visited.add(row.id);
        if (pastCursor) history.push(row);
        if (row.id === request.payload.after) { pastCursor = true; foundCursor = true; }
        if (history.length > request.payload.limit) break;
        if (!row.supersededById) break;
        const next = loadSearchRecord(db, request.projectId, row.supersededById);
        if (!next) throw OpError.io("correction history is incomplete");
        row = next;
      }
      if (!foundCursor) throw OpError.validation("history cursor is not in this correction chain");
      const page = history.slice(0, request.payload.limit);
      return { history: page, nextAfter: history.length > page.length ? page.at(-1)!.id : null };
    }
    throw OpError.validation("unsupported operation");
  });
}
