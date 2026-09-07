import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { openCore, type CoreHandle, type Response } from "../../src/core/index.js";

// Shared fixtures for core/storage tests. Everything lives under fresh
// temporary directories; no real home state is ever created. Callers close
// cores in finally blocks; the helpers never hide a close failure.

export const WORKSPACE_ROOT = new URL("../../..", import.meta.url).pathname.replace(/\/$/, "");

export function tempDir(prefix: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

export function removeDir(path: string): void {
  rmSync(path, { recursive: true, force: true });
}

export interface TestCore {
  core: CoreHandle;
  home: string;
}

export function openTestCore(home?: string, now?: () => number): TestCore {
  const dir = home ?? tempDir("company-home-");
  return { core: openCore(now === undefined ? { home: dir } : { home: dir, now }), home: dir };
}

export function closeCore(core: CoreHandle): void {
  core.close();
}

export async function execOk<T>(core: CoreHandle, request: unknown): Promise<T> {
  const response: Response = await core.execute(request);
  if (!response.ok) {
    throw new Error(`expected ok response, got ${response.error.code}: ${response.error.message}`);
  }
  return response.data as T;
}

export interface ErrorEnvelope {
  code: string;
  message: string;
  details?: unknown;
}

export async function execErr(core: CoreHandle, request: unknown): Promise<ErrorEnvelope> {
  const response: Response = await core.execute(request);
  if (response.ok) throw new Error("expected error response, got ok");
  return response.error;
}

// Envelope builders mirroring the CLI shape (operation inserted by caller).
export function regRequest(operation: string, requestId: string, payload: unknown): unknown {
  return { schemaVersion: 1, operation, requestId, payload };
}

export function mutRequest(
  operation: string,
  projectId: string,
  actorId: string,
  requestId: string,
  payload: unknown,
): unknown {
  return { schemaVersion: 1, operation, projectId, actorId, requestId, payload };
}

export function readRequest(operation: string, projectId: string, payload: unknown): unknown {
  return { schemaVersion: 1, operation, projectId, payload };
}

// Disposable Git fixtures. Commits here are the explicit test-fixture
// exception: they happen only inside newly created temporary directories,
// never in the application folder or a user project.
function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe", timeout: 30000 }).trim();
}

export function initGitRepo(): string {
  const repo = tempDir("company-repo-");
  try {
    git(repo, ["init"]);
    git(repo, ["config", "user.email", "test@example.com"]);
    git(repo, ["config", "user.name", "Test"]);
    writeFileSync(join(repo, "file.txt"), "hello\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "initial"]);
    return repo;
  } catch (error) {
    removeDir(repo);
    throw error;
  }
}

export function addWorktree(repo: string, name: string): string {
  const path = `${tempDir("company-wtbase-")}-${name}`;
  removeDir(path);
  git(repo, ["worktree", "add", path]);
  return realpathSync(path);
}

export function removeWorktree(repo: string, path: string): void {
  try {
    git(repo, ["worktree", "remove", "--force", path]);
  } catch {
    removeDir(path);
  }
}

export function cloneRepo(repo: string): string {
  const path = `${tempDir("company-clonebase-")}-clone`;
  removeDir(path);
  execFileSync("git", ["clone", "--quiet", repo, path], {
    encoding: "utf8",
    stdio: "pipe",
    timeout: 60000,
  });
  return realpathSync(path);
}

export function symlinkPath(target: string): string {
  const link = `${tempDir("company-linkbase-")}-link`;
  removeDir(link);
  symlinkSync(target, link);
  return link;
}

export function gitHead(repo: string): string {
  return git(repo, ["rev-parse", "HEAD"]);
}

export function gitDirty(repo: string): boolean {
  return git(repo, ["status", "--porcelain"]).length > 0;
}

export function gitCommitFile(repo: string, name: string, content: string, message: string): void {
  writeFileSync(join(repo, name), content);
  git(repo, ["add", name]);
  git(repo, ["commit", "-m", message]);
}
