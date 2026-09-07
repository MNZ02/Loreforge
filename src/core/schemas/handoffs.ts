import { z } from "zod";
import {
  AbsolutePathSchema,
  ClaimTokenSchema,
  HeadSchema,
  LIMITS,
  RelativePathSchema,
  UuidSchema,
  requiredText,
  uniqueArray,
} from "./common.js";

// Agent-reported evidence. The core never executes checks and never treats
// reported file assertions as verified; it only records them alongside its
// own read-only Git observation.
const EvidenceFileSchema = z.strictObject({
  path: RelativePathSchema,
  change: z.enum(["added", "modified", "deleted"]),
});

const EvidenceCheckSchema = z.strictObject({
  command: requiredText(LIMITS.checkCommand),
  outcome: z.enum(["passed", "failed", "not_run"]),
  summary: requiredText(LIMITS.checkSummary),
});

export const EvidenceInputSchema = z.strictObject({
  checkoutRoot: AbsolutePathSchema,
  head: HeadSchema,
  dirty: z.boolean(),
  files: z
    .array(EvidenceFileSchema)
    .max(LIMITS.evidenceFiles)
    .refine((files) => new Set(files.map((file) => file.path)).size === files.length),
  checks: z.array(EvidenceCheckSchema).max(LIMITS.checks),
});
export type EvidenceInput = z.infer<typeof EvidenceInputSchema>;

// handoff.submit -> {task,handoff}. blockingQuestionIds is required: empty
// for completed, nonempty for blocked. Question existence, project/task
// match, and unanswered state are runtime checks.
export const HandoffSubmitPayloadSchema = z.strictObject({
  taskId: UuidSchema,
  claimToken: ClaimTokenSchema,
  outcome: z.enum(["completed", "blocked"]),
  summary: requiredText(LIMITS.summary),
  evidence: EvidenceInputSchema,
  unresolved: z.array(requiredText(LIMITS.listString)).max(LIMITS.arrayItems),
  nextSteps: z.array(requiredText(LIMITS.listString)).max(LIMITS.arrayItems),
  blockingQuestionIds: uniqueArray(UuidSchema, LIMITS.arrayItems),
});
export type HandoffSubmitPayload = z.infer<typeof HandoffSubmitPayloadSchema>;
