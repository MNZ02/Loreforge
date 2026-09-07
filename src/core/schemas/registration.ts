import { z } from "zod";
import { AbsolutePathSchema, AgentIdSchema, LIMITS, requiredText } from "./common.js";

// project.register: {root,name} -> {project}. projectId and actorId are
// forbidden on the envelope; requestId is required. An existing canonical
// identity returns the existing record and does not rename.
export const ProjectRegisterPayloadSchema = z.strictObject({
  root: AbsolutePathSchema,
  name: requiredText(LIMITS.projectName),
});
export type ProjectRegisterPayload = z.infer<typeof ProjectRegisterPayloadSchema>;

// agent.register: {id,displayName} -> {agent}. Same id/name returns the
// existing record; a different name for the same id is CONFLICT (runtime).
export const AgentRegisterPayloadSchema = z.strictObject({
  id: AgentIdSchema,
  displayName: requiredText(LIMITS.displayName),
});
export type AgentRegisterPayload = z.infer<typeof AgentRegisterPayloadSchema>;
