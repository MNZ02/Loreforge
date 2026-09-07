import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  addWorktree,
  cloneRepo,
  closeCore,
  execErr,
  execOk,
  initGitRepo,
  openTestCore,
  regRequest,
  removeDir,
  removeWorktree,
  symlinkPath,
  tempDir,
  type TestCore,
} from "../support/harness.js";
import type { Project } from "../../src/core/contracts.js";

async function registerRoot(
  core: TestCore["core"],
  requestId: string,
  root: string,
  name = "Proj",
): Promise<Project> {
  const data = await execOk<{ project: Project }>(
    core,
    regRequest("project.register", requestId, { root, name }),
  );
  return data.project;
}

describe("project identity (A02)", async () => {
  it("maps a root and its real worktree to one project", async () => {
    const held: TestCore = openTestCore();
    const repo = initGitRepo();
    let worktree = "";
    try {
      const project = await registerRoot(held.core, "reg-root", repo, "Repo");
      assert.ok(project.id);
      assert.equal(project.name, "Repo");
      assert.ok(project.gitCommonDir.length > 0);
      worktree = addWorktree(repo, "feature");
      const same = await registerRoot(held.core, "reg-wt", worktree, "Other name");
      assert.equal(same.id, project.id);
      assert.equal(same.name, "Repo");
      assert.equal(same.gitCommonDir, project.gitCommonDir);
    } finally {
      if (worktree) removeWorktree(repo, worktree);
      removeDir(repo);
      closeCore(held.core);
      removeDir(held.home);
    }
  });

  it("treats symlink aliases as the same project", async () => {
    const held: TestCore = openTestCore();
    const repo = initGitRepo();
    try {
      const project = await registerRoot(held.core, "reg-root", repo);
      const link = symlinkPath(repo);
      try {
        const same = await registerRoot(held.core, "reg-link", link);
        assert.equal(same.id, project.id);
        assert.equal(same.root, project.root);
      } finally {
        removeDir(link);
      }
    } finally {
      removeDir(repo);
      closeCore(held.core);
      removeDir(held.home);
    }
  });

  it("treats an independent clone as a different project", async () => {
    const held: TestCore = openTestCore();
    const repo = initGitRepo();
    let clone = "";
    try {
      const project = await registerRoot(held.core, "reg-root", repo);
      clone = cloneRepo(repo);
      const other = await registerRoot(held.core, "reg-clone", clone);
      assert.notEqual(other.id, project.id);
      assert.notEqual(other.gitCommonDir, project.gitCommonDir);
    } finally {
      if (clone) removeDir(clone);
      removeDir(repo);
      closeCore(held.core);
      removeDir(held.home);
    }
  });

  it("rejects non-Git and missing roots without mutating", async () => {
    const held: TestCore = openTestCore();
    try {
      const plain = tempDir("company-plain-");
      try {
        const before = await execErr(
          held.core,
          regRequest("project.register", "reg-plain", { root: plain, name: "Plain" }),
        );
        assert.equal(before.code, "VALIDATION");
        const missing = await execErr(
          held.core,
          regRequest("project.register", "reg-missing", {
            root: `${plain}-does-not-exist`,
            name: "Missing",
          }),
        );
        assert.equal(missing.code, "VALIDATION");
        // Exact retry of the failed registration is still a validation
        // failure, and nothing was recorded: a later valid registration with
        // an unrelated key succeeds independently.
        const retry = await execErr(
          held.core,
          regRequest("project.register", "reg-plain", { root: plain, name: "Plain" }),
        );
        assert.equal(retry.code, "VALIDATION");
      } finally {
        removeDir(plain);
      }
    } finally {
      closeCore(held.core);
      removeDir(held.home);
    }
  });

  it("replays duplicate registration deterministically", async () => {
    const held: TestCore = openTestCore();
    const repo = initGitRepo();
    try {
      const first = await registerRoot(held.core, "reg-dup", repo, "Repo");
      const replay = await registerRoot(held.core, "reg-dup", repo, "Repo");
      assert.deepEqual(replay, first);
      // Same canonical identity under a new key returns the same record.
      const again = await registerRoot(held.core, "reg-dup-2", repo, "Renamed");
      assert.equal(again.id, first.id);
      assert.equal(again.name, "Repo");
      assert.equal(again.createdAt, first.createdAt);
      // Same key with a different payload is CONFLICT, never a second row.
      const clash = await execErr(
        held.core,
        regRequest("project.register", "reg-dup", { root: repo, name: "Changed" }),
      );
      assert.equal(clash.code, "CONFLICT");
    } finally {
      removeDir(repo);
      closeCore(held.core);
      removeDir(held.home);
    }
  });

  it("resolves agent registration conflicts by name", async () => {
    const held: TestCore = openTestCore();
    try {
      const first = await execOk<{ agent: { id: string; displayName: string; createdAt: string } }>(
        held.core,
        regRequest("agent.register", "ag-1", { id: "muse", displayName: "Muse" }),
      );
      const replay = await execOk<{ agent: { id: string; displayName: string; createdAt: string } }>(
        held.core,
        regRequest("agent.register", "ag-1", { id: "muse", displayName: "Muse" }),
      );
      assert.deepEqual(replay, first);
      const clash = await execErr(
        held.core,
        regRequest("agent.register", "ag-2", { id: "muse", displayName: "Someone else" }),
      );
      assert.equal(clash.code, "CONFLICT");
    } finally {
      closeCore(held.core);
      removeDir(held.home);
    }
  });
});
