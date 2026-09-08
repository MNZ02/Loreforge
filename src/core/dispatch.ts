import { extensionOperation } from "./operations/extensions.js";
import type { DatabaseSync } from "node:sqlite";
import { ZodError } from "zod";
import {
  CoreOpenError,
  parseRequest,
  validationDetails,
  type Request,
  type Response,
  type ResponseError,
} from "./contracts.js";
import { OpError } from "./errors.js";
import { createTask, getTask, listTasks } from "./operations/tasks.js";
import { cancelTask, claimTask, releaseTask, renewTask } from "./operations/claims.js";
import { reopenTask, submitHandoff } from "./operations/handoffs.js";
import { answerQuestion, askQuestion, listInbox } from "./operations/messages.js";
import { recordDecision } from "./operations/decisions.js";
import { getContext } from "./operations/context.js";
import { registerAgent, registerProject } from "./operations/register.js";
import { addNote, getNote } from "./operations/notes.js";
import { searchQuery } from "./operations/search.js";
import { readReceipt } from "../storage/receipts.js";
import type { ResponseData } from "./contracts.js";

// Request router. Every call revalidates its input with parseRequest, so
// future direct callers get the same envelope guarantees as the CLI. Expected
// failures become the error envelope; only open/close throw.
export async function executeRequest(
  db: DatabaseSync,
  now: () => number,
  input: unknown,
): Promise<Response> {
  let request: Request;
  try {
    request = parseRequest(input);
  } catch (error) {
    if (error instanceof ZodError) {
      return validationFailure(validationDetails(error));
    }
    return internalFailure();
  }
  try {
    // Receipt-first for every mutation: an exact retry replays the original
    // response and a reused key with different content is CONFLICT, decided
    // here before operation routing so the guarantee holds uniformly.
    if ("requestId" in request && typeof request.requestId === "string") {
      const replayed = readReceipt<ResponseData>(db, request);
      if (replayed !== undefined) {
        return { schemaVersion: 1, ok: true, data: replayed };
      }
    }
    // Mutations receive the clock itself and sample it only after acquiring
    // their write transaction; reads use a dispatch-time sample because they
    // make no lease decisions.
    const nowMs = now();
    switch (request.operation) {
      case "project.list": case "agent.list": case "decision.list": case "note.history":
      case "review.record": case "review.list": case "index.check": case "index.rebuild":
        return { schemaVersion: 1, ok: true, data: extensionOperation(db, now, request) };
      case "project.register":
        return { schemaVersion: 1, ok: true, data: registerProject(db, now, request) };
      case "agent.register":
        return { schemaVersion: 1, ok: true, data: registerAgent(db, now, request) };
      case "task.create":
        return { schemaVersion: 1, ok: true, data: createTask(db, now, request) };
      case "task.get":
        return { schemaVersion: 1, ok: true, data: getTask(db, request) };
      case "task.list":
        return { schemaVersion: 1, ok: true, data: listTasks(db, request, nowMs) };
      case "task.claim":
        return { schemaVersion: 1, ok: true, data: claimTask(db, now, request) };
      case "task.renew":
        return { schemaVersion: 1, ok: true, data: renewTask(db, now, request) };
      case "task.release":
        return { schemaVersion: 1, ok: true, data: releaseTask(db, now, request) };
      case "task.cancel":
        return { schemaVersion: 1, ok: true, data: cancelTask(db, now, request) };
      case "handoff.submit":
        return { schemaVersion: 1, ok: true, data: await submitHandoff(db, now, request) };
      case "task.reopen":
        return { schemaVersion: 1, ok: true, data: reopenTask(db, now, request) };
      case "question.ask":
        return { schemaVersion: 1, ok: true, data: askQuestion(db, now, request) };
      case "question.answer":
        return { schemaVersion: 1, ok: true, data: answerQuestion(db, now, request) };
      case "inbox.list":
        return { schemaVersion: 1, ok: true, data: listInbox(db, request) };
      case "decision.record":
        return { schemaVersion: 1, ok: true, data: recordDecision(db, now, request) };
      case "context.get":
        return { schemaVersion: 1, ok: true, data: await getContext(db, nowMs, request) };
      case "note.add":
        return { schemaVersion: 1, ok: true, data: addNote(db, now, request) };
      case "note.get":
        return { schemaVersion: 1, ok: true, data: getNote(db, request) };
      case "search.query":
        return { schemaVersion: 1, ok: true, data: searchQuery(db, request) };
      default:
        // Every known operation routes above; this guards future additions.
        throw OpError.internal("operation is not implemented yet");
    }
  } catch (error) {
    return mapFailure(error);
  }
}

function validationFailure(details: ReturnType<typeof validationDetails>): Response {
  const error: ResponseError = {
    code: "VALIDATION",
    message: "Invalid request",
    details,
  };
  return { schemaVersion: 1, ok: false, error };
}

function internalFailure(): Response {
  return { schemaVersion: 1, ok: false, error: { code: "INTERNAL", message: "Internal error" } };
}

export function mapFailure(error: unknown): Response {
  if (error instanceof OpError) {
    const failure: ResponseError = { code: error.code, message: error.message };
    if (error.details !== undefined) failure.details = error.details;
    return { schemaVersion: 1, ok: false, error: failure };
  }
  if (error instanceof CoreOpenError && error.code === "BUSY") {
    return {
      schemaVersion: 1,
      ok: false,
      error: { code: "BUSY", message: error.message },
    };
  }
  return internalFailure();
}
