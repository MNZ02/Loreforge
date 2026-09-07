import type { DatabaseSync } from "node:sqlite";
import type { Agent, Project, ResponseData, Task, TaskStatus } from "../contracts.js";
import { OpError } from "../errors.js";
import { withWrite } from "../../storage/db.js";
import {
  ReceiptClashError,
  canonicalHash,
  findReceipt,
  isReceiptPkClash,
  readReceipt,
  receiptIdentity,
  storeReceipt,
} from "../../storage/receipts.js";
import type { Request } from "../contracts.js";

export type MutationRequest = Extract<Request, { requestId: string }>;

export function toIso(ms: number): string {
  return new Date(ms).toISOString();
}

export interface ProjectRow {
  id: string;
  name: string;
  root: string;
  git_common_dir: string;
  created_at: number;
}

export function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    root: row.root,
    gitCommonDir: row.git_common_dir,
    createdAt: toIso(row.created_at),
  };
}

interface AgentRow {
  id: string;
  display_name: string;
  created_at: number;
}

export function toAgent(row: AgentRow): Agent {
  return { id: row.id, displayName: row.display_name, createdAt: toIso(row.created_at) };
}

export interface TaskRow {
  id: string;
  project_id: string;
  title: string;
  description: string;
  status: string;
  owner_id: string | null;
  claim_token: string | null;
  attempt: number;
  lease_until: number | null;
  created_at: number;
  updated_at: number;
}

export function loadDependsOn(db: DatabaseSync, taskId: string): string[] {
  const rows = db
    .prepare("SELECT depends_on_task_id FROM task_dependencies WHERE task_id = ?")
    .all(taskId) as Array<{ depends_on_task_id: string }>;
  return rows.map((row) => row.depends_on_task_id);
}

export function toTask(db: DatabaseSync, row: TaskRow): Task {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    status: row.status as TaskStatus,
    dependsOn: loadDependsOn(db, row.id),
    ownerId: row.owner_id,
    attempt: row.attempt,
    leaseUntil: row.lease_until === null ? null : toIso(row.lease_until),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

// Every project-scoped operation starts here: unknown projects (and any ID
// looked up under the wrong project) are NOT_FOUND without revealing whether
// the entity exists elsewhere.
export function requireProject(db: DatabaseSync, projectId: string): ProjectRow {
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId) as
    | ProjectRow
    | undefined;
  if (!row) throw OpError.notFound("project not found");
  return row;
}

export function requireAgent(db: DatabaseSync, actorId: string): AgentRow {
  const row = db.prepare("SELECT * FROM agents WHERE id = ?").get(actorId) as AgentRow | undefined;
  if (!row) throw OpError.notFound("agent not found");
  return row;
}

// Transactional core shared by every mutation: recheck, produce, and receipt
// insert in one BEGIN IMMEDIATE transaction. If our receipt insert loses a
// cross-process race, the transaction rolls back and retries once; the fresh
// read then replays the winner's response for identical retries or reports
// CONFLICT for a reused key.
//
// The clock is sampled only after the write transaction is acquired, inside
// it: a mutation that waits behind another process's lock must judge leases
// and stamp rows with the acquisition time, never the dispatch time.
export function transactMutation<T extends ResponseData>(
  db: DatabaseSync,
  now: () => number,
  request: MutationRequest,
  produce: (nowMs: number) => T,
): T {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return withWrite(db, () => {
        const again = readReceipt<T>(db, request);
        if (again !== undefined) return again;
        const nowMs = now();
        const data = produce(nowMs);
        try {
          storeReceipt(db, request, data, nowMs);
        } catch (error) {
          if (isReceiptPkClash(error)) throw new ReceiptClashError();
          throw error;
        }
        return data;
      });
    } catch (error) {
      if (!(error instanceof ReceiptClashError)) throw error;
      if (attempt === 0) continue;
      const identity = receiptIdentity(request);
      const row = findReceipt(db, identity.scope, identity.actorKey, request.requestId);
      if (
        row &&
        row.operation === request.operation &&
        row.request_hash === canonicalHash(request)
      ) {
        return JSON.parse(row.response_json) as T;
      }
      throw OpError.conflict("requestId was already used with a different operation or payload");
    }
  }
}

// Receipt-first mutation wrapper for handlers with no outside-transaction
// work: early replay check, then transactMutation.
export function withMutation<T extends ResponseData>(
  db: DatabaseSync,
  now: () => number,
  request: MutationRequest,
  produce: (nowMs: number) => T,
): T {
  const early = readReceipt<T>(db, request);
  if (early !== undefined) return early;
  return transactMutation(db, now, request, produce);
}
