import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Request, ResponseData } from "../core/contracts.js";
import { OpError } from "../core/errors.js";

// Request receipts: every mutation looks up (scope, actorKey, requestId)
// first. The same canonical hash replays the original response; a different
// hash is CONFLICT. Receipts never persist raw payloads beyond the hash, and
// claim replays retain the original token via the stored response.

export interface ReceiptIdentity {
  scope: string;
  actorKey: string;
}

type MutationRequest = Extract<Request, { requestId: string }>;

export function receiptIdentity(request: MutationRequest): ReceiptIdentity {
  if (request.operation === "project.register" || request.operation === "agent.register") {
    return { scope: "global", actorKey: "registration" };
  }
  const scoped = request as MutationRequest & { projectId: string; actorId: string };
  return { scope: scoped.projectId, actorKey: scoped.actorId };
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }
  const text = JSON.stringify(value);
  if (typeof text !== "string") throw new Error("unserializable receipt payload");
  return text;
}

// Canonical request hash over operation, project scope, actor, and validated
// payload (defaults applied, object keys recursively sorted, array order
// preserved). Computed before any observation or timestamp is added.
export function canonicalHash(request: MutationRequest): string {
  const identity = receiptIdentity(request);
  return createHash("sha256")
    .update(
      stableStringify({
        actor: identity.actorKey,
        operation: request.operation,
        payload: request.payload,
        scope: identity.scope,
      }),
    )
    .digest("hex");
}

interface ReceiptRow {
  operation: string;
  request_hash: string;
  response_json: string;
}

// Control-flow signal: our receipt insert lost a cross-process race. The
// surrounding helper rolls back and retries once, then replays or conflicts
// from a fresh read. Never surfaces as IO.
export class ReceiptClashError extends Error {
  constructor() {
    super("mutation receipt already recorded");
    this.name = "ReceiptClashError";
  }
}

export function isReceiptPkClash(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /UNIQUE constraint failed: mutation_receipts/.test(message);
}

export function findReceipt(
  db: DatabaseSync,
  scope: string,
  actorKey: string,
  requestId: string,
): ReceiptRow | undefined {
  const row = db
    .prepare(
      "SELECT operation, request_hash, response_json FROM mutation_receipts WHERE scope = ? AND actor_key = ? AND request_id = ?",
    )
    .get(scope, actorKey, requestId) as ReceiptRow | undefined;
  return row;
}

export function insertReceipt(
  db: DatabaseSync,
  scope: string,
  actorKey: string,
  requestId: string,
  operation: string,
  requestHash: string,
  responseJson: string,
  nowMs: number,
): void {
  db.prepare(
    "INSERT INTO mutation_receipts (scope, actor_key, request_id, operation, request_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(scope, actorKey, requestId, operation, requestHash, responseJson, nowMs);
}

function replayOrConflict<T>(row: ReceiptRow, request: MutationRequest, hash: string): T {
  if (row.operation === request.operation && row.request_hash === hash) {
    return JSON.parse(row.response_json) as T;
  }
  throw OpError.conflict("requestId was already used with a different operation or payload");
}

// Pre-transaction receipt check plus transactional recheck. Simple mutations
// (no outside-transaction work) run entirely through withMutation; handlers
// with outside work (Git collection) call readReceipt early and storeReceipt
// inside their own transaction.
export function readReceipt<T>(db: DatabaseSync, request: MutationRequest): T | undefined {
  const identity = receiptIdentity(request);
  const row = findReceipt(db, identity.scope, identity.actorKey, request.requestId);
  if (!row) return undefined;
  return replayOrConflict<T>(row, request, canonicalHash(request));
}

export function storeReceipt(
  db: DatabaseSync,
  request: MutationRequest,
  data: ResponseData,
  nowMs: number,
): void {
  const identity = receiptIdentity(request);
  insertReceipt(
    db,
    identity.scope,
    identity.actorKey,
    request.requestId,
    request.operation,
    canonicalHash(request),
    JSON.stringify(data),
    nowMs,
  );
}
