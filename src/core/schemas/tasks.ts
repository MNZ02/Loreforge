import { z } from "zod";
import {
  ClaimTokenSchema,
  LIMITS,
  LimitSchema,
  TaskStatusSchema,
  UuidSchema,
  requiredText,
  uniqueArray,
} from "./common.js";

// task.create: {title,description,dependsOn} -> {task}. All keys required;
// pass an empty array when there are no dependencies. Dependency IDs must
// already exist in the same project (checked at runtime, not by schema).
export const TaskCreatePayloadSchema = z.strictObject({
  title: requiredText(LIMITS.title),
  description: requiredText(LIMITS.description),
  dependsOn: uniqueArray(UuidSchema, LIMITS.arrayItems),
});
export type TaskCreatePayload = z.infer<typeof TaskCreatePayloadSchema>;

// task.get: {taskId} -> {task}. Retrieves an omitted task as well.
export const TaskGetPayloadSchema = z.strictObject({
  taskId: UuidSchema,
});
export type TaskGetPayload = z.infer<typeof TaskGetPayloadSchema>;

// task.list: {status?,limit?} -> {tasks,omittedCount}. Newest-created first
// with ID ascending tie-break (applied at runtime).
export const TaskListPayloadSchema = z.strictObject({
  status: TaskStatusSchema.optional(),
  limit: LimitSchema,
  cursor: z.string().max(1000).optional(),
  claimable: z.boolean().optional(),
  expired: z.boolean().optional(),
});
export type TaskListPayload = z.infer<typeof TaskListPayloadSchema>;

// task.claim: {taskId} -> {task,claimToken}.
export const TaskClaimPayloadSchema = z.strictObject({
  taskId: UuidSchema,
});
export type TaskClaimPayload = z.infer<typeof TaskClaimPayloadSchema>;

// task.renew / task.release: {taskId,claimToken} -> {task}.
export const TaskLeasePayloadSchema = z.strictObject({
  taskId: UuidSchema,
  claimToken: ClaimTokenSchema,
});
export type TaskLeasePayload = z.infer<typeof TaskLeasePayloadSchema>;

// task.reopen / task.cancel: {taskId} -> {task}. Reopen is blocked-only;
// cancel accepts open/running/blocked (runtime transitions).
export const TaskIdOnlyPayloadSchema = z.strictObject({
  taskId: UuidSchema,
});
export type TaskIdOnlyPayload = z.infer<typeof TaskIdOnlyPayloadSchema>;

