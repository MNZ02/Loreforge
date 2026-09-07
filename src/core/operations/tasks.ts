import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Request, TaskCreateData, TaskGetData, TaskListData } from "../contracts.js";
import { OpError } from "../errors.js";
import { requireAgent, requireProject, toTask, withMutation, type TaskRow } from "./common.js";

type TaskCreateRequest = Extract<Request, { operation: "task.create" }>;
type TaskGetRequest = Extract<Request, { operation: "task.get" }>;
type TaskListRequest = Extract<Request, { operation: "task.list" }>;

export function createTask(
  db: DatabaseSync,
  now: () => number,
  request: TaskCreateRequest,
): TaskCreateData {
  return withMutation(db, now, request, (nowMs) => {
    requireProject(db, request.projectId);
    requireAgent(db, request.actorId);
    // Every dependency must already exist in the same project. Existence is a
    // runtime check, so wrong-project IDs are NOT_FOUND here, never leaked.
    for (const dependsOn of request.payload.dependsOn) {
      const row = db.prepare("SELECT project_id FROM tasks WHERE id = ?").get(dependsOn) as
        | { project_id: string }
        | undefined;
      if (!row || row.project_id !== request.projectId) {
        throw OpError.notFound("dependency not found");
      }
    }
    const id = randomUUID();
    db.prepare(
      "INSERT INTO tasks (id, project_id, title, description, status, owner_id, claim_token, attempt, lease_until, created_at, updated_at) VALUES (?, ?, ?, ?, 'open', NULL, NULL, 0, NULL, ?, ?)",
    ).run(id, request.projectId, request.payload.title, request.payload.description, nowMs, nowMs);
    const insertDep = db.prepare(
      "INSERT INTO task_dependencies (task_id, depends_on_task_id) VALUES (?, ?)",
    );
    for (const dependsOn of request.payload.dependsOn) {
      insertDep.run(id, dependsOn);
    }
    const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as unknown as TaskRow;
    return { task: toTask(db, row) };
  });
}

export function getTask(db: DatabaseSync, request: TaskGetRequest): TaskGetData {
  requireProject(db, request.projectId);
  const row = db.prepare("SELECT * FROM tasks WHERE id = ? AND project_id = ?").get(
    request.payload.taskId,
    request.projectId,
  ) as TaskRow | undefined;
  if (!row) throw OpError.notFound("task not found");
  return { task: toTask(db, row) };
}

export function listTasks(db: DatabaseSync, request: TaskListRequest): TaskListData {
  requireProject(db, request.projectId);
  const status = request.payload.status;
  const limit = request.payload.limit;
  const countRow = (
    status === undefined
      ? db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE project_id = ?").get(request.projectId)
      : db
          .prepare("SELECT COUNT(*) AS n FROM tasks WHERE project_id = ? AND status = ?")
          .get(request.projectId, status)
  ) as { n: number };
  const rows = (
    status === undefined
      ? db
          .prepare(
            "SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at DESC, id ASC LIMIT ?",
          )
          .all(request.projectId, limit)
      : db
          .prepare(
            "SELECT * FROM tasks WHERE project_id = ? AND status = ? ORDER BY created_at DESC, id ASC LIMIT ?",
          )
          .all(request.projectId, status, limit)
  ) as unknown as TaskRow[];
  return {
    tasks: rows.map((row) => toTask(db, row)),
    omittedCount: Math.max(0, countRow.n - rows.length),
  };
}
