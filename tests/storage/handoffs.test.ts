import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { setFaultInjector } from "../../src/storage/faults.js";
import {
  addWorktree,
  cloneRepo,
  closeCore,
  execErr,
  execOk,
  gitCommitFile,
  gitDirty,
  gitHead,
  initGitRepo,
  mutRequest,
  openTestCore,
  readRequest,
  regRequest,
  removeDir,
  removeWorktree,
  tempDir,
  type TestCore,
} from "../support/harness.js";
import { runCoreChild } from "../support/proc.js";
import { observeCheckout } from "../../src/evidence/git.js";
import type { ContextSnapshot, Handoff, Project, Task } from "../../src/core/contracts.js";

interface Env {
  held: TestCore;
  repo: string;
  project: Project;
  cleanup: () => void;
}

async function setup(now?: () => number): Promise<Env> {
  const held: TestCore = openTestCore(undefined, now);
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
      try {
        closeCore(held.core);
      } catch {
        // Cleanup best-effort.
      }
      removeDir(held.home);
    },
  };
}

async function createAndClaim(
  env: Env,
  requestId: string,
  actor = "muse",
): Promise<{ task: Task; claimToken: string }> {
  const created = await execOk<{ task: Task }>(
    env.held.core,
    mutRequest("task.create", env.project.id, actor, `create-${requestId}`, {
      title: `Task ${requestId}`,
      description: "Complete me",
      dependsOn: [],
    }),
  );
  return execOk<{ task: Task; claimToken: string }>(
    env.held.core,
    mutRequest("task.claim", env.project.id, actor, `claim-${requestId}`, {
      taskId: created.task.id,
    }),
  );
}

function submitRequest(
  projectId: string,
  actor: string,
  requestId: string,
  taskId: string,
  claimToken: string,
  checkoutRoot: string,
  head: string,
  dirty: boolean,
  extra?: Record<string, unknown>,
): unknown {
  return mutRequest("handoff.submit", projectId, actor, requestId, {
    taskId,
    claimToken,
    outcome: "completed",
    summary: "All done",
    evidence: {
      checkoutRoot,
      head,
      dirty,
      files: [{ path: "src/a.ts", change: "modified" }],
      checks: [{ command: "npm run test:core", outcome: "passed", summary: "green" }],
    },
    unresolved: [],
    nextSteps: [],
    blockingQuestionIds: [],
    ...extra,
  });
}

function countRows(home: string, table: string, taskId: string): number {
  const db = new DatabaseSync(join(home, "loreforge.sqlite3"));
  try {
    const row = db
      .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE task_id = ?`)
      .get(taskId) as { n: number };
    return row.n;
  } finally {
    db.close();
  }
}

function hasReceipt(home: string, requestId: string): boolean {
  const db = new DatabaseSync(join(home, "loreforge.sqlite3"));
  try {
    const row = db
      .prepare("SELECT request_id FROM mutation_receipts WHERE request_id = ?")
      .get(requestId) as { request_id: string } | undefined;
    return row !== undefined;
  } finally {
    db.close();
  }
}

describe("completed handoffs (A08)", () => {
  it("commits task, handoff, and receipt atomically", async () => {
    const env = await setup();
    try {
      const { task, claimToken } = await createAndClaim(env, "a08");
      const submitted = await execOk<{ task: Task; handoff: Handoff }>(
        env.held.core,
        submitRequest(env.project.id, "muse", "submit-1", task.id, claimToken, env.repo, gitHead(env.repo), false),
      );
      assert.equal(submitted.task.status, "completed");
      assert.equal(submitted.task.ownerId, null);
      assert.equal(submitted.handoff.attempt, 1);
      assert.equal(submitted.handoff.taskId, task.id);
      assert.equal(submitted.handoff.actorId, "muse");
      assert.equal(submitted.handoff.outcome, "completed");
      assert.equal(submitted.handoff.evidenceSource, "agent_reported");
      assert.equal(submitted.handoff.observed.head, gitHead(env.repo));
      assert.equal(submitted.handoff.observed.dirty, false);
      assert.ok(!("claimToken" in submitted.handoff));
      // Exact retry replays the identical response exactly once.
      const replay = await execOk<{ task: Task; handoff: Handoff }>(
        env.held.core,
        submitRequest(env.project.id, "muse", "submit-1", task.id, claimToken, env.repo, gitHead(env.repo), false),
      );
      assert.deepEqual(replay, submitted);
      assert.equal(countRows(env.held.home, "handoffs", task.id), 1);
    } finally {
      env.cleanup();
    }
  });

  it("rolls back every effect when a write boundary fails, verified by reopen", async () => {
    for (const boundary of ["handoff.task", "handoff.row", "handoff.receipt"]) {
      const env = await setup();
      try {
        const { task, claimToken } = await createAndClaim(env, `a08f-${boundary}`);
        const envelope = submitRequest(
          env.project.id,
          "muse",
          "submit-fault",
          task.id,
          claimToken,
          env.repo,
          gitHead(env.repo),
          false,
        );
        setFaultInjector((hit) => {
          if (hit === boundary) throw new Error(`injected fault at ${hit}`);
        });
        let code = "";
        try {
          const response = await env.held.core.execute(envelope);
          assert.equal(response.ok, false);
          if (!response.ok) code = response.error.code;
        } finally {
          setFaultInjector(null);
        }
        assert.equal(code, "INTERNAL");
        // Verify by reopening the DB, not by inspecting memory.
        closeCore(env.held.core);
        const reopened: TestCore = openTestCore(env.held.home);
        try {
          const stored = await execOk<{ task: Task }>(
            reopened.core,
            readRequest("task.get", env.project.id, { taskId: task.id }),
          );
          assert.equal(stored.task.status, "running");
          assert.equal(stored.task.attempt, 1);
          assert.equal(stored.task.ownerId, "muse");
          assert.equal(countRows(env.held.home, "handoffs", task.id), 0);
          assert.equal(hasReceipt(env.held.home, "submit-fault"), false);
          // The same key retries cleanly and succeeds exactly once.
          const retry = await execOk<{ task: Task; handoff: Handoff }>(reopened.core, envelope);
          assert.equal(retry.task.status, "completed");
          assert.equal(countRows(env.held.home, "handoffs", task.id), 1);
        } finally {
          closeCore(reopened.core);
        }
      } finally {
        env.cleanup();
      }
    }
  });
});

describe("handoff retries without the checkout (A09)", () => {
  it("replays after the checkout is removed", async () => {
    const env = await setup();
    try {
      const { task, claimToken } = await createAndClaim(env, "a09");
      const envelope = submitRequest(
        env.project.id,
        "muse",
        "submit-1",
        task.id,
        claimToken,
        env.repo,
        gitHead(env.repo),
        false,
      );
      const first = await execOk<{ task: Task; handoff: Handoff }>(env.held.core, envelope);
      removeDir(env.repo);
      const replay = await execOk<{ task: Task; handoff: Handoff }>(env.held.core, envelope);
      assert.deepEqual(replay, first);
    } finally {
      env.cleanup();
    }
  });

  it("replays after HEAD moves on", async () => {
    const env = await setup();
    try {
      const { task, claimToken } = await createAndClaim(env, "a09b");
      const envelope = submitRequest(
        env.project.id,
        "muse",
        "submit-1",
        task.id,
        claimToken,
        env.repo,
        gitHead(env.repo),
        false,
      );
      const first = await execOk<{ task: Task; handoff: Handoff }>(env.held.core, envelope);
      gitCommitFile(env.repo, "later.txt", "later\n", "later commit");
      assert.notEqual(gitHead(env.repo), first.handoff.observed.head);
      const replay = await execOk<{ task: Task; handoff: Handoff }>(env.held.core, envelope);
      assert.deepEqual(replay, first);
    } finally {
      env.cleanup();
    }
  });
});

describe("cancel versus complete race (A10)", () => {
  it("exactly one terminal winner across two processes", async () => {
    const env = await setup();
    try {
      const { task, claimToken } = await createAndClaim(env, "a10");
      const head = gitHead(env.repo);
      const gate = join(tempDir("company-gate-"), "gate");
      const pendingHandoff = runCoreChild(
        env.held.home,
        submitRequest(env.project.id, "muse", "submit-race", task.id, claimToken, env.repo, head, false),
        { gate },
      );
      const pendingCancel = runCoreChild(
        env.held.home,
        mutRequest("task.cancel", env.project.id, "flash", "cancel-race", { taskId: task.id }),
        { gate },
      );
      await new Promise((resolve) => setTimeout(resolve, 5000));
      writeFileSync(gate, "go\n");
      const [handoffResult, cancelResult] = await Promise.all([pendingHandoff, pendingCancel]);
      assert.equal(handoffResult.exitCode, 0, handoffResult.stderr);
      assert.equal(cancelResult.exitCode, 0, cancelResult.stderr);
      const stored = await execOk<{ task: Task }>(
        env.held.core,
        readRequest("task.get", env.project.id, { taskId: task.id }),
      );
      if (stored.task.status === "completed") {
        assert.ok(handoffResult.response?.ok, JSON.stringify(handoffResult.response));
        assert.ok(cancelResult.response && !cancelResult.response.ok);
        if (cancelResult.response && !cancelResult.response.ok) {
          assert.equal(cancelResult.response.error.code, "CONFLICT");
        }
        // Completed tasks reject new cancellation.
        const late = await execErr(
          env.held.core,
          mutRequest("task.cancel", env.project.id, "flash", "cancel-late", { taskId: task.id }),
        );
        assert.equal(late.code, "CONFLICT");
      } else {
        assert.equal(stored.task.status, "cancelled");
        assert.ok(cancelResult.response?.ok, JSON.stringify(cancelResult.response));
        assert.ok(handoffResult.response && !handoffResult.response.ok);
        if (handoffResult.response && !handoffResult.response.ok) {
          assert.equal(handoffResult.response.error.code, "STALE_CLAIM");
        }
        // Cancelled tasks get no late handoff.
        const late = await execErr(
          env.held.core,
          submitRequest(env.project.id, "muse", "submit-late", task.id, claimToken, env.repo, head, false),
        );
        assert.equal(late.code, "STALE_CLAIM");
      }
    } finally {
      env.cleanup();
    }
  });
});

describe("observation mismatches and failed collection (A11)", () => {
  it("rejects mismatching head or dirty without completing", async () => {
    const env = await setup();
    try {
      const { task, claimToken } = await createAndClaim(env, "a11");
      const wrongHead = await execErr(
        env.held.core,
        submitRequest(env.project.id, "muse", "submit-bad-head", task.id, claimToken, env.repo, "f".repeat(40), false),
      );
      assert.equal(wrongHead.code, "CONFLICT");

      execFileSync("git", ["--version"]);
      writeFileSync(join(env.repo, "uncommitted.txt"), "dirty\n");
      assert.equal(gitDirty(env.repo), true);
      const wrongDirty = await execErr(
        env.held.core,
        submitRequest(env.project.id, "muse", "submit-bad-dirty", task.id, claimToken, env.repo, gitHead(env.repo), false),
      );
      assert.equal(wrongDirty.code, "CONFLICT");

      const stored = await execOk<{ task: Task }>(
        env.held.core,
        readRequest("task.get", env.project.id, { taskId: task.id }),
      );
      assert.equal(stored.task.status, "running");
      assert.equal(stored.task.ownerId, "muse");

      // Honest dirty report succeeds.
      const honest = await execOk<{ task: Task; handoff: Handoff }>(
        env.held.core,
        submitRequest(env.project.id, "muse", "submit-honest", task.id, claimToken, env.repo, gitHead(env.repo), true),
      );
      assert.equal(honest.task.status, "completed");
      assert.equal(honest.handoff.observed.dirty, true);
    } finally {
      env.cleanup();
    }
  });

  it("rejects new handoffs when observation fails and never runs checks", async () => {
    const env = await setup();
    const sentinel = join(tempDir("company-sentinel-"), "pwned");
    try {
      const { task, claimToken } = await createAndClaim(env, "a11b");
      removeDir(env.repo);
      const failed = await execErr(
        env.held.core,
        submitRequest(env.project.id, "muse", "submit-gone", task.id, claimToken, env.repo, "0".repeat(40), false),
      );
      assert.equal(failed.code, "CONFLICT");
      const stored = await execOk<{ task: Task }>(
        env.held.core,
        readRequest("task.get", env.project.id, { taskId: task.id }),
      );
      assert.equal(stored.task.status, "running");
    } finally {
      env.cleanup();
    }
    const env2 = await setup();
    try {
      const { task, claimToken } = await createAndClaim(env2, "a11c");
      const envelope = submitRequest(
        env2.project.id,
        "muse",
        "submit-checks",
        task.id,
        claimToken,
        env2.repo,
        gitHead(env2.repo),
        false,
      ) as unknown as Record<string, unknown>;
      const payload = envelope.payload as Record<string, unknown>;
      const evidence = payload.evidence as Record<string, unknown>;
      (evidence.checks as Array<Record<string, unknown>>)[0].command = `touch ${sentinel}`;
      const submitted = await execOk<{ task: Task; handoff: Handoff }>(env2.held.core, envelope);
      assert.equal(submitted.task.status, "completed");
      assert.equal(existsSync(sentinel), false);
    } finally {
      env2.cleanup();
    }
  });

  it("accepts 64-hex SHA-256 HEADs for observation and completion (GROK-001)", async (t) => {
    const held: TestCore = openTestCore();
    const repo = tempDir("company-sha256-");
    const cleanup = (): void => {
      removeDir(repo);
      try {
        closeCore(held.core);
      } catch {
        // Cleanup best-effort.
      }
      removeDir(held.home);
    };
    try {
      try {
        execFileSync("git", ["init", "--object-format=sha256", repo], {
          encoding: "utf8",
          stdio: "pipe",
          timeout: 30000,
        });
      } catch {
        t.skip("this Git does not support --object-format=sha256");
        return;
      }
      execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repo, stdio: "pipe" });
      execFileSync("git", ["config", "user.name", "Test"], { cwd: repo, stdio: "pipe" });
      writeFileSync(join(repo, "file.txt"), "hello\n");
      execFileSync("git", ["add", "."], { cwd: repo, stdio: "pipe" });
      execFileSync("git", ["commit", "-m", "initial"], { cwd: repo, stdio: "pipe" });
      const head = gitHead(repo);
      if (head.length !== 64) {
        t.skip("this Git did not produce a 64-hex HEAD");
        return;
      }
      const registered = await execOk<{ project: Project }>(
        held.core,
        regRequest("project.register", "sha256-setup", { root: repo, name: "P256" }),
      );
      await execOk(held.core, regRequest("agent.register", "sha256-muse", { id: "muse", displayName: "Muse" }));
      const env: Env = { held, repo, project: registered.project, cleanup: () => {} };
      const { task, claimToken } = await createAndClaim(env, "sha256");
      const submitted = await execOk<{ task: Task; handoff: Handoff }>(
        held.core,
        submitRequest(registered.project.id, "muse", "submit-sha256", task.id, claimToken, repo, head, false),
      );
      assert.equal(submitted.task.status, "completed");
      assert.equal(submitted.handoff.observed.head, head);
      const ctx = await execOk<{ snapshot: ContextSnapshot }>(
        held.core,
        readRequest("context.get", registered.project.id, { taskId: task.id }),
      );
      assert.equal(ctx.snapshot.currentGit.head, head);
      assert.equal(ctx.snapshot.currentGit.error, null);
    } finally {
      cleanup();
    }
  });
});

describe("checkout project identity (CODEX-001)", () => {
  it("rejects handoffs from an unrelated repository without effects", async () => {
    const env = await setup();
    const foreign = initGitRepo();
    try {
      const { task, claimToken } = await createAndClaim(env, "foreign");
      const rejected = await execErr(
        env.held.core,
        submitRequest(env.project.id, "muse", "submit-foreign", task.id, claimToken, foreign, gitHead(foreign), false),
      );
      assert.equal(rejected.code, "CONFLICT");

      // No partial effects: task untouched, no handoff, no receipt.
      const stored = await execOk<{ task: Task }>(
        env.held.core,
        readRequest("task.get", env.project.id, { taskId: task.id }),
      );
      assert.equal(stored.task.status, "running");
      assert.equal(stored.task.ownerId, "muse");
      assert.equal(countRows(env.held.home, "handoffs", task.id), 0);
      assert.equal(hasReceipt(env.held.home, "submit-foreign"), false);

      // A correct handoff with a new key still succeeds afterwards.
      const recovered = await execOk<{ task: Task; handoff: Handoff }>(
        env.held.core,
        submitRequest(env.project.id, "muse", "submit-own", task.id, claimToken, env.repo, gitHead(env.repo), false),
      );
      assert.equal(recovered.task.status, "completed");
    } finally {
      removeDir(foreign);
      env.cleanup();
    }
  });

  it("rejects an independent clone even when HEAD matches", async () => {
    const env = await setup();
    const clone = cloneRepo(env.repo);
    try {
      assert.equal(gitHead(clone), gitHead(env.repo));
      const { task, claimToken } = await createAndClaim(env, "clone");
      const rejected = await execErr(
        env.held.core,
        submitRequest(env.project.id, "muse", "submit-clone", task.id, claimToken, clone, gitHead(clone), false),
      );
      assert.equal(rejected.code, "CONFLICT");
      const stored = await execOk<{ task: Task }>(
        env.held.core,
        readRequest("task.get", env.project.id, { taskId: task.id }),
      );
      assert.equal(stored.task.status, "running");
      assert.equal(countRows(env.held.home, "handoffs", task.id), 0);
    } finally {
      removeDir(clone);
      env.cleanup();
    }
  });

  it("accepts a linked worktree of the registered project", async () => {
    const env = await setup();
    const worktree = addWorktree(env.repo, "wt1");
    try {
      const { task, claimToken } = await createAndClaim(env, "worktree");
      const submitted = await execOk<{ task: Task; handoff: Handoff }>(
        env.held.core,
        submitRequest(env.project.id, "muse", "submit-wt", task.id, claimToken, worktree, gitHead(worktree), false),
      );
      assert.equal(submitted.task.status, "completed");
      assert.equal(submitted.handoff.observed.head, gitHead(worktree));
    } finally {
      removeWorktree(env.repo, worktree);
      env.cleanup();
    }
  });
});

describe("read-only Git observation (CODEX-003)", () => {
  it("leaves the Git index untouched during observation", async () => {
    const env = await setup();
    const worktree = addWorktree(env.repo, "idx");
    try {
      const { task, claimToken } = await createAndClaim(env, "idx");
      const mainIndex = join(env.repo, ".git", "index");
      const wtGitDir = execFileSync("git", ["rev-parse", "--absolute-git-dir"], {
        cwd: worktree,
        encoding: "utf8",
        stdio: "pipe",
        timeout: 30000,
      }).trim();
      const wtIndex = join(wtGitDir, "index");
      for (const index of [mainIndex, wtIndex]) {
        if (!existsSync(index)) {
          // Fixture setup only: ensure an index exists before recording it.
          execFileSync("git", ["status", "--porcelain"], {
            cwd: index === mainIndex ? env.repo : worktree,
            stdio: "pipe",
          });
        }
      }
      // Change tracked-file metadata without changing contents: the tree
      // stays content-clean but a locking status would refresh the index.
      for (const file of [join(env.repo, "file.txt"), join(worktree, "file.txt")]) {
        const st = statSync(file);
        utimesSync(file, st.atime, new Date(st.mtimeMs - 10000));
      }
      const beforeMain = readFileSync(mainIndex);
      const beforeWt = readFileSync(wtIndex);
      // Observation through the public mutation path plus context retrieval.
      const submitted = await execOk<{ task: Task; handoff: Handoff }>(
        env.held.core,
        submitRequest(env.project.id, "muse", "submit-idx", task.id, claimToken, env.repo, gitHead(env.repo), false),
      );
      assert.equal(submitted.task.status, "completed");
      assert.equal(submitted.handoff.observed.dirty, false);
      await execOk<{ snapshot: ContextSnapshot }>(
        env.held.core,
        readRequest("context.get", env.project.id, { taskId: task.id }),
      );
      // Direct observation of the linked worktree.
      const wtObserved = observeCheckout(worktree, Date.now());
      assert.equal(wtObserved.dirty, false);
      assert.deepEqual(readFileSync(mainIndex), beforeMain);
      assert.deepEqual(readFileSync(wtIndex), beforeWt);
    } finally {
      removeWorktree(env.repo, worktree);
      env.cleanup();
    }
  });
});

describe("claim replay and blocked guards", () => {
  it("replaying the original claim never renews the lease or adds an attempt", async () => {
    let current = 1_700_000_000_000;
    const env = await setup(() => current);
    try {
      const { task, claimToken } = await createAndClaim(env, "replay");
      const before = await execOk<{ task: Task }>(
        env.held.core,
        readRequest("task.get", env.project.id, { taskId: task.id }),
      );
      current += 60 * 60 * 1000;
      const replay = await execOk<{ task: Task; claimToken: string }>(
        env.held.core,
        mutRequest("task.claim", env.project.id, "muse", "claim-replay", { taskId: task.id }),
      );
      assert.equal(replay.claimToken, claimToken);
      assert.equal(replay.task.leaseUntil, before.task.leaseUntil);
      assert.equal(replay.task.attempt, 1);
    } finally {
      env.cleanup();
    }
  });

  it("guards blocked/completed outcome mismatches before questions exist", async () => {
    const env = await setup();
    try {
      const { task, claimToken } = await createAndClaim(env, "guards");
      const completedWithBlockers = await execErr(
        env.held.core,
        submitRequest(env.project.id, "muse", "submit-x1", task.id, claimToken, env.repo, gitHead(env.repo), false, {
          outcome: "completed",
          blockingQuestionIds: ["11111111-1111-4111-8111-111111111111"],
        }),
      );
      assert.equal(completedWithBlockers.code, "CONFLICT");
      const blockedWithout = await execErr(
        env.held.core,
        submitRequest(env.project.id, "muse", "submit-x2", task.id, claimToken, env.repo, gitHead(env.repo), false, {
          outcome: "blocked",
        }),
      );
      assert.equal(blockedWithout.code, "CONFLICT");
      const blockedUnknown = await execErr(
        env.held.core,
        submitRequest(env.project.id, "muse", "submit-x3", task.id, claimToken, env.repo, gitHead(env.repo), false, {
          outcome: "blocked",
          blockingQuestionIds: ["11111111-1111-4111-8111-111111111111"],
        }),
      );
      assert.equal(blockedUnknown.code, "CONFLICT");
    } finally {
      env.cleanup();
    }
  });
});
