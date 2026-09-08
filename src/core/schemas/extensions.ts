import { z } from "zod";
import { HeadSchema, LimitSchema, UuidSchema, requiredText, LIMITS } from "./common.js";

export const DiscoveryPayloadSchema = z.strictObject({ limit: LimitSchema, after: z.string().max(4000).optional() });
export const ReviewRecordPayloadSchema = z.strictObject({
  handoffId: UuidSchema,
  observedCommit: HeadSchema,
  outcome: z.enum(["approved", "changes_requested"]),
  body: requiredText(LIMITS.body),
});
export const ReviewListPayloadSchema = z.strictObject({ handoffId: UuidSchema, limit: LimitSchema, after: UuidSchema.optional() });
export const NoteHistoryPayloadSchema = z.strictObject({ noteId: UuidSchema, limit: LimitSchema, after: UuidSchema.optional() });
export const IndexPayloadSchema = z.strictObject({});
export const DecisionListPayloadSchema = z.strictObject({ limit: LimitSchema, after: UuidSchema.optional(), includeSuperseded: z.boolean().default(false) });
