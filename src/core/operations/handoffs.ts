import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  Handoff,
  HandoffSubmitData,
  Request,
  StoredEvidence,
  Task,
} from "../contracts.js";
import { OpError } from "../errors.js";
import { discoverProject, observeCheckout } from "../../evidence/git.js";
import { faultBoundary } from "../../storage/faults.js";
import { readReceipt } from "../../storage/receipts.js";
import {
  requireAgent,
  requireProject,
  toIso,
  toTask,
  transactMutation,
  withMutation,
  type TaskRow,
} from "./common.js";

type HandoffSubmitRequest = Extract<Request, { operation: "handoff.submit" }>;
type TaskReopenRequest = Extract<Request, { operation: "task.reopen" }>;

function loadTask(db: DatabaseSync, projectId: string, taskId: string): TaskRow {
  const row = db.prepare("SELECT * FROM tasks WHERE id = ? AND project_id = ?").get(
    taskId,
    projectId,
  ) as unknown as TaskRow | undefined;
  if (!row) throw OpError.notFound("task not found");
  return row;
}

function isLive(row: TaskRow, nowMs: number): boolean {
  return (
    row.status === "running" &&
    row.owner_id !== null &&
    row.claim_token !== null &&
    row.lease_until !== null &&
    row.lease_until > nowMs
  );
}

export interface HandoffRow {
  id: string;
  project_id: string;
  task_id: string;
  actor_id: string;
  attempt: number;
  outcome: string;
  summary: string;
  evidence_json: string;
  unresolved_json: string;
  next_steps_json: string;
  blocking_ids_json: string;
  observed_checkout_root: string;
  observed_head: string;
  observed_dirty: number;
  observed_collected_at: number;
  created_at: number;
}

export function toHandoff(row: HandoffRow): Handoff {
  return {
    id: row.id,
    projectId: row.project_id,
    taskId: row.task_id,
    actorId: row.actor_id,
    attempt: row.attempt,
    outcome: row.outcome as Handoff["outcome"],
    summary: row.summary,
    evidence: JSON.parse(row.evidence_json) as StoredEvidence,
    unresolved: JSON.parse(row.unresolved_json) as string[],
    nextSteps: JSON.parse(row.next_steps_json) as string[],
    blockingQuestionIds: JSON.parse(row.blocking_ids_json) as string[],
    observed: {
      checkoutRoot: row.observed_checkout_root,
      head: row.observed_head,
      dirty: row.observed_dirty !== 0,
      collectedAt: toIso(row.observed_collected_at),
    },
    evidenceSource: "agent_reported",
    createdAt: toIso(row.created_at),
  };
}

// Blocked handoffs must name nonempty, unique, same-task, still-unanswered
// questions; completed handoffs must name none. Unanswered optional questions
// never block completion.
function checkBlockingQuestions(
  db: DatabaseSync,
  projectId: string,
  taskId: string,
  outcome: string,
  blockingQuestionIds: string[],
): void {
  if (outcome === "completed") {
    if (blockingQuestionIds.length > 0) {
      throw OpError.conflict("completed handoff cannot name blocking questions");
    }
    return;
  }
  if (blockingQuestionIds.length === 0) {
    throw OpError.conflict("blocked handoff requires blocking questions");
  }
  const questionById = db.prepare("SELECT project_id, task_id FROM questions WHERE id = ?");
  const answerByQuestion = db.prepare("SELECT question_id FROM answers WHERE question_id = ?");
  for (const questionId of blockingQuestionIds) {
    const question = questionById.get(questionId) as
      | { project_id: string; task_id: string }
      | undefined;
    if (!question || question.project_id !== projectId || question.task_id !== taskId) {
      throw OpError.conflict("blocked handoff names an unknown or unrelated question");
    }
    if (answerByQuestion.get(questionId) !== undefined) {
      throw OpError.conflict("blocked handoff names an already answered question");
    }
  }
}

export function submitHandoff(
  db: DatabaseSync,
  now: () => number,
  request: HandoffSubmitRequest,
): HandoffSubmitData {
  const early = readReceipt<HandoffSubmitData>(db, request);
  if (early !== undefined) return early;
  // Git observation is collected outside the transaction, then rechecked
  // inside it via the receipt: a retry still succeeds after the checkout
  // moves or disappears because the dispatch-layer receipt check replays the
  // original response before collection runs again.
  const observedAtMs = now();
  const observed = observeCheckout(request.payload.evidence.checkoutRoot, observedAtMs);
  // The checkout must belong to the registered project: same realpath Git
  // common directory, so linked worktrees pass and unrelated repositories or
  // independent clones fail. Identity collection stays outside the
  // transaction with the other Git subprocesses; only the string comparison
  // runs inside it.
  let checkoutCommonDir: string;
  try {
    checkoutCommonDir = discoverProject(observed.checkoutRoot).gitCommonDir;
  } catch {
    throw OpError.conflict("could not verify the checkout belongs to the registered project");
  }
  return transactMutation(db, now, request, (nowMs) => {
    const project = requireProject(db, request.projectId);
    requireAgent(db, request.actorId);
    const row = loadTask(db, request.projectId, request.payload.taskId);
    if (
      row.status !== "running" ||
      !isLive(row, nowMs) ||
      row.owner_id !== request.actorId ||
      row.claim_token !== request.payload.claimToken
    ) {
      throw OpError.stale("claim token is expired, replaced, or does not match");
    }
    if (checkoutCommonDir !== project.git_common_dir) {
      throw OpError.conflict("checkout is not part of the registered project");
    }
    checkBlockingQuestions(
      db,
      request.projectId,
      row.id,
      request.payload.outcome,
      request.payload.blockingQuestionIds,
    );
    // The core never trusts reported Git state: mismatches reject the handoff
    // and leave the task exactly as claimed.
    if (
      request.payload.evidence.head.toLowerCase() !== observed.head ||
      request.payload.evidence.dirty !== observed.dirty
    ) {
      throw OpError.conflict("reported head/dirty does not match collected observation");
    }
    const nextStatus = request.payload.outcome === "completed" ? "completed" : "blocked";
    faultBoundary("handoff.task");
    db.prepare(
      "UPDATE tasks SET status = ?, owner_id = NULL, claim_token = NULL, lease_until = NULL, updated_at = ? WHERE id = ?",
    ).run(nextStatus, nowMs, row.id);
    const handoffId = randomUUID();
    faultBoundary("handoff.row");
    db.prepare(
      "INSERT INTO handoffs (id, project_id, task_id, actor_id, attempt, outcome, summary, evidence_json, unresolved_json, next_steps_json, blocking_ids_json, observed_checkout_root, observed_head, observed_dirty, observed_collected_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      handoffId,
      request.projectId,
      row.id,
      request.actorId,
      row.attempt,
      request.payload.outcome,
      request.payload.summary,
      JSON.stringify(request.payload.evidence),
      JSON.stringify(request.payload.unresolved),
      JSON.stringify(request.payload.nextSteps),
      JSON.stringify(request.payload.blockingQuestionIds),
      observed.checkoutRoot,
      observed.head,
      observed.dirty ? 1 : 0,
      observedAtMs,
      nowMs,
    );
    faultBoundary("handoff.receipt");
    const handoffRow = db.prepare("SELECT * FROM handoffs WHERE id = ?").get(handoffId) as unknown as HandoffRow;
    const task = toTask(db, loadTask(db, request.projectId, row.id));
    return { task, handoff: toHandoff(handoffRow) };
  });
}

export function reopenTask(
  db: DatabaseSync,
  now: () => number,
  request: TaskReopenRequest,
): { task: Task } {
  return withMutation(db, now, request, (nowMs) => {
    requireProject(db, request.projectId);
    requireAgent(db, request.actorId);
    const row = loadTask(db, request.projectId, request.payload.taskId);
    if (row.status !== "blocked") {
      throw OpError.conflict(`task is ${row.status} and cannot be reopened`);
    }
    const latest = db
      .prepare("SELECT * FROM handoffs WHERE task_id = ? ORDER BY created_at DESC, id ASC LIMIT 1")
      .get(row.id) as unknown as HandoffRow | undefined;
    if (!latest || latest.outcome !== "blocked") {
      throw OpError.conflict("blocked task has no blocked handoff to reopen from");
    }
    const blockingIds = JSON.parse(latest.blocking_ids_json) as string[];
    const answerByQuestion = db.prepare("SELECT question_id FROM answers WHERE question_id = ?");
    for (const questionId of blockingIds) {
      if (answerByQuestion.get(questionId) === undefined) {
        throw OpError.conflict("blocked task still has unanswered linked questions");
      }
    }
    db.prepare("UPDATE tasks SET status = 'open', updated_at = ? WHERE id = ?").run(nowMs, row.id);
    return { task: toTask(db, loadTask(db, request.projectId, row.id)) };
  });
}

