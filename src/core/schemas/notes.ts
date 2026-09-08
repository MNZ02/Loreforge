import { z } from "zod";
import {
  HeadSchema,
  LIMITS,
  RelativePathSchema,
  SEARCH_DEFAULT_LIMIT,
  UuidSchema,
  requiredText,
  uniqueArray,
} from "./common.js";

export const NoteStatusSchema = z.enum(["proposed", "verified"]);
export type NoteStatus = z.infer<typeof NoteStatusSchema>;

export const NoteAddPayloadSchema = z.strictObject({
  title: requiredText(LIMITS.title),
  finding: requiredText(LIMITS.description),
  reason: requiredText(LIMITS.body),
  evidenceRefs: uniqueArray(requiredText(LIMITS.listString), LIMITS.arrayItems),
  paths: uniqueArray(RelativePathSchema, LIMITS.arrayItems),
  observedCommit: HeadSchema.nullable(),
  status: NoteStatusSchema,
  taskId: UuidSchema.nullable(),
  supersedesId: UuidSchema.nullable(),
});
export type NoteAddPayload = z.infer<typeof NoteAddPayloadSchema>;

export const NoteGetPayloadSchema = z.strictObject({
  noteId: UuidSchema,
});
export type NoteGetPayload = z.infer<typeof NoteGetPayloadSchema>;

export const SearchQueryPayloadSchema = z.strictObject({
  query: requiredText(LIMITS.searchQuery),
  files: uniqueArray(RelativePathSchema, LIMITS.arrayItems).default([]),
  limit: z.number().int().min(1).max(100).default(SEARCH_DEFAULT_LIMIT),
  includeSuperseded: z.boolean().default(false),
  currentCommit: HeadSchema.optional(),
  sources: uniqueArray(z.enum(["note", "handoff", "task", "decision"]), 4).default([]),
});
export type SearchQueryPayload = z.infer<typeof SearchQueryPayloadSchema>;
