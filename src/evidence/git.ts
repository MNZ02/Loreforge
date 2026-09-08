import { spawn, spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { CurrentGit } from "../core/contracts.js";
import { OpError } from "../core/errors.js";

// Read-only Git discovery for project registration. Every subprocess is an
// argument-array call with a controlled cwd and a timeout; user-supplied
// paths are never executed as code and no shell is involved.
export const GIT_TIMEOUT_MS = 10000;

// Accepted Git HEAD shape: 40-hex SHA-1 or 64-hex SHA-256. Must stay
// identical to HEAD_RE in src/core/schemas/common.ts (CONTRACT.md requires
// "full 40- or 64-hex commit ID"); observation must not reject what the
// schema accepts.
const GIT_HEAD_RE = /^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;

export interface ProjectIdentity {
  root: string;
  gitCommonDir: string;
}

function runGit(cwd: string, args: string[]): { status: number | null; stdout: string } {
  try {
    // --no-optional-locks keeps read-only observation from refreshing the
    // user's index (e.g. after a mere mtime touch): status still reports
    // correctly but never writes. This changes no user configuration.
    const result = spawnSync("git", ["--no-optional-locks", ...args], {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      encoding: "utf8",
      maxBuffer: 64 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error) throw OpError.io("git subprocess failed");
    return { status: result.status, stdout: typeof result.stdout === "string" ? result.stdout : "" };
  } catch (error) {
    if (error instanceof OpError) throw error;
    throw OpError.io("git subprocess failed");
  }
}

// Consume status incrementally: retain only the dirty bit, not the file listing.
// Wait for successful exit so partial output from a failed Git command is not evidence.
async function observeDirty(cwd: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["--no-optional-locks", "status", "--porcelain", "-z"], {
      cwd, stdio: ["ignore", "pipe", "ignore"], timeout: GIT_TIMEOUT_MS,
    });
    let dirty = false;
    child.stdout.on("data", (chunk: Buffer) => { if (chunk.length) dirty = true; });
    child.once("error", () => reject(OpError.conflict("could not collect Git status")));
    child.once("close", (code) => {
      if (code === 0) resolve(dirty);
      else reject(OpError.conflict("could not collect Git status"));
    });
  });
}

// Core-collected read-only observation attached to every handoff. Timestamped
// evidence of what the core saw; explicitly not a filesystem lock and not an
// immutable snapshot of dirty content.
export interface CheckoutObservation {
  checkoutRoot: string;
  head: string;
  dirty: boolean;
  collectedAt: string;
}

// Observe a checkout without modifying it. Any collection failure is CONFLICT
// (the reported evidence cannot be accepted), never a completed task: callers
// run this outside the write transaction and only persist inside it.
export async function observeCheckout(checkoutRoot: string, nowMs: number): Promise<CheckoutObservation> {
  let canonical: string;
  try {
    canonical = realpathSync(checkoutRoot);
  } catch {
    throw OpError.conflict("could not collect Git observation for reported checkout");
  }
  const headProbe = runGit(canonical, ["rev-parse", "HEAD"]);
  const head = headProbe.stdout.trim();
  if (headProbe.status !== 0 || !GIT_HEAD_RE.test(head)) {
    throw OpError.conflict("could not collect Git observation for reported checkout");
  }
  const dirty = await observeDirty(canonical);
  return {
    checkoutRoot: canonical,
    head: head.toLowerCase(),
    dirty,
    collectedAt: new Date(nowMs).toISOString(),
  };
}

// Best-effort read of the registered project root for context snapshots. An
// absent or unreadable root is null head/dirty plus a sanitized error, never
// a failed context request. Never throws.
export async function observeCurrentGit(root: string, nowMs: number): Promise<CurrentGit> {
  const collectedAt = new Date(nowMs).toISOString();
  const failure: CurrentGit = { head: null, dirty: null, collectedAt, error: "could not read project Git state" };
  let canonical: string;
  try {
    canonical = realpathSync(root);
  } catch {
    return failure;
  }
  try {
    const observed = await observeCheckout(canonical, nowMs);
    return { head: observed.head, dirty: observed.dirty, collectedAt, error: null };
  } catch {
    return failure;
  }
}

// Resolve a checkout root to its canonical project identity. Worktrees of one
// repository share the same realpath Git common directory and therefore the
// same project; distinct clones differ. Non-Git roots are VALIDATION, not IO:
// the input path is well-formed but unacceptable in v0.1.
export function discoverProject(root: string): ProjectIdentity {
  let canonicalRoot: string;
  try {
    canonicalRoot = realpathSync(root);
  } catch {
    throw OpError.validation("project root is not an accessible directory");
  }
  const probe = runGit(canonicalRoot, ["rev-parse", "--git-common-dir"]);
  if (probe.status !== 0) {
    throw OpError.validation("project root is not inside a Git repository");
  }
  const reported = probe.stdout.trim();
  if (reported.length === 0) {
    throw OpError.validation("project root is not inside a Git repository");
  }
  const joined = isAbsolute(reported) ? reported : resolve(canonicalRoot, reported);
  try {
    const top = runGit(canonicalRoot, ["rev-parse", "--show-toplevel"]);
    if (top.status !== 0) throw OpError.validation("project must be a working Git repository");
    return { root: realpathSync(top.stdout.trim()), gitCommonDir: realpathSync(joined) };
  } catch {
    throw OpError.validation("project root is not inside a Git repository");
  }
}
