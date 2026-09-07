import type { DatabaseSync } from "node:sqlite";
import { isAbsolute } from "node:path";
import { CoreOpenError } from "./contracts.js";
import type { Response } from "./contracts.js";
import { executeRequest } from "./dispatch.js";
import { openDatabase } from "../storage/db.js";

export * from "./contracts.js";
export { OpError } from "./errors.js";

export interface OpenCoreOptions {
  // Absolute state directory. Database is loreforge.sqlite3 (or legacy company.sqlite3).
  home: string;
  // Milliseconds since epoch. Test injection only; never exposed via CLI.
  now?: () => number;
}

export interface CoreHandle {
  execute(request: unknown): Promise<Response>;
  close(): void;
}

// Open the core against a state directory, running versioned migrations.
// Throws CoreOpenError (IO or BUSY); execute itself returns envelopes.
export function openCore(options: OpenCoreOptions): CoreHandle {
  if (!options || typeof options.home !== "string" || !isAbsolute(options.home)) {
    throw new CoreOpenError("IO", "core home must be an absolute directory path");
  }
  const now = options.now ?? (() => Date.now());
  const db: DatabaseSync = openDatabase(options.home);
  let closed = false;
  return {
    execute(request: unknown): Promise<Response> {
      if (closed) {
        return Promise.resolve({
          schemaVersion: 1,
          ok: false,
          error: { code: "IO", message: "core is closed" },
        });
      }
      return executeRequest(db, now, request);
    },
    close(): void {
      if (!closed) {
        closed = true;
        try {
          db.close();
        } catch {
          // Close is best-effort; the handle is unusable afterwards either way.
        }
      }
    },
  };
}
