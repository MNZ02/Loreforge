import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  closeCore,
  execOk,
  initGitRepo,
  mutRequest,
  openTestCore,
  readRequest,
  regRequest,
  removeDir,
  type TestCore,
} from "../support/harness.js";
import { runLockHolder } from "../support/proc.js";
import type { Project, Task } from "../../src/core/contracts.js";

describe("lock contention (A23)", () => {
  it("returns bounded BUSY with no partial write, then succeeds on retry", async () => {
    const held: TestCore = openTestCore();
    const repo = initGitRepo();
    try {
      const data = await execOk<{ project: Project }>(
        held.core,
        regRequest("project.register", "setup", { root: repo, name: "P" }),
      );
      await execOk(held.core, regRequest("agent.register", "setup-muse", { id: "muse", displayName: "Muse" }));
      const created = await execOk<{ task: Task }>(
        held.core,
        mutRequest("task.create", data.project.id, "muse", "t-1", {
          title: "Locked task",
          description: "Claim me",
          dependsOn: [],
        }),
      );

      const holder = runLockHolder(held.home, 8000);
      await holder.ready;
      const started = Date.now();
      const blocked = await held.core.execute(
        mutRequest("task.claim", data.project.id, "muse", "claim-1", { taskId: created.task.id }),
      );
      const elapsed = Date.now() - started;
      assert.equal(blocked.ok, false);
      if (!blocked.ok) assert.equal(blocked.error.code, "BUSY");
      // Bounded: waits out the busy timeout instead of failing instantly or
      // spinning forever.
      assert.ok(elapsed >= 3000, `returned too fast (${elapsed}ms) to have waited`);
      assert.ok(elapsed < 30000, `took too long (${elapsed}ms); not bounded`);

      // No partial write and no receipt: the task is untouched.
      const untouched = await execOk<{ task: Task }>(
        held.core,
        readRequest("task.get", data.project.id, { taskId: created.task.id }),
      );
      assert.equal(untouched.task.status, "open");
      assert.equal(untouched.task.ownerId, null);
      assert.equal(untouched.task.attempt, 0);

      // After the holder commits, the exact retry succeeds.
      assert.equal(await holder.done, 0);
      const retry = await execOk<{ task: Task; claimToken: string }>(
        held.core,
        mutRequest("task.claim", data.project.id, "muse", "claim-1", { taskId: created.task.id }),
      );
      assert.equal(retry.task.attempt, 1);
      assert.equal(retry.task.ownerId, "muse");
    } finally {
      removeDir(repo);
      closeCore(held.core);
      removeDir(held.home);
    }
  });
});
