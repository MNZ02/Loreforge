import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  Request,
  TaskCancelData,
  TaskClaimData,
  TaskReleaseData,
  TaskRenewData,
} from "../contracts.js";
import { OpError } from "../errors.js";
import {
  requireAgent,
  requireProject,
  toTask,
  withMutation,
  type TaskRow,
} from "./common.js";

// Attempt-scoped leases: exactly one live owner per task, fixed 2h lease,
// injected clock only (tests); no daemon, heartbeats, or scheduler.
export const LEASE_MS = 2 * 60 * 60 * 1000;

type TaskClaimRequest = Extract<Request, { operation: "task.claim" }>;
type TaskRenewRequest = Extract<Request, { operation: "task.renew" }>;
type TaskReleaseRequest = Extract<Request, { operation: "task.release" }>;
type TaskCancelRequest = Extract<Request, { operation: "task.cancel" }>;

function loadTask(db: DatabaseSync, projectId: string, taskId: string): TaskRow {
  const row = db.prepare("SELECT * FROM tasks WHERE id = ? AND project_id = ?").get(
    taskId,
    projectId,
  ) as unknown as TaskRow | undefined;
  if (!row) throw OpError.notFound("task not found");
  return row;
}

// A claim is live only while the task is running, owned, and unexpired. At
// exact expiry (leaseUntil <= now) the token is already invalid.
function isLive(row: TaskRow, nowMs: number): boolean {
  return (
    row.status === "running" &&
    row.owner_id !== null &&
    row.claim_token !== null &&
    row.lease_until !== null &&
    row.lease_until > nowMs
  );
}

function matchesClaim(row: TaskRow, actorId: string, claimToken: string, nowMs: number): boolean {
  return (
    isLive(row, nowMs) && row.owner_id === actorId && row.claim_token === claimToken
  );
}

function dependenciesCompleted(db: DatabaseSync, taskId: string): boolean {
  const rows = db
    .prepare(
      "SELECT t.status FROM task_dependencies d JOIN tasks t ON t.id = d.depends_on_task_id WHERE d.task_id = ?",
    )
    .all(taskId) as Array<{ status: string }>;
  return rows.every((row) => row.status === "completed");
}

export function claimTask(
  db: DatabaseSync,
  now: () => number,
  request: TaskClaimRequest,
): TaskClaimData {
  return withMutation(db, now, request, (nowMs) => {
    requireProject(db, request.projectId);
    requireAgent(db, request.actorId);
    const row = loadTask(db, request.projectId, request.payload.taskId);
    if (row.status === "completed" || row.status === "cancelled" || row.status === "blocked") {
      throw OpError.conflict(`task is ${row.status} and cannot be claimed`);
    }
    if (isLive(row, nowMs)) {
      throw OpError.conflict("task is already claimed");
    }
    if (!dependenciesCompleted(db, row.id)) {
      throw OpError.conflict("task dependencies are not completed");
    }
    const claimToken = randomBytes(32).toString("hex");
    const leaseUntil = nowMs + LEASE_MS;
    db.prepare(
      "UPDATE tasks SET status = 'running', owner_id = ?, claim_token = ?, attempt = attempt + 1, lease_until = ?, updated_at = ? WHERE id = ?",
    ).run(request.actorId, claimToken, leaseUntil, nowMs, row.id);
    const updated = loadTask(db, request.projectId, row.id);
    return { task: toTask(db, updated), claimToken };
  });
}

export function renewTask(
  db: DatabaseSync,
  now: () => number,
  request: TaskRenewRequest,
): TaskRenewData {
  return withMutation(db, now, request, (nowMs) => {
    requireProject(db, request.projectId);
    requireAgent(db, request.actorId);
    const row = loadTask(db, request.projectId, request.payload.taskId);
    if (!matchesClaim(row, request.actorId, request.payload.claimToken, nowMs)) {
      throw OpError.stale("claim token is expired, replaced, or does not match");
    }
    db.prepare("UPDATE tasks SET lease_until = ?, updated_at = ? WHERE id = ?").run(
      nowMs + LEASE_MS,
      nowMs,
      row.id,
    );
    return { task: toTask(db, loadTask(db, request.projectId, row.id)) };
  });
}

export function releaseTask(
  db: DatabaseSync,
  now: () => number,
  request: TaskReleaseRequest,
): TaskReleaseData {
  return withMutation(db, now, request, (nowMs) => {
    requireProject(db, request.projectId);
    requireAgent(db, request.actorId);
    const row = loadTask(db, request.projectId, request.payload.taskId);
    if (!matchesClaim(row, request.actorId, request.payload.claimToken, nowMs)) {
      throw OpError.stale("claim token is expired, replaced, or does not match");
    }
    db.prepare(
      "UPDATE tasks SET status = 'open', owner_id = NULL, claim_token = NULL, lease_until = NULL, updated_at = ? WHERE id = ?",
    ).run(nowMs, row.id);
    return { task: toTask(db, loadTask(db, request.projectId, row.id)) };
  });
}

export function cancelTask(
  db: DatabaseSync,
  now: () => number,
  request: TaskCancelRequest,
): TaskCancelData {
  return withMutation(db, now, request, (nowMs) => {
    requireProject(db, request.projectId);
    requireAgent(db, request.actorId);
    const row = loadTask(db, request.projectId, request.payload.taskId);
    // Any registered actor can cancel; coordination, not authorization. New
    // cancellation of a terminal task is CONFLICT; the exact retry of a
    // recorded cancellation still replays success via receipts.
    if (row.status === "completed" || row.status === "cancelled") {
      throw OpError.conflict(`task is already ${row.status}`);
    }
    db.prepare(
      "UPDATE tasks SET status = 'cancelled', owner_id = NULL, claim_token = NULL, lease_until = NULL, updated_at = ? WHERE id = ?",
    ).run(nowMs, row.id);
    return { task: toTask(db, loadTask(db, request.projectId, row.id)) };
  });
}
