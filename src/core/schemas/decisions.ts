import { z } from "zod";
import { LIMITS, RelativePathSchema, UuidSchema, requiredText, uniqueArray } from "./common.js";

// decision.record: {body,paths,supersedesId} -> {decision}. Empty paths
// means project-wide. supersedesId is a required key holding an active
// decision ID in the same project, or null. No destructive update/delete.
export const DecisionRecordPayloadSchema = z.strictObject({
  body: requiredText(LIMITS.body),
  paths: uniqueArray(RelativePathSchema, LIMITS.arrayItems),
  supersedesId: UuidSchema.nullable(),
});
export type DecisionRecordPayload = z.infer<typeof DecisionRecordPayloadSchema>;
