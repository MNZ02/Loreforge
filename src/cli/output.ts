import { renderContext, ContextSnapshot } from "../context/render.js";
import { OperationName } from "./args.js";

export const ERROR_EXIT_CODES: Record<string, number> = {
  VALIDATION: 2,
  NOT_FOUND: 3,
  CONFLICT: 4,
  STALE_CLAIM: 5,
  BUSY: 6,
  IO: 7,
  INTERNAL: 1
};

export interface ResponseSuccess<T = unknown> {
  schemaVersion: 1;
  ok: true;
  data: T;
}

export interface ResponseError {
  schemaVersion: 1;
  ok: false;
  error: {
    code: "VALIDATION" | "NOT_FOUND" | "CONFLICT" | "STALE_CLAIM" | "BUSY" | "IO" | "INTERNAL";
    message: string;
    details?: unknown;
  };
}

export type ApiResponse = ResponseSuccess | ResponseError;

/**
 * Emits output for a successful operation.
 */
export function handleSuccessOutput(
  operation: OperationName,
  response: ResponseSuccess,
  isJson: boolean,
  stdout: NodeJS.WritableStream = process.stdout
): void {
  if (isJson) {
    stdout.write(JSON.stringify(response) + "\n");
    return;
  }

  const data = response.data as Record<string, any>;

  if (operation === "context.get" && data.snapshot) {
    stdout.write(renderContext(data.snapshot as ContextSnapshot) + "\n");
    return;
  }

  if (operation === "task.claim" && data.task && data.claimToken) {
    stdout.write(
      `Task claimed successfully.\n` +
      `Task ID:     ${data.task.id}\n` +
      `Status:      ${data.task.status}\n` +
      `Attempt:     ${data.task.attempt}\n` +
      `Claim Token: ${data.claimToken}\n` +
      `Lease Until: ${data.task.leaseUntil ?? "none"}\n`
    );
    return;
  }

  // Concise human-readable formatting for other operations
  if (operation === "project.register" && data.project) {
    stdout.write(`Project registered: ${data.project.name} (${data.project.id})\nRoot: ${data.project.root}\n`);
    return;
  }

  if (operation === "agent.register" && data.agent) {
    stdout.write(`Agent registered: ${data.agent.displayName} (${data.agent.id})\n`);
    return;
  }

  if (operation === "task.create" && data.task) {
    stdout.write(`Task created: [${data.task.id}] ${data.task.title} (status: ${data.task.status})\n`);
    return;
  }

  if (operation === "task.get" && data.task) {
    stdout.write(`Task [${data.task.id}] ${data.task.title}\nStatus: ${data.task.status} | Owner: ${data.task.ownerId ?? "none"}\n`);
    return;
  }

  if (operation === "task.list" && Array.isArray(data.tasks)) {
    stdout.write(`Tasks (${data.tasks.length} returned, ${data.omittedCount ?? 0} omitted):\n`);
    for (const t of data.tasks) {
      stdout.write(`- [${t.id}] ${t.title} (${t.status}, attempt ${t.attempt})\n`);
    }
    return;
  }

  if (operation === "handoff.submit" && data.task && data.handoff) {
    stdout.write(`Handoff submitted: Task [${data.task.id}] is now ${data.task.status}.\nOutcome: ${data.handoff.outcome}\n`);
    return;
  }

  if (operation === "question.ask" && data.question) {
    stdout.write(`Question asked [${data.question.id}] to ${data.question.toAgentId}\n`);
    return;
  }

  if (operation === "question.answer" && data.question) {
    stdout.write(`Question [${data.question.id}] answered by ${data.question.answer?.actorId ?? "unknown"}\n`);
    return;
  }

  if (operation === "inbox.list" && Array.isArray(data.events)) {
    stdout.write(`Inbox events (${data.events.length} returned, nextCursor: ${data.nextCursor}, hasMore: ${data.hasMore}):\n`);
    for (const ev of data.events) {
      stdout.write(`- [Event ${ev.id}] ${ev.kind} (Task ${ev.taskId}, Question ${ev.questionId})\n`);
    }
    return;
  }

  if (operation === "decision.record" && data.decision) {
    stdout.write(`Decision recorded [${data.decision.id}] by ${data.decision.actorId}\n`);
    return;
  }

  // Fallback for renew, release, reopen, cancel
  if (data.task) {
    stdout.write(`Task [${data.task.id}] updated to status ${data.task.status}.\n`);
    return;
  }

  stdout.write(`Operation ${operation} succeeded.\n`);
}

/**
 * Emits output for an error response and returns the appropriate process exit code.
 */
export function handleErrorOutput(
  error: { code: string; message: string; details?: unknown },
  isJson: boolean,
  stdout: NodeJS.WritableStream = process.stdout,
  stderr: NodeJS.WritableStream = process.stderr
): number {
  const exitCode = ERROR_EXIT_CODES[error.code] ?? 1;

  if (isJson) {
    const jsonEnvelope: ResponseError = {
      schemaVersion: 1,
      ok: false,
      error: {
        code: (error.code as any) || "INTERNAL",
        message: error.message || "Internal error",
        details: error.details
      }
    };
    stdout.write(JSON.stringify(jsonEnvelope) + "\n");
    return exitCode;
  }

  stderr.write(`Error [${error.code}]: ${error.message}\n`);
  return exitCode;
}
