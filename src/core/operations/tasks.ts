import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Request, TaskCreateData, TaskGetData, TaskListData } from "../contracts.js";
import { OpError } from "../errors.js";
import { indexTaskDocument } from "../../storage/search-index.js";
import { withRead } from "../../storage/db.js";
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
      "INSERT INTO tasks (id, project_id, title, description, status, owner_id, claim_token, attempt, lease_until, created_at, updated_at, created_by) VALUES (?, ?, ?, ?, 'open', NULL, NULL, 0, NULL, ?, ?, ?)",
    ).run(id, request.projectId, request.payload.title, request.payload.description, nowMs, nowMs, request.actorId);
    const insertDep = db.prepare(
      "INSERT INTO task_dependencies (task_id, depends_on_task_id) VALUES (?, ?)",
    );
    for (const dependsOn of request.payload.dependsOn) {
      insertDep.run(id, dependsOn);
    }
    const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as unknown as TaskRow;
    indexTaskDocument(db, row);
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

export function listTasks(db: DatabaseSync, request: TaskListRequest, nowMs = Date.now()): TaskListData {
  return withRead(db, () => {
    requireProject(db, request.projectId);
    const { status, limit, claimable, expired, cursor } = request.payload;
    const filter = createHash("sha256").update(JSON.stringify([request.projectId, status, claimable, expired])).digest("hex");
    const conditions = ["t.project_id = ?"];
    const params: Array<string | number> = [request.projectId];
    if (status) { conditions.push("t.status = ?"); params.push(status); }
    if (expired !== undefined) {
      conditions.push(`(t.status = 'running' AND t.lease_until <= ?) ${expired ? "" : "= 0"}`);
      params.push(nowMs);
    }
    if (claimable !== undefined) {
      conditions.push(`((t.status = 'open' OR (t.status = 'running' AND t.lease_until <= ?)) AND NOT EXISTS
        (SELECT 1 FROM task_dependencies d JOIN tasks dep ON dep.id = d.depends_on_task_id
         WHERE d.task_id = t.id AND dep.status != 'completed')) ${claimable ? "" : "= 0"}`);
      params.push(nowMs);
    }
    if (cursor) {
      let value: { time: number; id: string; filter: string };
      try {
        value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
        if (!Number.isSafeInteger(value.time) || typeof value.id !== "string" || value.filter !== filter) throw new Error();
      } catch { throw OpError.validation("cursor does not match this task query"); }
      conditions.push("(t.created_at < ? OR (t.created_at = ? AND t.id > ?))");
      params.push(value.time, value.time, value.id);
    }
    const where = conditions.join(" AND ");
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM tasks t WHERE ${where}`).get(...params) as { n: number }).n;
    const rows = db.prepare(`SELECT t.* FROM tasks t WHERE ${where} ORDER BY t.created_at DESC, t.id ASC LIMIT ?`).all(...params, limit) as unknown as TaskRow[];
    const last = rows.at(-1);
    const availability: NonNullable<TaskListData["availability"]> = {};
    for (const row of rows) {
      const blockedBy = (db.prepare("SELECT dep.id FROM task_dependencies d JOIN tasks dep ON dep.id = d.depends_on_task_id WHERE d.task_id = ? AND dep.status != 'completed' ORDER BY dep.id").all(row.id) as { id: string }[]).map(d => d.id);
      const isExpired = row.status === "running" && row.lease_until !== null && row.lease_until <= nowMs;
      availability[row.id] = { expired: isExpired, claimable: (row.status === "open" || isExpired) && blockedBy.length === 0, blockedBy };
    }
    return {
      tasks: rows.map(row => toTask(db, row)), omittedCount: Math.max(0, total - rows.length), availability,
      nextCursor: last && total > rows.length ? Buffer.from(JSON.stringify({ time: last.created_at, id: last.id, filter })).toString("base64url") : null,
    };
  });
}
