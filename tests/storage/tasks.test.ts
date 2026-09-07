import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  closeCore,
  execErr,
  execOk,
  initGitRepo,
  mutRequest,
  openTestCore,
  readRequest,
  regRequest,
  removeDir,
  type TestCore,
} from "../support/harness.js";
import type { Project, Task } from "../../src/core/contracts.js";

const UNKNOWN_ID = "99999999-9999-4999-8999-999999999999";

async function setupTwoProjects(): Promise<{
  held: TestCore;
  repoA: string;
  repoB: string;
  projectA: Project;
  projectB: Project;
}> {
  const held: TestCore = openTestCore();
  const repoA = initGitRepo();
  const repoB = initGitRepo();
  const dataA = await execOk<{ project: Project }>(
    held.core,
    regRequest("project.register", "setup-a", { root: repoA, name: "A" }),
  );
  const dataB = await execOk<{ project: Project }>(
    held.core,
    regRequest("project.register", "setup-b", { root: repoB, name: "B" }),
  );
  await execOk(held.core, regRequest("agent.register", "setup-muse", { id: "muse", displayName: "Muse" }));
  await execOk(held.core, regRequest("agent.register", "setup-flash", { id: "flash", displayName: "Flash" }));
  return { held, repoA, repoB, projectA: dataA.project, projectB: dataB.project };
}

async function teardown(input: Awaited<ReturnType<typeof setupTwoProjects>>): Promise<void> {
  removeDir(input.repoA);
  removeDir(input.repoB);
  closeCore(input.held.core);
  removeDir(input.held.home);
}

function createTask(projectId: string, requestId: string, dependsOn: string[] = []): unknown {
  return mutRequest("task.create", projectId, "muse", requestId, {
    title: `Task ${requestId}`,
    description: "Do the thing",
    dependsOn,
  });
}

describe("tasks and project isolation (A03)", () => {
  it("creates, gets, and lists tasks within one project", async () => {
    const env = await setupTwoProjects();
    try {
      const created = await execOk<{ task: Task }>(
        env.held.core,
        createTask(env.projectA.id, "t-1"),
      );
      assert.equal(created.task.status, "open");
      assert.equal(created.task.attempt, 0);
      assert.equal(created.task.ownerId, null);
      assert.equal(created.task.leaseUntil, null);
      assert.ok(!("claimToken" in created.task));
      assert.deepEqual(created.task.dependsOn, []);

      const fetched = await execOk<{ task: Task }>(
        env.held.core,
        readRequest("task.get", env.projectA.id, { taskId: created.task.id }),
      );
      assert.deepEqual(fetched.task, created.task);

      const listed = await execOk<{ tasks: Task[]; omittedCount: number }>(
        env.held.core,
        readRequest("task.list", env.projectA.id, {}),
      );
      assert.equal(listed.tasks.length, 1);
      assert.equal(listed.omittedCount, 0);
      assert.ok(!("claimToken" in listed.tasks[0]));

      const filtered = await execOk<{ tasks: Task[]; omittedCount: number }>(
        env.held.core,
        readRequest("task.list", env.projectA.id, { status: "running" }),
      );
      assert.equal(filtered.tasks.length, 0);
      assert.equal(filtered.omittedCount, 0);
    } finally {
      await teardown(env);
    }
  });

  it("links dependencies and pages list output with omitted counts", async () => {
    const env = await setupTwoProjects();
    try {
      const first = await execOk<{ task: Task }>(env.held.core, createTask(env.projectA.id, "t-1"));
      const second = await execOk<{ task: Task }>(
        env.held.core,
        createTask(env.projectA.id, "t-2", [first.task.id]),
      );
      assert.deepEqual(second.task.dependsOn, [first.task.id]);

      const page = await execOk<{ tasks: Task[]; omittedCount: number }>(
        env.held.core,
        readRequest("task.list", env.projectA.id, { limit: 1 }),
      );
      assert.equal(page.tasks.length, 1);
      assert.equal(page.omittedCount, 1);

      // Newest-created first with ID ascending tie-break, verified as a
      // property so same-millisecond creates cannot flake.
      const all = await execOk<{ tasks: Task[]; omittedCount: number }>(
        env.held.core,
        readRequest("task.list", env.projectA.id, {}),
      );
      assert.equal(all.tasks.length, 2);
      assert.equal(all.omittedCount, 0);
      const [newer, older] = all.tasks;
      assert.ok(newer.createdAt >= older.createdAt);
      if (newer.createdAt === older.createdAt) {
        assert.ok(newer.id < older.id);
      } else {
        assert.equal(newer.id, second.task.id);
      }

      const missing = await execErr(
        env.held.core,
        createTask(env.projectA.id, "t-3", [UNKNOWN_ID]),
      );
      assert.equal(missing.code, "NOT_FOUND");
    } finally {
      await teardown(env);
    }
  });

  it("reveals nothing across projects", async () => {
    const env = await setupTwoProjects();
    try {
      const created = await execOk<{ task: Task }>(
        env.held.core,
        createTask(env.projectA.id, "t-1"),
      );
      const wrongGet = await execErr(
        env.held.core,
        readRequest("task.get", env.projectB.id, { taskId: created.task.id }),
      );
      assert.equal(wrongGet.code, "NOT_FOUND");
      assert.ok(!JSON.stringify(wrongGet).includes(created.task.title));

      const wrongCreate = await execErr(
        env.held.core,
        createTask(env.projectB.id, "t-2", [created.task.id]),
      );
      assert.equal(wrongCreate.code, "NOT_FOUND");

      const emptyList = await execOk<{ tasks: Task[]; omittedCount: number }>(
        env.held.core,
        readRequest("task.list", env.projectB.id, {}),
      );
      assert.deepEqual(emptyList.tasks, []);
      assert.equal(emptyList.omittedCount, 0);

      const unknownProject = await execErr(
        env.held.core,
        readRequest("task.get", UNKNOWN_ID, { taskId: created.task.id }),
      );
      assert.equal(unknownProject.code, "NOT_FOUND");

      const unknownActor = await execErr(
        env.held.core,
        mutRequest("task.create", env.projectA.id, "ghost", "t-9", {
          title: "Ghost task",
          description: "No such agent",
          dependsOn: [],
        }),
      );
      assert.equal(unknownActor.code, "NOT_FOUND");
    } finally {
      await teardown(env);
    }
  });
});

describe("request receipts (A07 basics)", () => {
  it("replays identical retries and conflicts on changed payloads", async () => {
    const env = await setupTwoProjects();
    try {
      const first = await execOk<{ task: Task }>(
        env.held.core,
        createTask(env.projectA.id, "t-1"),
      );
      const replay = await execOk<{ task: Task }>(
        env.held.core,
        createTask(env.projectA.id, "t-1"),
      );
      assert.deepEqual(replay, first);

      const changedPayload = await execErr(
        env.held.core,
        mutRequest("task.create", env.projectA.id, "muse", "t-1", {
          title: "Different title",
          description: "Do the thing",
          dependsOn: [],
        }),
      );
      assert.equal(changedPayload.code, "CONFLICT");

      const changedOperation = await execErr(
        env.held.core,
        mutRequest("task.cancel", env.projectA.id, "muse", "t-1", { taskId: first.task.id }),
      );
      assert.equal(changedOperation.code, "CONFLICT");

      // The conflicted key never created a second task.
      const listed = await execOk<{ tasks: Task[]; omittedCount: number }>(
        env.held.core,
        readRequest("task.list", env.projectA.id, {}),
      );
      assert.equal(listed.tasks.length, 1);
    } finally {
      await teardown(env);
    }
  });

  it("scopes identical keys independently by actor and project", async () => {
    const env = await setupTwoProjects();
    try {
      const byMuse = await execOk<{ task: Task }>(
        env.held.core,
        createTask(env.projectA.id, "shared-key"),
      );
      const byFlash = await execOk<{ task: Task }>(
        env.held.core,
        mutRequest("task.create", env.projectA.id, "flash", "shared-key", {
          title: "Task shared-key",
          description: "Do the thing",
          dependsOn: [],
        }),
      );
      assert.notEqual(byFlash.task.id, byMuse.task.id);
      const byProject = await execOk<{ task: Task }>(
        env.held.core,
        createTask(env.projectB.id, "shared-key"),
      );
      assert.notEqual(byProject.task.id, byMuse.task.id);
    } finally {
      await teardown(env);
    }
  });

  it("does not cache failed requests", async () => {
    const env = await setupTwoProjects();
    try {
      const failed = await execErr(env.held.core, createTask(env.projectA.id, "t-1", [UNKNOWN_ID]));
      assert.equal(failed.code, "NOT_FOUND");
      // The same key with a fixed payload succeeds: the failure left no receipt.
      const fixed = await execOk<{ task: Task }>(
        env.held.core,
        createTask(env.projectA.id, "t-1"),
      );
      assert.equal(fixed.task.title, "Task t-1");
    } finally {
      await teardown(env);
    }
  });
});
