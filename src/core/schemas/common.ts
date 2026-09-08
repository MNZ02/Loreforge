import { z } from "zod";
import { normalizeRelativePath } from "../../storage/search-text.js";

// Shared primitives for every domain schema. Input schemas are pure: they
// never touch the filesystem, environment, or SQLite.

export const SCHEMA_VERSION = 1 as const;

// Character/count limits from CONTRACT.md (characters unless noted).
export const LIMITS = {
  jsonBytes: 64 * 1024,
  title: 200,
  description: 4000,
  summary: 2000,
  body: 4000,
  listString: 500,
  arrayItems: 20,
  requestId: 128,
  projectName: 100,
  displayName: 100,
  relativePath: 400,
  evidenceFiles: 100,
  checks: 20,
  checkCommand: 500,
  checkSummary: 1000,
  claimToken: 256,
  searchQuery: 500,
  excerpt: 240,
} as const;

export const SEARCH_DEFAULT_LIMIT = 5;

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const AGENT_ID_RE = /^[a-z][a-z0-9_-]{0,63}$/;
const HEAD_RE = /^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;

const NUL = String.fromCharCode(0);

function noNul(value: string): boolean {
  return !value.includes(NUL);
}

// Required free text: trimmed, nonempty, bounded, NUL-free. Length limits
// apply after trim; a value that trims to empty is rejected, never stored
// as empty. Output is the trimmed value.
export function requiredText(max: number): z.ZodType<string> {
  return z
    .string()
    .refine(noNul)
    .transform((value) => value.trim())
    .pipe(z.string().min(1).max(max));
}

// Generated entity IDs are UUIDs.
export const UuidSchema = z.string().regex(UUID_RE);

// Coordination labels such as `muse`, `flash`, `codex`, `human`.
export const AgentIdSchema = z.string().regex(AGENT_ID_RE);

// Caller-chosen retry key: nonempty, bounded, NUL-free. Callers reuse it
// only for an exact retry.
export const RequestIdSchema = z.string().min(1).max(LIMITS.requestId).refine(noNul);

// Core-issued claim token. Compared opaquely; never logged or echoed outside
// the intentional claim result.
export const ClaimTokenSchema = z.string().min(1).max(LIMITS.claimToken).refine(noNul);

// Full 40- or 64-hex commit ID observed by the agent.
export const HeadSchema = z.string().regex(HEAD_RE);

export const TaskStatusSchema = z.enum(["open", "running", "blocked", "completed", "cancelled"]);

// Absolute path (project roots, checkout roots): nonempty, NUL-free, rooted.
// No length normalization: resolvable aliases are canonicalized by the core
// against the filesystem, not by the schema.
export const AbsolutePathSchema = z.string().min(1).refine(noNul).refine((value) => value.startsWith("/"));

// Project-relative path using `/` separators. Rejects absolute paths, `..`
// segments, NUL bytes, and empties. Length applies after trim.
export const RelativePathSchema = z
  .string()
  .refine(noNul)
  .transform((value) => value.trim())
  .pipe(
    z
      .string()
      .min(1)
      .max(LIMITS.relativePath)
      .refine((value) => !value.startsWith("/"))
      .refine((value) => !value.split("/").includes(".."))
      .transform(normalizeRelativePath)
      .pipe(z.string().min(1)),
  );

// Array whose entries must be unique (used for IDs and paths).
export function uniqueArray<T>(schema: z.ZodType<T>, max: number): z.ZodType<T[]> {
  return z
    .array(schema)
    .max(max)
    .refine((values) => new Set(values).size === values.length);
}

// Read-list paging: default limit 20, range 1..100.
export const LimitSchema = z.number().int().min(1).max(100).default(20);

// Inbox cursor: monotonic event id, default 0 (everything).
export const AfterSchema = z.number().int().min(0).default(0);
