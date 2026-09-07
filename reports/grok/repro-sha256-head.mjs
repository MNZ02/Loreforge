#!/usr/bin/env node
// Temporary Grok reproduction: SHA-256 Git HEADs are 64-hex, accepted by
// HeadSchema, but observeCheckout / handoff.submit reject them.
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { openCore, parseRequest } from "../../src/core/index.ts";
import { observeCheckout } from "../../src/evidence/git.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));
process.chdir(root);

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

const repo = mkdtempSync(join(tmpdir(), "grok-sha256-"));
const home = mkdtempSync(join(tmpdir(), "grok-sha256-home-"));
let failed = false;
try {
  execFileSync("git", ["init", "-b", "main", "--object-format=sha256", repo], { stdio: "pipe" });
  git(repo, ["config", "user.name", "Grok Review"]);
  git(repo, ["config", "user.email", "grok@example.test"]);
  writeFileSync(join(repo, "readme.txt"), "sha256\n");
  git(repo, ["add", "readme.txt"]);
  git(repo, ["commit", "-m", "init"]);
  const head = git(repo, ["rev-parse", "HEAD"]);
  console.log("HEAD_LEN", head.length);
  console.log("HEAD", head);
  if (head.length !== 64) {
    console.log("SKIP: this Git did not produce a 64-hex HEAD");
    process.exit(2);
  }

  parseRequest({
    schemaVersion: 1,
    operation: "handoff.submit",
    projectId: "11111111-1111-4111-8111-111111111111",
    actorId: "muse",
    requestId: "schema-64",
    payload: {
      taskId: "22222222-2222-4222-8222-222222222222",
      claimToken: "a".repeat(64),
      outcome: "completed",
      summary: "schema accepts 64-hex",
      evidence: {
        checkoutRoot: repo,
        head,
        dirty: false,
        files: [],
        checks: [],
      },
      unresolved: [],
      nextSteps: [],
      blockingQuestionIds: [],
    },
  });
  console.log("SCHEMA_64_HEX", "accepted");

  try {
    observeCheckout(repo, Date.now());
    console.log("OBSERVE", "accepted");
  } catch (error) {
    failed = true;
    console.log("OBSERVE_CODE", error.code);
    console.log("OBSERVE_MESSAGE", error.message);
  }

  const core = openCore({ home });
  try {
    const project = await core.execute({
      schemaVersion: 1,
      operation: "project.register",
      requestId: "reg-p",
      payload: { root: repo, name: "sha256" },
    });
    console.log("REGISTER_OK", project.ok, project.ok ? project.data.project.id : project.error);
    await core.execute({
      schemaVersion: 1,
      operation: "agent.register",
      requestId: "reg-a",
      payload: { id: "muse", displayName: "Muse" },
    });
    const created = await core.execute({
      schemaVersion: 1,
      operation: "task.create",
      projectId: project.data.project.id,
      actorId: "muse",
      requestId: "t1",
      payload: { title: "Observe sha256", description: "handoff should accept 64-hex HEAD", dependsOn: [] },
    });
    const claimed = await core.execute({
      schemaVersion: 1,
      operation: "task.claim",
      projectId: project.data.project.id,
      actorId: "muse",
      requestId: "c1",
      payload: { taskId: created.data.task.id },
    });
    const handoff = await core.execute({
      schemaVersion: 1,
      operation: "handoff.submit",
      projectId: project.data.project.id,
      actorId: "muse",
      requestId: "h1",
      payload: {
        taskId: created.data.task.id,
        claimToken: claimed.data.claimToken,
        outcome: "completed",
        summary: "trying to complete against a SHA-256 git repo",
        evidence: {
          checkoutRoot: repo,
          head,
          dirty: false,
          files: [{ path: "readme.txt", change: "added" }],
          checks: [],
        },
        unresolved: [],
        nextSteps: [],
        blockingQuestionIds: [],
      },
    });
    console.log("HANDOFF_OK", handoff.ok);
    if (!handoff.ok) {
      failed = true;
      console.log("HANDOFF_CODE", handoff.error.code);
      console.log("HANDOFF_MESSAGE", handoff.error.message);
    }
    const after = await core.execute({
      schemaVersion: 1,
      operation: "task.get",
      projectId: project.data.project.id,
      payload: { taskId: created.data.task.id },
    });
    console.log("TASK_STATUS", after.ok ? after.data.task.status : after.error);
    const ctx = await core.execute({
      schemaVersion: 1,
      operation: "context.get",
      projectId: project.data.project.id,
      payload: { taskId: created.data.task.id, mode: "work" },
    });
    console.log("CURRENT_GIT", JSON.stringify(ctx.ok ? ctx.data.snapshot.currentGit : ctx.error));
  } finally {
    core.close();
  }
} finally {
  rmSync(repo, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
