import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { LEASE_MS } from "../../src/core/operations/claims.js";
import {
  closeCore,
  execErr,
  execOk,
  gitHead,
  initGitRepo,
  mutRequest,
  openTestCore,
  readRequest,
  regRequest,
  removeDir,
  tempDir,
  type TestCore,
} from "../support/harness.js";
import { runCoreChild, runLockHolder } from "../support/proc.js";
import type { Project, Task } from "../../src/core/contracts.js";

interface Env {
  held: TestCore;
  repo: string;
  project: Project;
  cleanup: () => void;
}

async function setup(): Promise<Env> {
  const held: TestCore = openTestCore();
  const repo = initGitRepo();
  const data = await execOk<{ project: Project }>(
    held.core,
    regRequest("project.register", "setup", { root: repo, name: "P" }),
  );
  await execOk(held.core, regRequest("agent.register", "setup-muse", { id: "muse", displayName: "Muse" }));
  await execOk(held.core, regRequest("agent.register", "setup-flash", { id: "flash", displayName: "Flash" }));
  return {
    held,
    repo,
    project: data.project,
    cleanup: () => {
      removeDir(repo);
      closeCore(held.core);
      removeDir(held.home);
    },
  };
}

interface ClockEnv extends Env {
  advance: (ms: number) => void;
  nowMs: () => number;
}

async function setupClocked(): Promise<ClockEnv> {
  let current = 1_700_000_000_000;
  const held: TestCore = openTestCore(undefined, () => current);
  const repo = initGitRepo();
  const data = await execOk<{ project: Project }>(
    held.core,
    regRequest("project.register", "setup", { root: repo, name: "P" }),
  );
  await execOk(held.core, regRequest("agent.register", "setup-muse", { id: "muse", displayName: "Muse" }));
  await execOk(held.core, regRequest("agent.register", "setup-flash", { id: "flash", displayName: "Flash" }));
  return {
    held,
    repo,
    project: data.project,
    advance: (ms: number) => {
      current += ms;
    },
    nowMs: () => current,
    cleanup: () => {
      removeDir(repo);
      closeCore(held.core);
      removeDir(held.home);
    },
  };
}

async function createTask(env: Env, requestId: string, dependsOn: string[] = []): Promise<Task> {
  const data = await execOk<{ task: Task }>(
    env.held.core,
    mutRequest("task.create", env.project.id, "muse", requestId, {
      title: `Task ${requestId}`,
      description: "Claim me",
      dependsOn,
    }),
  );
  return data.task;
}

function claimRequest(projectId: string, actor: string, requestId: string, taskId: string): unknown {
  return mutRequest("task.claim", projectId, actor, requestId, { taskId });
}

async function getTask(env: Env, taskId: string): Promise<Task> {
  const data = await execOk<{ task: Task }>(
    env.held.core,
    readRequest("task.get", env.project.id, { taskId }),
  );
  return data.task;
}

describe("competing claims (A04)", () => {
  it("two processes claiming at once produce exactly one owner", async () => {
    const env = await setup();
    try {
      const task = await createTask(env, "t-1");
      const home = env.held.home;
      const gate = join(tempDir("company-gate-"), "gate");
      const pendingA = runCoreChild(home, claimRequest(env.project.id, "muse", "claim-a", task.id), {
        gate,
      });
      const pendingB = runCoreChild(home, claimRequest(env.project.id, "flash", "claim-b", task.id), {
        gate,
      });
      await new Promise((resolve) => setTimeout(resolve, 5000));
      writeFileSync(gate, "go\n");
      const [resultA, resultB] = await Promise.all([pendingA, pendingB]);
      assert.equal(resultA.exitCode, 0, resultA.stderr);
      assert.equal(resultB.exitCode, 0, resultB.stderr);
      const responses = [resultA.response, resultB.response];
      const wins = responses.filter((r) => r?.ok === true);
      const losses = responses.filter((r) => r?.ok === false);
      assert.equal(wins.length, 1);
      assert.equal(losses.length, 1);
      assert.equal(
        (losses[0] as Extract<NonNullable<typeof losses[0]>, { ok: false }>).error.code,
        "CONFLICT",
      );
      const winner = wins[0] as Extract<NonNullable<typeof wins[0]>, { ok: true }>;
      const winnerData = winner.data as { task: Task; claimToken: string };
      assert.equal(typeof winnerData.claimToken, "string");

      const stored = await getTask(env, task.id);
      assert.equal(stored.attempt, 1);
      assert.equal(stored.status, "running");
      assert.equal(stored.ownerId, winnerData.task.ownerId);
      assert.ok(!("claimToken" in stored));

      // Exact replay of the winning claim returns its original token.
      const winnerActor = winnerData.task.ownerId as string;
      const winnerReq = winnerActor === "muse" ? "claim-a" : "claim-b";
      const replay = await execOk<{ task: Task; claimToken: string }>(
        env.held.core,
        claimRequest(env.project.id, winnerActor, winnerReq, task.id),
      );
      assert.equal(replay.claimToken, winnerData.claimToken);
    } finally {
      env.cleanup();
    }
  });
});

describe("concurrent identical retries (A07 race)", () => {
  it("two processes replaying one key get the identical original result", async () => {
    const env = await setup();
    try {
      const task = await createTask(env, "t-dup");
      const envelope = claimRequest(env.project.id, "muse", "claim-dup", task.id);
      const gate = join(tempDir("company-gate-"), "gate");
      const pendingA = runCoreChild(env.held.home, envelope, { gate });
      const pendingB = runCoreChild(env.held.home, envelope, { gate });
      await new Promise((resolve) => setTimeout(resolve, 5000));
      writeFileSync(gate, "go\n");
      const [resultA, resultB] = await Promise.all([pendingA, pendingB]);
      assert.equal(resultA.exitCode, 0, resultA.stderr);
      assert.equal(resultB.exitCode, 0, resultB.stderr);
      assert.ok(resultA.response?.ok, JSON.stringify(resultA.response));
      assert.deepEqual(resultB.response, resultA.response);
      const stored = await getTask(env, task.id);
      assert.equal(stored.attempt, 1);
      assert.equal(stored.ownerId, "muse");
    } finally {
      env.cleanup();
    }
  });
});

describe("lease expiry and attempts (A05 lease parts)", () => {
  it("expires at exactly 2h: old token dies, reclaim increments attempt", async () => {
    const env = await setupClocked();
    try {
      const task = await createTask(env, "t-1");
      const claimed = await execOk<{ task: Task; claimToken: string }>(
        env.held.core,
        claimRequest(env.project.id, "muse", "claim-1", task.id),
      );
      assert.equal(
        claimed.task.leaseUntil,
        new Date(env.nowMs() + LEASE_MS).toISOString(),
      );

      env.advance(LEASE_MS);
      const renewAtExpiry = await execErr(
        env.held.core,
        mutRequest("task.renew", env.project.id, "muse", "renew-1", {
          taskId: task.id,
          claimToken: claimed.claimToken,
        }),
      );
      assert.equal(renewAtExpiry.code, "STALE_CLAIM");
      const releaseAtExpiry = await execErr(
        env.held.core,
        mutRequest("task.release", env.project.id, "muse", "release-1", {
          taskId: task.id,
          claimToken: claimed.claimToken,
        }),
      );
      assert.equal(releaseAtExpiry.code, "STALE_CLAIM");

      const reclaimed = await execOk<{ task: Task; claimToken: string }>(
        env.held.core,
        claimRequest(env.project.id, "flash", "claim-2", task.id),
      );
      assert.equal(reclaimed.task.attempt, 2);
      assert.equal(reclaimed.task.ownerId, "flash");
      assert.notEqual(reclaimed.claimToken, claimed.claimToken);

      // Old owner and wrong tokens cannot touch the reclaimed task.
      for (const [actor, token, req] of [
        ["muse", claimed.claimToken, "late-1"],
        ["flash", "wrong-token", "late-2"],
        ["muse", reclaimed.claimToken, "late-3"],
      ] as const) {
        const stale = await execErr(
          env.held.core,
          mutRequest("task.renew", env.project.id, actor, req, {
            taskId: task.id,
            claimToken: token,
          }),
        );
        assert.equal(stale.code, "STALE_CLAIM", req);
      }
    } finally {
      env.cleanup();
    }
  });
});

describe("renew, release, and dependency gating (A06 core parts)", () => {
  it("renews before expiry, releases cleanly, and reclaims with a new attempt", async () => {
    const env = await setupClocked();
    try {
      const task = await createTask(env, "t-1");
      const claimed = await execOk<{ task: Task; claimToken: string }>(
        env.held.core,
        claimRequest(env.project.id, "muse", "claim-1", task.id),
      );
      env.advance(60 * 60 * 1000);
      const renewed = await execOk<{ task: Task }>(
        env.held.core,
        mutRequest("task.renew", env.project.id, "muse", "renew-1", {
          taskId: task.id,
          claimToken: claimed.claimToken,
        }),
      );
      assert.equal(renewed.task.leaseUntil, new Date(env.nowMs() + LEASE_MS).toISOString());
      assert.equal(renewed.task.attempt, 1);

      const released = await execOk<{ task: Task }>(
        env.held.core,
        mutRequest("task.release", env.project.id, "muse", "release-1", {
          taskId: task.id,
          claimToken: claimed.claimToken,
        }),
      );
      assert.equal(released.task.status, "open");
      assert.equal(released.task.ownerId, null);
      assert.equal(released.task.leaseUntil, null);
      assert.equal(released.task.attempt, 1);

      // Released token is dead; the next claim starts a new attempt.
      const dead = await execErr(
        env.held.core,
        mutRequest("task.renew", env.project.id, "muse", "renew-2", {
          taskId: task.id,
          claimToken: claimed.claimToken,
        }),
      );
      assert.equal(dead.code, "STALE_CLAIM");
      const next = await execOk<{ task: Task; claimToken: string }>(
        env.held.core,
        claimRequest(env.project.id, "flash", "claim-2", task.id),
      );
      assert.equal(next.task.attempt, 2);
    } finally {
      env.cleanup();
    }
  });

  it("blocks claims until dependencies complete and rejects live double claims", async () => {
    const env = await setupClocked();
    try {
      const first = await createTask(env, "t-1");
      const second = await createTask(env, "t-2", [first.id]);
      const blocked = await execErr(
        env.held.core,
        claimRequest(env.project.id, "muse", "claim-b", second.id),
      );
      assert.equal(blocked.code, "CONFLICT");

      await execOk(env.held.core, claimRequest(env.project.id, "muse", "claim-a", first.id));
      // Same owner with a new key on a live task is still CONFLICT.
      const double = await execErr(
        env.held.core,
        claimRequest(env.project.id, "muse", "claim-a2", first.id),
      );
      assert.equal(double.code, "CONFLICT");
    } finally {
      env.cleanup();
    }
  });
});

describe("cancellation states", () => {
  it("cancels open and running tasks, clears claims, and rejects terminal recancel", async () => {
    const env = await setupClocked();
    try {
      const open = await createTask(env, "t-open");
      const cancelled = await execOk<{ task: Task }>(
        env.held.core,
        mutRequest("task.cancel", env.project.id, "flash", "cancel-1", { taskId: open.id }),
      );
      assert.equal(cancelled.task.status, "cancelled");

      const recancel = await execErr(
        env.held.core,
        mutRequest("task.cancel", env.project.id, "flash", "cancel-2", { taskId: open.id }),
      );
      assert.equal(recancel.code, "CONFLICT");
      // Exact retry of the recorded cancellation replays success.
      const retry = await execOk<{ task: Task }>(
        env.held.core,
        mutRequest("task.cancel", env.project.id, "flash", "cancel-1", { taskId: open.id }),
      );
      assert.equal(retry.task.status, "cancelled");

      const claimed = await createTask(env, "t-run");
      const lease = await execOk<{ task: Task; claimToken: string }>(
        env.held.core,
        claimRequest(env.project.id, "muse", "claim-1", claimed.id),
      );
      const killed = await execOk<{ task: Task }>(
        env.held.core,
        mutRequest("task.cancel", env.project.id, "flash", "cancel-3", { taskId: claimed.id }),
      );
      assert.equal(killed.task.status, "cancelled");
      assert.equal(killed.task.ownerId, null);
      const orphan = await execErr(
        env.held.core,
        mutRequest("task.renew", env.project.id, "muse", "renew-1", {
          taskId: claimed.id,
          claimToken: lease.claimToken,
        }),
      );
      assert.equal(orphan.code, "STALE_CLAIM");

      const claimDead = await execErr(
        env.held.core,
        claimRequest(env.project.id, "muse", "claim-2", claimed.id),
      );
      assert.equal(claimDead.code, "CONFLICT");
    } finally {
      env.cleanup();
    }
  });
});

describe("lease judgments use acquisition time (CODEX-002)", () => {
  // Wall-moving clock: the test advances it with an offset so a real
  // cross-process lock wait can straddle the recorded expiry.
  async function setupWallClock(): Promise<ClockEnv & { setOffset: (ms: number) => void }> {
    let offset = 0;
    const base = await setupClocked();
    closeCore(base.held.core);
    const held: TestCore = openTestCore(base.held.home, () => Date.now() + offset);
    return {
      ...base,
      held,
      setOffset: (ms: number) => {
        offset = ms;
      },
    };
  }

  function handoffSubmit(
    projectId: string,
    taskId: string,
    claimToken: string,
    requestId: string,
    repo: string,
  ): unknown {
    return mutRequest("handoff.submit", projectId, "muse", requestId, {
      taskId,
      claimToken,
      outcome: "completed",
      summary: "Done after waiting",
      evidence: { checkoutRoot: repo, head: gitHead(repo), dirty: false, files: [], checks: [] },
      unresolved: [],
      nextSteps: [],
      blockingQuestionIds: [],
    });
  }

  it("renew, release, and handoff that wait behind a lock across expiry are STALE with no effects", async () => {
    const env = await setupWallClock();
    try {
      const task = await createTask(env, "t-stale");
      // Claim with ~2s of lease left: every operation below is dispatched
      // live but acquires the write lock after expiry.
      env.setOffset(-LEASE_MS + 2000);
      const claimed = await execOk<{ task: Task; claimToken: string }>(
        env.held.core,
        claimRequest(env.project.id, "muse", "claim-stale", task.id),
      );
      const liveUntil = claimed.task.leaseUntil;
      env.setOffset(0);

      const renewOp = mutRequest("task.renew", env.project.id, "muse", "renew-stale", {
        taskId: task.id,
        claimToken: claimed.claimToken,
      });
      const releaseOp = mutRequest("task.release", env.project.id, "muse", "release-stale", {
        taskId: task.id,
        claimToken: claimed.claimToken,
      });
      const handoffOp = handoffSubmit(env.project.id, task.id, claimed.claimToken, "handoff-stale", env.repo);

      for (const [name, op] of [
        ["renew", renewOp],
        ["release", releaseOp],
        ["handoff", handoffOp],
      ] as const) {
        const holder = runLockHolder(env.held.home, 3000);
        await holder.ready;
        const started = Date.now();
        const response = await env.held.core.execute(op);
        const elapsed = Date.now() - started;
        assert.equal(await holder.done, 0);
        assert.ok(elapsed >= 1500, `${name} returned in ${elapsed}ms without waiting behind the lock`);
        assert.equal(response.ok, false, `${name} must not succeed after expiry`);
        if (!response.ok) assert.equal(response.error.code, "STALE_CLAIM", name);
      }

      // No effects from any of the three attempts.
      const stored = await getTask(env, task.id);
      assert.equal(stored.status, "running");
      assert.equal(stored.ownerId, "muse");
      assert.equal(stored.attempt, 1);
      assert.equal(stored.leaseUntil, liveUntil);
    } finally {
      env.cleanup();
    }
  });

  it("a claim granted after a lock wait starts its full lease at acquisition", async () => {
    const env = await setup();
    try {
      const task = await createTask(env, "t-wait");
      const holder = runLockHolder(env.held.home, 3000);
      await holder.ready;
      const began = Date.now();
      const claimed = await execOk<{ task: Task; claimToken: string }>(
        env.held.core,
        claimRequest(env.project.id, "muse", "claim-wait", task.id),
      );
      assert.equal(await holder.done, 0);
      assert.ok(claimed.task.leaseUntil !== null);
      const acquiredAt = Date.parse(claimed.task.leaseUntil as string) - LEASE_MS;
      assert.ok(
        acquiredAt - began >= 1500,
        `lease starts at dispatch, not acquisition (offset ${acquiredAt - began}ms)`,
      );
      assert.ok(acquiredAt - began < 15000, "lease start is unbounded");
      assert.equal(claimed.task.attempt, 1);
    } finally {
      env.cleanup();
    }
  });

  it("an exact retry of a recorded renew replays after expiry without renewing ownership", async () => {
    const env = await setupClocked();
    try {
      const task = await createTask(env, "t-replay");
      const claimed = await execOk<{ task: Task; claimToken: string }>(
        env.held.core,
        claimRequest(env.project.id, "muse", "claim-replay", task.id),
      );
      const renewed = await execOk<{ task: Task }>(
        env.held.core,
        mutRequest("task.renew", env.project.id, "muse", "renew-replay", {
          taskId: task.id,
          claimToken: claimed.claimToken,
        }),
      );
      const recordedLease = renewed.task.leaseUntil;
      env.advance(LEASE_MS + 1000);
      const replay = await execOk<{ task: Task }>(
        env.held.core,
        mutRequest("task.renew", env.project.id, "muse", "renew-replay", {
          taskId: task.id,
          claimToken: claimed.claimToken,
        }),
      );
      assert.equal(replay.task.leaseUntil, recordedLease);
      const stored = await getTask(env, task.id);
      assert.equal(stored.ownerId, "muse");
      assert.equal(stored.leaseUntil, recordedLease);
    } finally {
      env.cleanup();
    }
  });
});
