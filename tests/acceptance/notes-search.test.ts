import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const currentDir = fileURLToPath(new URL(".", import.meta.url));
const packageRoot = resolve(currentDir, "../..");
const distBin = join(packageRoot, "dist", "cli", "main.js");

function run(
  args: string[],
  options: { input?: string; home: string },
) {
  return spawnSync(process.execPath, [distBin, ...args, "--home", options.home, "--json"], {
    cwd: packageRoot,
    input: options.input,
    encoding: "utf-8",
    env: { ...process.env },
  });
}

function parseOk(res: ReturnType<typeof spawnSync>): Record<string, unknown> {
  assert.equal(res.status, 0, `exit ${res.status}: ${res.stderr}\n${res.stdout}`);
  const parsed = JSON.parse(String(res.stdout).trim().split("\n").at(-1) ?? "");
  assert.equal(parsed.ok, true, JSON.stringify(parsed));
  return parsed.data as Record<string, unknown>;
}

function gitRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "loreforge-notes-repo-"));
  execFileSync("git", ["init"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
  writeFileSync(join(root, "README.md"), "demo\n");
  execFileSync("git", ["add", "README.md"], { cwd: root });
  execFileSync("git", ["commit", "-m", "init"], { cwd: root });
  return root;
}

describe("compiled CLI notes search", () => {
  it("adds, searches, and gets notes through the shipped CLI without a task id", () => {
    const home = mkdtempSync(join(tmpdir(), "loreforge-notes-home-"));
    const repo = gitRepo();
    try {
      const project = parseOk(
        run(["project", "register", "--input", "-"], {
          home,
          input: JSON.stringify({
            schemaVersion: 1,
            requestId: "reg-proj",
            payload: { root: repo, name: "NotesDemo" },
          }),
        }),
      );
      const projectId = (project.project as { id: string }).id;
      parseOk(
        run(["agent", "register", "--input", "-"], {
          home,
          input: JSON.stringify({
            schemaVersion: 1,
            requestId: "reg-agent",
            payload: { id: "grok", displayName: "Grok" },
          }),
        }),
      );

      const added = parseOk(
        run(["note", "add", "--input", "-"], {
          home,
          input: JSON.stringify({
            schemaVersion: 1,
            projectId,
            actorId: "grok",
            requestId: "note-1",
            payload: {
              title: "Coupon migration repair",
              finding:
                "Coupon migration repair uses 20260907000002_coupon_checkout_committed_at.sql rather than 20260907000000.",
              reason: "Version collision on staging.",
              evidenceRefs: ["reports/psigenei-security-2026-09-06/GROK-IMPLEMENTATION-RECHECK.md"],
              paths: ["supabase/migrations/20260907000002_coupon_checkout_committed_at.sql"],
              observedCommit: null,
              status: "proposed",
              taskId: null,
              supersedesId: null,
            },
          }),
        }),
      );
      const noteId = (added.note as { id: string }).id;

      const searched = spawnSync(
        process.execPath,
        [
          distBin,
          "search",
          "--query",
          "coupon migration repair",
          "--files",
          "supabase/migrations/20260907000002_coupon_checkout_committed_at.sql",
          "--limit",
          "5",
          "--project",
          projectId,
          "--home",
          home,
          "--json",
        ],
        { cwd: packageRoot, encoding: "utf-8", env: { ...process.env } },
      );
      const searchData = parseOk(searched);
      const hits = searchData.hits as Array<{ id: string; excerpt: string; current: boolean }>;
      assert.equal(hits.length, 1);
      assert.equal(hits[0].id, noteId);
      assert.equal(hits[0].current, true);
      assert.match(hits[0].excerpt, /20260907000002/);

      const got = spawnSync(
        process.execPath,
        [distBin, "note", "get", noteId, "--project", projectId, "--home", home, "--json"],
        { cwd: packageRoot, encoding: "utf-8", env: { ...process.env } },
      );
      const gotData = parseOk(got);
      assert.equal((gotData.note as { id: string }).id, noteId);

      const empty = spawnSync(
        process.execPath,
        [
          distBin,
          "search",
          "--query",
          "zzzxnotatokenintheindex",
          "--project",
          projectId,
          "--home",
          home,
          "--json",
        ],
        { cwd: packageRoot, encoding: "utf-8", env: { ...process.env } },
      );
      const emptyData = parseOk(empty);
      assert.deepEqual(emptyData.hits, []);
      assert.equal(emptyData.omittedCount, 0);

      const failed = spawnSync(
        process.execPath,
        [
          distBin,
          "search",
          "--query",
          "coupon",
          "--project",
          "99999999-9999-4999-8999-999999999999",
          "--home",
          home,
          "--json",
        ],
        { cwd: packageRoot, encoding: "utf-8", env: { ...process.env } },
      );
      assert.equal(failed.status, 3);
      const failedJson = JSON.parse(String(failed.stdout).trim().split("\n").at(-1) ?? "");
      assert.equal(failedJson.ok, false);
      assert.equal(failedJson.error.code, "NOT_FOUND");
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
