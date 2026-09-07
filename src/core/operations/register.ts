import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  AgentRegisterData,
  ProjectRegisterData,
  Request,
} from "../contracts.js";
import { OpError } from "../errors.js";
import { discoverProject } from "../../evidence/git.js";
import { readReceipt } from "../../storage/receipts.js";
import { toAgent, toProject, transactMutation, withMutation } from "./common.js";

type ProjectRegisterRequest = Extract<Request, { operation: "project.register" }>;
type AgentRegisterRequest = Extract<Request, { operation: "agent.register" }>;

export function registerProject(
  db: DatabaseSync,
  now: () => number,
  request: ProjectRegisterRequest,
): ProjectRegisterData {
  const early = readReceipt<ProjectRegisterData>(db, request);
  if (early !== undefined) return early;
  // Git discovery happens outside the transaction: it is an observation, and
  // a retry must still succeed after the checkout moves or disappears.
  const identity = discoverProject(request.payload.root);
  return transactMutation(db, now, request, (nowMs) => {
    const existing = db
      .prepare("SELECT * FROM projects WHERE git_common_dir = ?")
      .get(identity.gitCommonDir) as Parameters<typeof toProject>[0] | undefined;
    // An existing canonical identity returns the existing record and never
    // renames it, regardless of the requested name.
    const project = existing
      ? toProject(existing)
      : (() => {
          const row = {
            id: randomUUID(),
            name: request.payload.name,
            root: identity.root,
            git_common_dir: identity.gitCommonDir,
            created_at: nowMs,
          };
          db.prepare(
            "INSERT INTO projects (id, name, root, git_common_dir, created_at) VALUES (?, ?, ?, ?, ?)",
          ).run(row.id, row.name, row.root, row.git_common_dir, row.created_at);
          return toProject(row);
        })();
    return { project };
  });
}

export function registerAgent(
  db: DatabaseSync,
  now: () => number,
  request: AgentRegisterRequest,
): AgentRegisterData {
  return withMutation(db, now, request, (nowMs) => {
    const existing = db.prepare("SELECT * FROM agents WHERE id = ?").get(request.payload.id) as
      | Parameters<typeof toAgent>[0]
      | undefined;
    if (existing) {
      // Same id and name replays the existing record; a different name for a
      // taken id is CONFLICT, decided here rather than by the receipt layer.
      if (existing.display_name !== request.payload.displayName) {
        throw OpError.conflict("agent id is already registered with a different name");
      }
      return { agent: toAgent(existing) };
    }
    const row = { id: request.payload.id, display_name: request.payload.displayName, created_at: nowMs };
    db.prepare("INSERT INTO agents (id, display_name, created_at) VALUES (?, ?, ?)").run(
      row.id,
      row.display_name,
      row.created_at,
    );
    return { agent: toAgent(row) };
  });
}
