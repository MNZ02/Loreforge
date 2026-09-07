import { z } from "zod";
import { AfterSchema, AgentIdSchema, LIMITS, LimitSchema, UuidSchema, requiredText } from "./common.js";

// question.ask: {taskId,toAgentId,body} -> {question}. Allowed on
// open/running/blocked tasks only (runtime); terminal tasks reject.
export const QuestionAskPayloadSchema = z.strictObject({
  taskId: UuidSchema,
  toAgentId: AgentIdSchema,
  body: requiredText(LIMITS.body),
});
export type QuestionAskPayload = z.infer<typeof QuestionAskPayloadSchema>;

// question.answer: {questionId,body} -> {question}. Only the addressed agent
// may answer; answers stay permitted after terminal task state (runtime).
export const QuestionAnswerPayloadSchema = z.strictObject({
  questionId: UuidSchema,
  body: requiredText(LIMITS.body),
});
export type QuestionAnswerPayload = z.infer<typeof QuestionAnswerPayloadSchema>;

// inbox.list: {after?,limit?} -> {events,nextCursor,hasMore}. Filters by
// project AND recipient AND event.id > after, ascending event.id.
export const InboxListPayloadSchema = z.strictObject({
  after: AfterSchema,
  limit: LimitSchema,
});
export type InboxListPayload = z.infer<typeof InboxListPayloadSchema>;
