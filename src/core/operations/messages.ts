import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  Answer,
  InboxEvent,
  InboxListData,
  Question,
  QuestionAnswerData,
  QuestionAskData,
  Request,
} from "../contracts.js";
import { OpError } from "../errors.js";
import {
  requireAgent,
  requireProject,
  toIso,
  withMutation,
} from "./common.js";

type QuestionAskRequest = Extract<Request, { operation: "question.ask" }>;
type QuestionAnswerRequest = Extract<Request, { operation: "question.answer" }>;
type InboxListRequest = Extract<Request, { operation: "inbox.list" }>;

export interface QuestionRow {
  id: string;
  project_id: string;
  task_id: string;
  from_agent_id: string;
  to_agent_id: string;
  body: string;
  created_at: number;
}

export interface AnswerRow {
  question_id: string;
  id: string;
  actor_id: string;
  body: string;
  created_at: number;
}

function toAnswer(row: AnswerRow): Answer {
  return { id: row.id, actorId: row.actor_id, body: row.body, createdAt: toIso(row.created_at) };
}

export function toQuestion(row: QuestionRow, answer: AnswerRow | undefined): Question {
  return {
    id: row.id,
    projectId: row.project_id,
    taskId: row.task_id,
    fromAgentId: row.from_agent_id,
    toAgentId: row.to_agent_id,
    body: row.body,
    createdAt: toIso(row.created_at),
    answer: answer === undefined ? null : toAnswer(answer),
  };
}

function loadQuestion(db: DatabaseSync, projectId: string, questionId: string): QuestionRow {
  const row = db.prepare("SELECT * FROM questions WHERE id = ? AND project_id = ?").get(
    questionId,
    projectId,
  ) as unknown as QuestionRow | undefined;
  if (!row) throw OpError.notFound("question not found");
  return row;
}

function loadAnswer(db: DatabaseSync, questionId: string): AnswerRow | undefined {
  return db.prepare("SELECT * FROM answers WHERE question_id = ?").get(questionId) as unknown as
    | AnswerRow
    | undefined;
}

function insertEvent(
  db: DatabaseSync,
  projectId: string,
  recipientId: string,
  kind: string,
  questionId: string,
  taskId: string,
  body: string,
  nowMs: number,
): void {
  db.prepare(
    "INSERT INTO inbox_events (project_id, recipient_id, kind, question_id, task_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(projectId, recipientId, kind, questionId, taskId, body, nowMs);
}

export function askQuestion(
  db: DatabaseSync,
  now: () => number,
  request: QuestionAskRequest,
): QuestionAskData {
  return withMutation(db, now, request, (nowMs) => {
    requireProject(db, request.projectId);
    requireAgent(db, request.actorId);
    const task = db.prepare("SELECT status FROM tasks WHERE id = ? AND project_id = ?").get(
      request.payload.taskId,
      request.projectId,
    ) as { status: string } | undefined;
    if (!task) throw OpError.notFound("task not found");
    if (task.status !== "open" && task.status !== "running" && task.status !== "blocked") {
      throw OpError.conflict(`cannot ask questions on a ${task.status} task`);
    }
    requireAgent(db, request.payload.toAgentId);
    const row: QuestionRow = {
      id: randomUUID(),
      project_id: request.projectId,
      task_id: request.payload.taskId,
      from_agent_id: request.actorId,
      to_agent_id: request.payload.toAgentId,
      body: request.payload.body,
      created_at: nowMs,
    };
    db.prepare(
      "INSERT INTO questions (id, project_id, task_id, from_agent_id, to_agent_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(row.id, row.project_id, row.task_id, row.from_agent_id, row.to_agent_id, row.body, row.created_at);
    insertEvent(db, request.projectId, row.to_agent_id, "question", row.id, row.task_id, row.body, nowMs);
    return { question: toQuestion(row, undefined) };
  });
}

export function answerQuestion(
  db: DatabaseSync,
  now: () => number,
  request: QuestionAnswerRequest,
): QuestionAnswerData {
  return withMutation(db, now, request, (nowMs) => {
    requireProject(db, request.projectId);
    requireAgent(db, request.actorId);
    const question = loadQuestion(db, request.projectId, request.payload.questionId);
    if (question.to_agent_id !== request.actorId) {
      throw OpError.conflict("only the addressed agent may answer this question");
    }
    if (loadAnswer(db, question.id) !== undefined) {
      throw OpError.conflict("question already answered");
    }
    const answer: AnswerRow = {
      question_id: question.id,
      id: randomUUID(),
      actor_id: request.actorId,
      body: request.payload.body,
      created_at: nowMs,
    };
    try {
      db.prepare("INSERT INTO answers (question_id, id, actor_id, body, created_at) VALUES (?, ?, ?, ?, ?)").run(
        answer.question_id,
        answer.id,
        answer.actor_id,
        answer.body,
        answer.created_at,
      );
    } catch (error) {
      // A concurrent answer won the race between our check and insert.
      const message = error instanceof Error ? error.message : String(error);
      if (/UNIQUE constraint failed: answers/.test(message)) {
        throw OpError.conflict("question already answered");
      }
      throw error;
    }
    insertEvent(db, request.projectId, question.from_agent_id, "answer", question.id, question.task_id, answer.body, nowMs);
    return { question: toQuestion(question, answer) };
  });
}

interface EventRow {
  id: number;
  project_id: string;
  recipient_id: string;
  kind: string;
  question_id: string;
  task_id: string;
  body: string;
  created_at: number;
}

function toEvent(row: EventRow): InboxEvent {
  return {
    id: row.id,
    projectId: row.project_id,
    recipientId: row.recipient_id,
    kind: row.kind as InboxEvent["kind"],
    questionId: row.question_id,
    taskId: row.task_id,
    body: row.body,
    createdAt: toIso(row.created_at),
  };
}

export function listInbox(db: DatabaseSync, request: InboxListRequest): InboxListData {
  requireProject(db, request.projectId);
  requireAgent(db, request.actorId);
  const after = request.payload.after;
  const limit = request.payload.limit;
  const rows = db
    .prepare(
      "SELECT * FROM inbox_events WHERE project_id = ? AND recipient_id = ? AND id > ? ORDER BY id ASC LIMIT ?",
    )
    .all(request.projectId, request.actorId, after, limit + 1) as unknown as EventRow[];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    events: page.map(toEvent),
    nextCursor: page.length > 0 ? page[page.length - 1].id : after,
    hasMore,
  };
}
