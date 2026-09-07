import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const currentDir = fileURLToPath(new URL(".", import.meta.url));
const packageRoot = resolve(currentDir, "../..");
const distBin = join(packageRoot, "dist", "cli", "main.js");

function runSubprocess(
  args: string[],
  options: { cwd?: string; input?: string; env?: NodeJS.ProcessEnv } = {}
) {
  const env = { ...process.env, ...(options.env || {}) };
  return spawnSync(process.execPath, [distBin, ...args], {
    cwd: options.cwd || packageRoot,
    input: options.input,
    env,
    encoding: "utf-8"
  });
}

describe("CLI Basics Acceptance (A16, A17, A24, A26)", () => {
  it("A17: --help and scoped help exit 0 without creating state", () => {
    const tempHome = mkdtempSync(join(tmpdir(), "acceptance-a17-help-"));
    const nonExistentState = join(tempHome, "state-sub");

    try {
      const res = runSubprocess(["--help"], {
        env: { AGENT_COMPANY_HOME: nonExistentState }
      });

      assert.equal(res.status, 0, `Expected exit 0, got ${res.status}: ${res.stderr}`);
      assert.ok(res.stdout.includes("Loreforge — shared memory for independent agents."));
      assert.equal(existsSync(nonExistentState), false, "Help must not create state directory");

      const scopedRes = runSubprocess(["task", "claim", "--help"], {
        env: { AGENT_COMPANY_HOME: nonExistentState }
      });
      assert.equal(scopedRes.status, 0);
      assert.equal(existsSync(nonExistentState), false, "Scoped help must not create state directory");
    } finally {
      rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it("A17: missing-state read returns NOT_FOUND (exit 3) and creates no database", () => {
    const tempHome = mkdtempSync(join(tmpdir(), "acceptance-a17-read-"));
    const nonExistentState = join(tempHome, "missing-state");

    try {
      const input = JSON.stringify({
        schemaVersion: 1,
        projectId: "11111111-1111-4111-8111-111111111111",
        payload: { taskId: "22222222-2222-4222-8222-222222222222" }
      });

      const res = runSubprocess(
        ["task", "get", "--input", "-", "--home", nonExistentState, "--json"],
        { input }
      );

      assert.equal(res.status, 3, `Expected exit code 3 (NOT_FOUND), got ${res.status}`);
      assert.equal(existsSync(nonExistentState), false, "Missing-state read must not create state directory");

      // Verify JSON stdout is a single parseable value
      const stdoutLines = res.stdout.trim().split("\n");
      assert.equal(stdoutLines.length, 1, "Expected exactly one JSON response line on stdout");
      const parsed = JSON.parse(stdoutLines[0]);
      assert.equal(parsed.schemaVersion, 1);
      assert.equal(parsed.ok, false);
      assert.equal(parsed.error.code, "NOT_FOUND");
    } finally {
      rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it("A16: oversized input (>64 KiB) and malformed JSON fail before mutation without leaking secrets", () => {
    const tempHome = mkdtempSync(join(tmpdir(), "acceptance-a16-"));
    const secret = "SUPER_SECRET_PAYLOAD_CONTENT";

    try {
      // 1. Oversized input
      const bigPayload = JSON.stringify({
        schemaVersion: 1,
        requestId: "req-1",
        payload: { large: "X".repeat(66000) }
      });

      const resOversized = runSubprocess(
        ["task", "create", "--input", "-", "--home", tempHome, "--json"],
        { input: bigPayload }
      );
      assert.equal(resOversized.status, 2, "Oversized input must exit with code 2 (VALIDATION)");
      const parsedOversized = JSON.parse(resOversized.stdout.trim());
      assert.equal(parsedOversized.ok, false);
      assert.equal(parsedOversized.error.code, "VALIDATION");

      // 2. Malformed JSON containing secret
      const malformedInput = `{"schemaVersion": 1, "secret": "${secret}" unclosed`;
      const resMalformed = runSubprocess(
        ["task", "create", "--input", "-", "--home", tempHome, "--json"],
        { input: malformedInput }
      );
      assert.equal(resMalformed.status, 2, "Malformed JSON must exit with code 2 (VALIDATION)");
      assert.ok(!resMalformed.stdout.includes(secret), "Secret must not leak into stdout");
      assert.ok(!resMalformed.stderr.includes(secret), "Secret must not leak into stderr");
    } finally {
      rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it("A24: instructions show safely quotes paths with spaces and does not modify filesystem", () => {
    const tempHome = mkdtempSync(join(tmpdir(), "acceptance-a24-"));
    const homeWithSpaces = join(tempHome, "home path with spaces");

    try {
      const res = runSubprocess([
        "instructions",
        "show",
        "--project",
        "11111111-1111-4111-8111-111111111111",
        "--agent",
        "flash",
        "--home",
        homeWithSpaces
      ]);

      assert.equal(res.status, 0, `Expected exit 0: ${res.stderr}`);
      assert.ok(res.stdout.includes("11111111-1111-4111-8111-111111111111"));
      assert.ok(res.stdout.includes("flash"));
      assert.ok(res.stdout.includes(`'${homeWithSpaces}'`), "Path with spaces must be safely shell-quoted");
      assert.equal(existsSync(homeWithSpaces), false, "Instructions command must not create directory");
    } finally {
      rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it("A26: compiled CLI runs from foreign cwd with explicit temp home and two worktrees of one repo", () => {
    const foreignCwd = mkdtempSync(join(tmpdir(), "acceptance-a26-foreign-"));
    const fixture = mkdtempSync(join(tmpdir(), "acceptance-a26-fixture-"));
    const home = join(fixture, "home");
    const repo = join(fixture, "repo");
    const worktree = join(fixture, "linked-worktree");
    mkdirSync(repo, { recursive: true });

    try {
      execFileSync("git", ["init", "-b", "main", repo], { stdio: "pipe" });
      execFileSync("git", ["config", "user.name", "A26 Tester"], { cwd: repo, stdio: "pipe" });
      execFileSync("git", ["config", "user.email", "a26@example.test"], { cwd: repo, stdio: "pipe" });
      writeFileSync(join(repo, "hello.txt"), "hello\n");
      execFileSync("git", ["add", "hello.txt"], { cwd: repo, stdio: "pipe" });
      execFileSync("git", ["commit", "-m", "init"], { cwd: repo, stdio: "pipe" });
      execFileSync("git", ["worktree", "add", worktree, "HEAD"], { cwd: repo, stdio: "pipe" });

      const helpRes = runSubprocess(["--help"], { cwd: foreignCwd });
      assert.equal(helpRes.status, 0, `Expected exit 0 from foreign cwd: ${helpRes.stderr}`);
      assert.ok(helpRes.stdout.includes("Loreforge — shared memory for independent agents."));
      assert.equal(existsSync(home), false, "Help must not create home directory");

      // Register root from foreign cwd
      const regRoot = runSubprocess(
        ["project", "register", "--home", home, "--json", "--input", "-"],
        {
          cwd: foreignCwd,
          input: JSON.stringify({
            schemaVersion: 1,
            requestId: "reg-root",
            payload: { root: repo, name: "A26" },
          }),
        }
      );
      assert.equal(regRoot.status, 0);
      const parsedRoot = JSON.parse(regRoot.stdout.trim().split("\n")[0]);
      assert.equal(parsedRoot.ok, true);
      const projectId = parsedRoot.data.project.id;

      // Register worktree from foreign cwd
      const regWt = runSubprocess(
        ["project", "register", "--home", home, "--json", "--input", "-"],
        {
          cwd: foreignCwd,
          input: JSON.stringify({
            schemaVersion: 1,
            requestId: "reg-wt",
            payload: { root: worktree, name: "A26-worktree-alias" },
          }),
        }
      );
      assert.equal(regWt.status, 0);
      const parsedWt = JSON.parse(regWt.stdout.trim().split("\n")[0]);
      assert.equal(parsedWt.ok, true);
      assert.equal(parsedWt.data.project.id, projectId, "Worktree must resolve to identical project ID");

      assert.equal(existsSync(join(home, "loreforge.sqlite3")), true, "Database created in explicit home");
      assert.equal(existsSync(join(foreignCwd, "loreforge.sqlite3")), false, "No database in foreign cwd");
    } finally {
      try {
        execFileSync("git", ["worktree", "remove", "--force", worktree], { cwd: repo, stdio: "pipe" });
      } catch {}
      rmSync(foreignCwd, { recursive: true, force: true });
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
