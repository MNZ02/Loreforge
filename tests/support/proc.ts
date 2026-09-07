import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { Response } from "../../src/core/index.js";

// Independent-process execution for concurrency tests. Merely calling the
// same JS function twice is not a concurrency test, so each child is a fresh
// Node process with its own SQLite connection. Children import the real core
// from this workspace via tsx; the request travels as a JSON file and the
// response comes back as a marked stdout line (robust against runtime
// warnings on stderr/stdout).

const CORE_INDEX_PATH = fileURLToPath(new URL("../../src/core/index.ts", import.meta.url));

const CHILD_SOURCE = `import { existsSync, readFileSync } from "node:fs";
import { openCore } from ${JSON.stringify(CORE_INDEX_PATH)};
const [home, gate, reqFile] = process.argv.slice(2);
if (gate !== "-") {
  const deadline = Date.now() + 60000;
  while (!existsSync(gate)) {
    if (Date.now() > deadline) {
      console.error("child: gate wait timed out");
      process.exit(2);
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}
const request = JSON.parse(readFileSync(reqFile, "utf8"));
let core = null;
try {
  core = openCore({ home });
} catch (e) {
  console.log("RESULT " + JSON.stringify({ schemaVersion: 1, ok: false, error: { code: e && e.code ? e.code : "IO", message: e && e.message ? e.message : "open failed" } }));
  process.exit(0);
}
try {
  const response = await core.execute(request);
  console.log("RESULT " + JSON.stringify(response));
} finally {
  core.close();
}
`;

export interface ChildResult {
  exitCode: number | null;
  response: Response | null;
  stdout: string;
  stderr: string;
}

const HOLDER_SOURCE = `import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
const [home, holdMs] = process.argv.slice(2);
const db = new DatabaseSync(join(home, "loreforge.sqlite3"));
db.exec("PRAGMA busy_timeout = 5000");
try {
  db.exec("BEGIN IMMEDIATE");
} catch (e) {
  console.log("HOLDER-FAILED " + (e && e.message ? e.message : e));
  process.exit(1);
}
console.log("HOLDER-READY");
await new Promise((r) => setTimeout(r, Number(holdMs)));
try {
  db.exec("COMMIT");
} catch (e) {
  console.log("HOLDER-COMMIT-FAILED " + (e && e.message ? e.message : e));
  process.exit(1);
}
db.close();
`;

export interface LockHolder {
  ready: Promise<void>;
  done: Promise<number | null>;
}

// Holds a write lock on the home database from an independent process for
// holdMs, so lock-contention tests exercise real cross-process blocking.
export function runLockHolder(home: string, holdMs: number): LockHolder {
  const dir = mkdtempSync(join(tmpdir(), "company-holder-"));
  const holderPath = join(dir, "holder.mjs");
  writeFileSync(holderPath, HOLDER_SOURCE);
  const child = spawn(process.execPath, [holderPath, home, String(holdMs)], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let readyResolve: () => void = () => {};
  let readyReject: (error: Error) => void = () => {};
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const done = new Promise<number | null>((resolve) => {
    child.on("error", () => resolve(null));
    child.on("close", (code) => resolve(code));
  });
  const timer = setTimeout(() => readyReject(new Error("lock holder never became ready")), 60000);
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += String(chunk);
    if (output.includes("HOLDER-READY")) {
      clearTimeout(timer);
      readyResolve();
    }
    if (output.includes("HOLDER-FAILED")) {
      clearTimeout(timer);
      readyReject(new Error(`lock holder failed: ${output}`));
    }
  });
  child.stderr.on("data", () => {});
  return { ready, done };
}

export function runCoreChild(
  home: string,
  request: unknown,
  options?: { gate?: string; timeoutMs?: number },
): Promise<ChildResult> {
  const dir = mkdtempSync(join(tmpdir(), "company-child-"));
  const childPath = join(dir, "child.mts");
  const reqPath = join(dir, "request.json");
  writeFileSync(childPath, CHILD_SOURCE);
  writeFileSync(reqPath, JSON.stringify(request));
  const timeoutMs = options?.timeoutMs ?? 120000;
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", childPath, home, options?.gate ?? "-", reqPath],
      { cwd: join(CORE_INDEX_PATH, "..", "..", ".."), timeout: timeoutMs, windowsHide: true },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      resolve({ exitCode: null, response: null, stdout, stderr: stderr + String(error) });
    });
    child.on("close", (exitCode) => {
      let response: Response | null = null;
      for (const line of stdout.split("\n")) {
        if (line.startsWith("RESULT ")) {
          try {
            response = JSON.parse(line.slice("RESULT ".length)) as Response;
          } catch {
            response = null;
          }
        }
      }
      resolve({ exitCode, response, stdout, stderr });
    });
  });
}
