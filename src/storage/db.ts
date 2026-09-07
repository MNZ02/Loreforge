import { DatabaseSync } from "node:sqlite";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { CoreOpenError } from "../core/contracts.js";
import { OpError } from "../core/errors.js";
import { MIGRATIONS } from "./schema.js";

// Lifecycle: open, pragma setup, versioned migrations, short synchronous
// transactions. SQLite work never spans an await or a subprocess.

export const DB_FILENAME = "loreforge.sqlite3";
export const LEGACY_DB_FILENAME = "company.sqlite3";
export const BUSY_TIMEOUT_MS = 5000;

// New homes use loreforge.sqlite3. An existing company.sqlite3 in the same
// directory is opened as-is so the rename does not orphan prior state.
export function resolveDbPath(home: string): string {
  const next = join(home, DB_FILENAME);
  const legacy = join(home, LEGACY_DB_FILENAME);
  if (existsSync(next)) return next;
  if (existsSync(legacy)) return legacy;
  return next;
}

export function databaseExists(home: string): boolean {
  return existsSync(join(home, DB_FILENAME)) || existsSync(join(home, LEGACY_DB_FILENAME));
}

function errcodeOf(error: unknown): number | null {
  if (typeof error === "object" && error !== null && "errcode" in error) {
    const code = (error as { errcode?: unknown }).errcode;
    return typeof code === "number" ? code : null;
  }
  return null;
}

function codeOf(error: unknown): string | null {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : null;
  }
  return null;
}

// SQLITE_BUSY (5) and SQLITE_LOCKED (6) surface with a generic code, so match
// the numeric errcode first and fall back to the lock message text.
export function isBusyError(error: unknown): boolean {
  const errcode = errcodeOf(error);
  if (errcode === 5 || errcode === 6) return true;
  if (codeOf(error) === "ERR_SQLITE_BUSY") return true;
  const message = error instanceof Error ? error.message : String(error);
  return /database is (locked|busy)|database table is locked/i.test(message);
}

export function isSqliteError(error: unknown): boolean {
  if (errcodeOf(error) !== null) return true;
  const code = codeOf(error);
  return code !== null && code.startsWith("ERR_SQLITE_");
}

// Convert a storage-layer throw into an operation error. OpError and
// CoreOpenError pass through; lock contention becomes BUSY; other SQLite
// faults become IO with a sanitized message; anything else rethrows for the
// dispatcher's INTERNAL mapping.
export function toOpError(error: unknown): Error {
  if (error instanceof OpError || error instanceof CoreOpenError) return error;
  if (isBusyError(error)) return OpError.busy("database is locked by another process");
  if (isSqliteError(error)) return OpError.io("database access failed");
  return error instanceof Error ? error : new Error("unknown storage failure");
}

export function beginImmediate(db: DatabaseSync): void {
  try {
    db.exec("BEGIN IMMEDIATE");
  } catch (error) {
    throw toOpError(error);
  }
}

// Short synchronous read transaction for multi-query snapshots. No writes,
// no subprocesses, no awaits inside.
export function withRead<T>(db: DatabaseSync, work: () => T): T {
  try {
    db.exec("BEGIN");
  } catch (error) {
    throw toOpError(error);
  }
  try {
    const result = work();
    try {
      db.exec("COMMIT");
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // Best-effort; the COMMIT failure below is what matters.
      }
      throw toOpError(error);
    }
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Best-effort; the original error below is what matters.
    }
    throw toOpError(error);
  }
}

// Short synchronous write transaction. Any error rolls back every effect;
// the receipt row is written by the caller inside the same transaction.
export function withWrite<T>(db: DatabaseSync, work: () => T): T {
  beginImmediate(db);
  try {
    const result = work();
    try {
      db.exec("COMMIT");
    } catch (error) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // Rollback best-effort; the COMMIT failure below explains the state.
      }
      throw toOpError(error);
    }
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Best-effort; the original error below is what matters.
    }
    throw toOpError(error);
  }
}

function migrate(db: DatabaseSync): void {
  beginImmediate(db);
  try {
    db.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL) STRICT",
    );
    const rows = db
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .all() as Array<{ version: number }>;
    const applied = new Set(rows.map((row) => row.version));
    for (const migration of MIGRATIONS) {
      if (!applied.has(migration.version)) {
        db.exec(migration.sql);
        db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(
          migration.version,
          Date.now(),
        );
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Best-effort; the migration error below is what matters.
    }
    if (error instanceof CoreOpenError) throw error;
    if (error instanceof OpError && error.code === "BUSY") {
      throw new CoreOpenError("BUSY", "database is locked by another process");
    }
    throw new CoreOpenError("IO", "database migration failed");
  }
}

// Short synchronous pause between startup retries. openDatabase is
// synchronous, so this is a bounded Date.now wait, never an await and never
// a subprocess.
function sleepSync(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // Intentional bounded wait for a racing peer to finish startup.
  }
}

// Open (creating if needed) the state directory database. Throws CoreOpenError
// with IO for access failures or BUSY when the startup lock cannot be
// acquired within the busy timeout.
//
// Concurrent first opens race inside setup: PRAGMA journal_mode = WAL does
// not honor the connection busy timeout, so the loser sees SQLITE_BUSY while
// the winner migrates. Retry the whole setup on lock contention within the
// busy budget; only exhausted contention becomes BUSY, never IO. Genuine
// failures (unreadable directory, unopenable file, failed migration) still
// fail fast with IO.
export function openDatabase(home: string): DatabaseSync {
  try {
    mkdirSync(home, { recursive: true, mode: 0o700 });
    chmodSync(home, 0o700);
  } catch {
    throw new CoreOpenError("IO", "cannot create state directory");
  }
  const path = resolveDbPath(home);
  const deadline = Date.now() + BUSY_TIMEOUT_MS;
  for (;;) {
    let db: DatabaseSync;
    try {
      db = new DatabaseSync(path);
    } catch {
      throw new CoreOpenError("IO", "cannot open database file");
    }
    try {
      db.exec("PRAGMA foreign_keys = ON");
      db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
      db.exec("PRAGMA journal_mode = WAL");
      chmodSync(path, 0o600);
      migrate(db);
      return db;
    } catch (error) {
      try {
        db.close();
      } catch {
        // Best-effort close before retrying or reporting the open failure.
      }
      const retryable =
        (error instanceof CoreOpenError && error.code === "BUSY") || isBusyError(error);
      if (!retryable) {
        if (error instanceof CoreOpenError) throw error;
        throw new CoreOpenError("IO", "cannot initialize database");
      }
      if (Date.now() >= deadline) {
        throw new CoreOpenError("BUSY", "database is locked by another process");
      }
      sleepSync(25);
    }
  }
}
