import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Decision, DecisionRecordData, Request } from "../contracts.js";
import { OpError } from "../errors.js";
import { requireAgent, requireProject, toIso, withMutation } from "./common.js";

type DecisionRecordRequest = Extract<Request, { operation: "decision.record" }>;

export interface DecisionRow {
  id: string;
  project_id: string;
  actor_id: string;
  body: string;
  paths_json: string;
  supersedes_id: string | null;
  superseded_by_id: string | null;
  created_at: number;
}

export function toDecision(row: DecisionRow): Decision {
  return {
    id: row.id,
    projectId: row.project_id,
    actorId: row.actor_id,
    body: row.body,
    paths: JSON.parse(row.paths_json) as string[],
    supersedesId: row.supersedes_id,
    createdAt: toIso(row.created_at),
  };
}

export function recordDecision(
  db: DatabaseSync,
  now: () => number,
  request: DecisionRecordRequest,
): DecisionRecordData {
  return withMutation(db, now, request, (nowMs) => {
    requireProject(db, request.projectId);
    requireAgent(db, request.actorId);
    const target = request.payload.supersedesId;
    if (target !== null) {
      const row = db.prepare("SELECT * FROM decisions WHERE id = ?").get(target) as unknown as
        | DecisionRow
        | undefined;
      // Must identify an active decision in the same project: unknown IDs,
      // foreign-project IDs, and already-superseded IDs all conflict so no
      // second supersession can win and no existence oracle leaks.
      if (!row || row.project_id !== request.projectId || row.superseded_by_id !== null) {
        throw OpError.conflict("superseded decision is not active in this project");
      }
    }
    const id = randomUUID();
    db.prepare(
      "INSERT INTO decisions (id, project_id, actor_id, body, paths_json, supersedes_id, superseded_by_id, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)",
    ).run(
      id,
      request.projectId,
      request.actorId,
      request.payload.body,
      JSON.stringify(request.payload.paths),
      target,
      nowMs,
    );
    if (target !== null) {
      // Atomic second-supersession guard: exactly one writer flips NULL.
      const flipped = db
        .prepare("UPDATE decisions SET superseded_by_id = ? WHERE id = ? AND superseded_by_id IS NULL")
        .run(id, target) as { changes: number | bigint };
      if (Number(flipped.changes) !== 1) {
        throw OpError.conflict("superseded decision is not active in this project");
      }
    }
    const row = db.prepare("SELECT * FROM decisions WHERE id = ?").get(id) as unknown as DecisionRow;
    return { decision: toDecision(row) };
  });
}
