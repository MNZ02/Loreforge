import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const currentDir = fileURLToPath(new URL(".", import.meta.url));
const packageRoot = resolve(currentDir, "../..");
const distBin = join(packageRoot, "dist", "cli", "main.js");

function runCli(
  args: string[],
  options: { cwd?: string; input?: unknown; home: string }
): { status: number | null; stdout: string; stderr: string; data?: any; error?: any } {
  const inputStr =
    options.input !== undefined
      ? typeof options.input === "string"
        ? options.input
        : JSON.stringify(options.input)
      : undefined;

  const fullArgs = [...args, "--home", options.home, "--json"];
  if (inputStr !== undefined && !args.includes("--input")) {
    fullArgs.push("--input", "-");
  }

  const res = spawnSync(process.execPath, [distBin, ...fullArgs], {
    cwd: options.cwd || packageRoot,
    input: inputStr,
    encoding: "utf-8"
  });

  let parsed: any = undefined;
  try {
    const trimmed = res.stdout.trim();
    if (trimmed.length > 0) {
      parsed = JSON.parse(trimmed);
    }
  } catch {
    // leave parsed undefined
  }

  return {
    status: res.status,
    stdout: res.stdout,
    stderr: res.stderr,
    data: parsed?.ok ? parsed.data : undefined,
    error: !parsed?.ok ? parsed?.error : undefined
  };
}

function initGitRepo(repoPath: string): string {
  mkdirSync(repoPath, { recursive: true });
  execFileSync("git", ["init", "-b", "main"], { cwd: repoPath, stdio: "pipe" });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: repoPath, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repoPath, stdio: "pipe" });

  writeFileSync(join(repoPath, "hello.txt"), "Initial commit\n");
  execFileSync("git", ["add", "."], { cwd: repoPath, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", "Initial commit"], { cwd: repoPath, stdio: "pipe" });

  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoPath, encoding: "utf-8" }).trim();
  return head;
}

describe("Full Multi-Process Integration Acceptance (A03, A12, A14, A21, A22)", () => {
  it("A22: space-containing repo path works and git status stays clean", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "agent-company-a22-"));
    const repoWithSpaces = join(tempRoot, "my repo with spaces");
    const homeDir = join(tempRoot, "home");

    try {
      const head = initGitRepo(repoWithSpaces);

      // Register project
      const reg = runCli(["project", "register"], {
        home: homeDir,
        input: {
          schemaVersion: 1,
          requestId: "req-reg-space",
          payload: { root: repoWithSpaces, name: "SpaceRepo" }
        }
      });
      assert.equal(reg.status, 0, `Failed to register project: ${reg.stderr || reg.stdout}`);
      assert.ok(reg.data.project.id);

      // Verify git repo index and worktree are completely clean
      const gitStatus = execFileSync("git", ["status", "--porcelain"], {
        cwd: repoWithSpaces,
        encoding: "utf-8"
      }).trim();
      assert.equal(gitStatus, "", "Git worktree must remain clean after observation");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("A03: cross-project isolation: Project A entities queried under B return NOT_FOUND", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "agent-company-a03-"));
    const repoA = join(tempRoot, "repo-a");
    const repoB = join(tempRoot, "repo-b");
    const homeDir = join(tempRoot, "home");

    try {
      initGitRepo(repoA);
      initGitRepo(repoB);

      const regA = runCli(["project", "register"], {
        home: homeDir,
        input: { schemaVersion: 1, requestId: "reg-a", payload: { root: repoA, name: "Project A" } }
      });
      const regB = runCli(["project", "register"], {
        home: homeDir,
        input: { schemaVersion: 1, requestId: "reg-b", payload: { root: repoB, name: "Project B" } }
      });

      const projAId = regA.data.project.id;
      const projBId = regB.data.project.id;
      assert.notEqual(projAId, projBId);

      runCli(["agent", "register"], {
        home: homeDir,
        input: { schemaVersion: 1, requestId: "reg-agent", payload: { id: "flash", displayName: "Flash Agent" } }
      });

      // Create Task under Project A
      const taskCreate = runCli(["task", "create"], {
        home: homeDir,
        input: {
          schemaVersion: 1,
          projectId: projAId,
          actorId: "flash",
          requestId: "create-t1",
          payload: { title: "Secret Task in A", description: "Top secret content A", dependsOn: [] }
        }
      });
      assert.equal(taskCreate.status, 0);
      const taskAId = taskCreate.data.task.id;

      // Query Task A under Project B -> must return NOT_FOUND (exit 3) and leak no content
      const queryUnderB = runCli(["task", "get"], {
        home: homeDir,
        input: {
          schemaVersion: 1,
          projectId: projBId,
          payload: { taskId: taskAId }
        }
      });
      assert.equal(queryUnderB.status, 3, "Querying Project A entity under Project B must return exit code 3 (NOT_FOUND)");
      assert.equal(queryUnderB.error.code, "NOT_FOUND");
      assert.ok(!queryUnderB.stdout.includes("Secret Task in A"), "Must not leak Project A title");
      assert.ok(!queryUnderB.stdout.includes("Top secret content A"), "Must not leak Project A description");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("A12 & A21: blocked handoff releases claim, answers unblock reopen, second attempt completes across processes", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "agent-company-a12-"));
    const repoPath = join(tempRoot, "repo");
    const homeDir = join(tempRoot, "home");

    try {
      const head = initGitRepo(repoPath);

      // Register project and agents
      const regProj = runCli(["project", "register"], {
        home: homeDir,
        input: { schemaVersion: 1, requestId: "reg-p", payload: { root: repoPath, name: "FlowProject" } }
      });
      const projectId = regProj.data.project.id;

      runCli(["agent", "register"], {
        home: homeDir,
        input: { schemaVersion: 1, requestId: "reg-muse", payload: { id: "muse", displayName: "Muse" } }
      });
      runCli(["agent", "register"], {
        home: homeDir,
        input: { schemaVersion: 1, requestId: "reg-flash", payload: { id: "flash", displayName: "Flash" } }
      });

      // Create Task
      const taskRes = runCli(["task", "create"], {
        home: homeDir,
        input: {
          schemaVersion: 1,
          projectId,
          actorId: "flash",
          requestId: "task-c-1",
          payload: { title: "Implement feature with blocker", description: "Test flow", dependsOn: [] }
        }
      });
      const taskId = taskRes.data.task.id;

      // 1. Claim Task (attempt 1)
      const claim1 = runCli(["task", "claim"], {
        home: homeDir,
        input: {
          schemaVersion: 1,
          projectId,
          actorId: "flash",
          requestId: "claim-1",
          payload: { taskId }
        }
      });
      assert.equal(claim1.status, 0);
      const claimToken1 = claim1.data.claimToken;
      assert.ok(claimToken1);
      assert.equal(claim1.data.task.attempt, 1);
      assert.equal(claim1.data.task.status, "running");

      // 2. Ask a question to muse
      const askRes = runCli(["question", "ask"], {
        home: homeDir,
        input: {
          schemaVersion: 1,
          projectId,
          actorId: "flash",
          requestId: "ask-q-1",
          payload: { taskId, toAgentId: "muse", body: "Need schema clarification" }
        }
      });
      assert.equal(askRes.status, 0);
      const questionId = askRes.data.question.id;

      // 3. Submit blocked handoff referencing questionId
      const blockedRes = runCli(["handoff", "submit"], {
        home: homeDir,
        input: {
          schemaVersion: 1,
          projectId,
          actorId: "flash",
          requestId: "handoff-block",
          payload: {
            taskId,
            claimToken: claimToken1,
            outcome: "blocked",
            summary: "Blocked on schema clarification",
            evidence: {
              checkoutRoot: repoPath,
              head,
              dirty: false,
              files: [],
              checks: []
            },
            unresolved: ["Question pending"],
            nextSteps: ["Await reply"],
            blockingQuestionIds: [questionId]
          }
        }
      });
      assert.equal(blockedRes.status, 0);
      assert.equal(blockedRes.data.task.status, "blocked");
      assert.equal(blockedRes.data.task.ownerId, null, "Blocked handoff must clear owner");

      // 4. Cannot reopen until question is answered
      const prematureReopen = runCli(["task", "reopen"], {
        home: homeDir,
        input: {
          schemaVersion: 1,
          projectId,
          actorId: "flash",
          requestId: "reopen-fail",
          payload: { taskId }
        }
      });
      assert.equal(prematureReopen.status, 4, "Reopening before question answered must fail CONFLICT (exit 4)");

      // 5. Muse answers the question
      const answerRes = runCli(["question", "answer"], {
        home: homeDir,
        input: {
          schemaVersion: 1,
          projectId,
          actorId: "muse",
          requestId: "ans-q-1",
          payload: { questionId, body: "Clarification provided" }
        }
      });
      assert.equal(answerRes.status, 0);

      // 6. Now reopen succeeds
      const reopenRes = runCli(["task", "reopen"], {
        home: homeDir,
        input: {
          schemaVersion: 1,
          projectId,
          actorId: "flash",
          requestId: "reopen-ok",
          payload: { taskId }
        }
      });
      assert.equal(reopenRes.status, 0);
      assert.equal(reopenRes.data.task.status, "open");

      // 7. Reclaim task (attempt 2)
      const claim2 = runCli(["task", "claim"], {
        home: homeDir,
        input: {
          schemaVersion: 1,
          projectId,
          actorId: "flash",
          requestId: "claim-2",
          payload: { taskId }
        }
      });
      assert.equal(claim2.status, 0);
      assert.equal(claim2.data.task.attempt, 2);
      const claimToken2 = claim2.data.claimToken;
      assert.notEqual(claimToken1, claimToken2);

      // 8. Submit completed handoff
      const completeRes = runCli(["handoff", "submit"], {
        home: homeDir,
        input: {
          schemaVersion: 1,
          projectId,
          actorId: "flash",
          requestId: "handoff-complete",
          payload: {
            taskId,
            claimToken: claimToken2,
            outcome: "completed",
            summary: "Completed successfully on attempt 2",
            evidence: {
              checkoutRoot: repoPath,
              head,
              dirty: false,
              files: [{ path: "hello.txt", change: "modified" }],
              checks: [{ command: "test", outcome: "passed", summary: "ok" }]
            },
            unresolved: [],
            nextSteps: [],
            blockingQuestionIds: []
          }
        }
      });
      assert.equal(completeRes.status, 0);
      assert.equal(completeRes.data.task.status, "completed");

      // 9. A21: Start fresh process, verify retrievable via context get
      const freshContext = runCli(["context", "get"], {
        home: homeDir,
        input: {
          schemaVersion: 1,
          projectId,
          payload: { taskId, mode: "work" }
        }
      });
      assert.equal(freshContext.status, 0);
      const snapshot = freshContext.data.snapshot;
      assert.equal(snapshot.task.status, "completed");
      assert.equal(snapshot.handoffs.length, 2, "Both handoffs (blocked and completed) must be preserved in history");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("A14: inbox cursor retrieves ordered events without duplicates or losing events", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "agent-company-a14-"));
    const repoPath = join(tempRoot, "repo");
    const homeDir = join(tempRoot, "home");

    try {
      initGitRepo(repoPath);
      const regProj = runCli(["project", "register"], {
        home: homeDir,
        input: { schemaVersion: 1, requestId: "reg-p", payload: { root: repoPath, name: "InboxProject" } }
      });
      const projectId = regProj.data.project.id;

      runCli(["agent", "register"], {
        home: homeDir,
        input: { schemaVersion: 1, requestId: "reg-m", payload: { id: "muse", displayName: "Muse" } }
      });
      runCli(["agent", "register"], {
        home: homeDir,
        input: { schemaVersion: 1, requestId: "reg-f", payload: { id: "flash", displayName: "Flash" } }
      });

      const task = runCli(["task", "create"], {
        home: homeDir,
        input: {
          schemaVersion: 1,
          projectId,
          actorId: "flash",
          requestId: "t-inbox",
          payload: { title: "Inbox Task", description: "desc", dependsOn: [] }
        }
      });
      const taskId = task.data.task.id;

      // Ask 3 questions from flash to muse
      for (let i = 1; i <= 3; i++) {
        runCli(["question", "ask"], {
          home: homeDir,
          input: {
            schemaVersion: 1,
            projectId,
            actorId: "flash",
            requestId: `ask-batch-${i}`,
            payload: { taskId, toAgentId: "muse", body: `Question number ${i}` }
          }
        });
      }

      // Page 1: limit 2, after 0
      const page1 = runCli(["inbox", "list"], {
        home: homeDir,
        input: {
          schemaVersion: 1,
          projectId,
          actorId: "muse",
          payload: { after: 0, limit: 2 }
        }
      });
      assert.equal(page1.status, 0);
      assert.equal(page1.data.events.length, 2);
      assert.equal(page1.data.hasMore, true);
      const cursor1 = page1.data.nextCursor;

      // Page 2: limit 2, after cursor1
      const page2 = runCli(["inbox", "list"], {
        home: homeDir,
        input: {
          schemaVersion: 1,
          projectId,
          actorId: "muse",
          payload: { after: cursor1, limit: 2 }
        }
      });
      assert.equal(page2.status, 0);
      assert.equal(page2.data.events.length, 1);
      assert.equal(page2.data.hasMore, false);
      const cursor2 = page2.data.nextCursor;

      // Page 3: after cursor2 (empty page)
      const page3 = runCli(["inbox", "list"], {
        home: homeDir,
        input: {
          schemaVersion: 1,
          projectId,
          actorId: "muse",
          payload: { after: cursor2, limit: 2 }
        }
      });
      assert.equal(page3.status, 0);
      assert.equal(page3.data.events.length, 0);
      assert.equal(page3.data.hasMore, false);
      assert.equal(page3.data.nextCursor, cursor2, "Empty page must preserve cursor");
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
