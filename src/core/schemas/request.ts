import { z } from "zod";
import { AgentIdSchema, RequestIdSchema, SCHEMA_VERSION, UuidSchema } from "./common.js";
import { AgentRegisterPayloadSchema, ProjectRegisterPayloadSchema } from "./registration.js";
import {
  TaskClaimPayloadSchema,
  TaskCreatePayloadSchema,
  TaskGetPayloadSchema,
  TaskIdOnlyPayloadSchema,
  TaskLeasePayloadSchema,
  TaskListPayloadSchema,
} from "./tasks.js";
import { HandoffSubmitPayloadSchema } from "./handoffs.js";
import {
  InboxListPayloadSchema,
  QuestionAnswerPayloadSchema,
  QuestionAskPayloadSchema,
} from "./questions.js";
import { DecisionRecordPayloadSchema } from "./decisions.js";
import { ContextGetPayloadSchema } from "./context.js";
import {
  NoteAddPayloadSchema,
  NoteGetPayloadSchema,
  SearchQueryPayloadSchema,
} from "./notes.js";

import { DiscoveryPayloadSchema, ReviewRecordPayloadSchema, ReviewListPayloadSchema, NoteHistoryPayloadSchema, IndexPayloadSchema, DecisionListPayloadSchema } from "./extensions.js";

function globalReadEnvelope<Op extends string, P extends z.ZodType>(operation: Op, payload: P) {
  return z.strictObject({ schemaVersion: z.literal(SCHEMA_VERSION), operation: z.literal(operation), payload });
}

// Request envelope rules from CONTRACT.md:
// - project.register / agent.register: requestId required; projectId and
//   actorId forbidden.
// - reads other than inbox.list: projectId required; actorId and requestId
//   forbidden.
// - inbox.list: projectId and actorId required; requestId forbidden.
// - every other mutation: projectId, actorId, and requestId required.
// Unknown keys are validation errors at every level, so each envelope is a
// strict object with exactly its allowed keys.

const versionField = z.literal(SCHEMA_VERSION);

function registerEnvelope<Op extends string, P extends z.ZodType>(operation: Op, payload: P) {
  return z.strictObject({
    schemaVersion: versionField,
    operation: z.literal(operation),
    requestId: RequestIdSchema,
    payload,
  });
}

function readEnvelope<Op extends string, P extends z.ZodType>(operation: Op, payload: P) {
  return z.strictObject({
    schemaVersion: versionField,
    operation: z.literal(operation),
    projectId: UuidSchema,
    payload,
  });
}

function mutationEnvelope<Op extends string, P extends z.ZodType>(operation: Op, payload: P) {
  return z.strictObject({
    schemaVersion: versionField,
    operation: z.literal(operation),
    projectId: UuidSchema,
    actorId: AgentIdSchema,
    requestId: RequestIdSchema,
    payload,
  });
}

const InboxListRequestSchema = z.strictObject({
  schemaVersion: versionField,
  operation: z.literal("inbox.list"),
  projectId: UuidSchema,
  actorId: AgentIdSchema,
  payload: InboxListPayloadSchema,
});

export const RequestSchema = z.discriminatedUnion("operation", [
  globalReadEnvelope("project.list", DiscoveryPayloadSchema),
  globalReadEnvelope("agent.list", DiscoveryPayloadSchema),
  readEnvelope("decision.list", DecisionListPayloadSchema),
  readEnvelope("note.history", NoteHistoryPayloadSchema),
  readEnvelope("index.check", IndexPayloadSchema),
  mutationEnvelope("index.rebuild", IndexPayloadSchema),
  mutationEnvelope("review.record", ReviewRecordPayloadSchema),
  readEnvelope("review.list", ReviewListPayloadSchema),
  registerEnvelope("project.register", ProjectRegisterPayloadSchema),
  registerEnvelope("agent.register", AgentRegisterPayloadSchema),
  mutationEnvelope("task.create", TaskCreatePayloadSchema),
  readEnvelope("task.get", TaskGetPayloadSchema),
  readEnvelope("task.list", TaskListPayloadSchema),
  mutationEnvelope("task.claim", TaskClaimPayloadSchema),
  mutationEnvelope("task.renew", TaskLeasePayloadSchema),
  mutationEnvelope("task.release", TaskLeasePayloadSchema),
  mutationEnvelope("task.reopen", TaskIdOnlyPayloadSchema),
  mutationEnvelope("task.cancel", TaskIdOnlyPayloadSchema),
  mutationEnvelope("handoff.submit", HandoffSubmitPayloadSchema),
  mutationEnvelope("question.ask", QuestionAskPayloadSchema),
  mutationEnvelope("question.answer", QuestionAnswerPayloadSchema),
  InboxListRequestSchema,
  mutationEnvelope("decision.record", DecisionRecordPayloadSchema),
  readEnvelope("context.get", ContextGetPayloadSchema),
  mutationEnvelope("note.add", NoteAddPayloadSchema),
  readEnvelope("note.get", NoteGetPayloadSchema),
  readEnvelope("search.query", SearchQueryPayloadSchema),
]);

export type Request = z.infer<typeof RequestSchema>;
export type Operation = Request["operation"];

// v0.1 sixteen operations plus additive notes/search.
export const OPERATIONS = [
  "project.list", "agent.list", "decision.list", "note.history", "index.check", "index.rebuild", "review.record", "review.list",
  "project.register",
  "agent.register",
  "task.create",
  "task.get",
  "task.list",
  "task.claim",
  "task.renew",
  "task.release",
  "task.reopen",
  "task.cancel",
  "handoff.submit",
  "question.ask",
  "question.answer",
  "inbox.list",
  "decision.record",
  "context.get",
  "note.add",
  "note.get",
  "search.query",
] as const satisfies readonly Operation[];

// Parse an unknown value into a validated Request. Throws the Zod validation
// error on failure; the CLI maps it to VALIDATION without echoing values.
// Pure: never opens SQLite or the filesystem.
export function parseRequest(value: unknown): Request {
  return RequestSchema.parse(value);
}

// Sanitized issue list for the core error envelope: only issue paths and
// codes, never submitted values.
export interface ValidationIssue {
  path: Array<string | number>;
  code: string;
}

export function validationDetails(error: z.ZodError): { issues: ValidationIssue[] } {
  return {
    issues: error.issues.map((issue) => ({
      path: issue.path.map((part) => (typeof part === "number" ? part : String(part))),
      code: issue.code,
    })),
  };
}
