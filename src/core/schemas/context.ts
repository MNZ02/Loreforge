import { z } from "zod";
import { UuidSchema } from "./common.js";

// context.get: {taskId,mode?} -> {snapshot}. Mode defaults to work; review
// mode omits implementation prose and Q&A by policy (selection is core's,
// rendering is the client's).
export const ContextGetPayloadSchema = z.strictObject({
  taskId: UuidSchema,
  mode: z.enum(["work", "review"]).default("work"),
});
export type ContextGetPayload = z.infer<typeof ContextGetPayloadSchema>;
