import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { EvidenceInputSchema } from "../../src/core/schemas/handoffs.js";

const currentDir = fileURLToPath(new URL(".", import.meta.url));
const packageRoot = resolve(currentDir, "../..");
const distBin = join(packageRoot, "dist", "cli", "main.js");
const setupScript = join(packageRoot, "examples", "two-agent", "setup.mjs");
const readmePath = join(packageRoot, "examples", "two-agent", "README.md");

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

describe("CODEX-004: Two-Agent Field Exercise Walkthrough Acceptance", () => {
  it("verifies published walkthrough payloads conform to strict schemas and contain no unrecognized keys", () => {
    const readmeContent = readFileSync(readmePath, "utf-8");

    // Assert the defective extra key reported in CODEX-004 is absent
    assert.equal(
      readmeContent.includes('"math.test.js": "modified"'),
      false,
      "README.md must not contain the rejected duplicate key 'math.test.js': 'modified'"
    );

    // Extract JSON payload blocks from README.md
    const jsonBlocks = readmeContent.match(/<<'EOF'\n([\s\S]*?)\n\s*EOF/g);
    assert.ok(jsonBlocks && jsonBlocks.length >= 8, "Expected multiple payload blocks in README.md");

    const sampleUuid = "11111111-1111-4111-8111-111111111111";
    const sampleToken = "22222222-2222-4222-8222-222222222222";
    const sampleHash = "a".repeat(40);

    for (const rawBlock of jsonBlocks) {
      const jsonText = rawBlock.replace(/<<'EOF'\n/, "").replace(/\n\s*EOF$/, "");
      // Substitute placeholders with valid dummy values for schema validation
      const substituted = jsonText
        .replace(/<PROJECT_ID>/g, sampleUuid)
        .replace(/<TASK_A_ID>/g, sampleUuid)
        .replace(/<TASK_B_ID>/g, sampleUuid)
        .replace(/<CLAIM_TOKEN_A>/g, sampleToken)
        .replace(/<CLAIM_TOKEN_B>/g, sampleToken)
        .replace(/<CLAIM_TOKEN_B2>/g, sampleToken)
        .replace(/<QUESTION_ID>/g, sampleUuid)
        .replace(/<COMMIT_HASH>/g, sampleHash);

      const parsed = JSON.parse(substituted);
      assert.equal(parsed.schemaVersion, 1);

      // If this is a handoff submission payload, validate evidence explicitly against EvidenceInputSchema
      if (parsed.payload && parsed.payload.evidence) {
        const evParse = EvidenceInputSchema.safeParse(parsed.payload.evidence);
        assert.equal(evParse.success, true, `Evidence schema failed: ${JSON.stringify(evParse.error)}`);
        if (parsed.payload.outcome === "completed") {
          assert.equal(parsed.payload.evidence.files.length > 0, true);
        }
        for (const file of parsed.payload.evidence.files) {
          assert.equal(typeof file.path, "string");
          assert.ok(["added", "modified", "deleted"].includes(file.change));
          assert.equal(Object.keys(file).length, 2, "Evidence file entry must contain only path and change");
        }
      }
    }
  });

  it("executes the documented two-agent protocol end-to-end against a disposable fixture from the checkout cwd", () => {
    const targetDir = mkdtempSync(join(tmpdir(), "codex-004-walkthrough-"));

    try {
      // Step 1: Run setup.mjs
      const setupRes = spawnSync(process.execPath, [setupScript, targetDir], {
        encoding: "utf-8"
      });
      assert.equal(setupRes.status, 0, `setup.mjs failed: ${setupRes.stderr || setupRes.stdout}`);

      const idsPath = join(targetDir, "ids.json");
      assert.ok(existsSync(idsPath), "ids.json must exist after setup");
      const ids = JSON.parse(readFileSync(idsPath, "utf-8"));
      const { projectId, taskAId, taskBId, homeDir, repoDir, cliBin } = ids;

      assert.ok(projectId, "projectId must be defined in ids.json");
      assert.ok(taskAId, "taskAId must be defined in ids.json");
      assert.ok(taskBId, "taskBId must be defined in ids.json");
      assert.ok(existsSync(cliBin), `cliBin (${cliBin}) must point to compiled CLI`);

      // Verify that initial repo has initial commit
      const initialHead = execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: repoDir,
        encoding: "utf-8"
      }).trim();
      assert.ok(initialHead.length === 40, "Initial head commit hash valid");

      // Verify initial test passes
      const initialTestRes = spawnSync(process.execPath, ["math.test.js"], {
        cwd: repoDir,
        encoding: "utf-8"
      });
      assert.equal(initialTestRes.status, 0, "Initial fixture math.test.js must pass");

      // Step 2: Muse actions
      // 2.1 Retrieve Task A Context (run with cwd = repoDir to verify foreign checkout invocation)
      const ctxARes = runCli(["context", "get"], {
        cwd: repoDir,
        home: homeDir,
        input: {
          schemaVersion: 1,
          projectId,
          payload: { taskId: taskAId, mode: "work" }
        }
      });
      assert.equal(ctxARes.status, 0, `context get failed: ${ctxARes.stderr}`);
      assert.equal(ctxARes.data.snapshot.task.id, taskAId);

      // 2.2 Claim Task A
      const claimARes = runCli(["task", "claim"], {
        cwd: repoDir,
        home: homeDir,
        input: {
          schemaVersion: 1,
          projectId,
          actorId: "muse",
          requestId: "muse-claim-a-1",
          payload: { taskId: taskAId }
        }
      });
      assert.equal(claimARes.status, 0, `task claim failed: ${claimARes.stderr}`);
      const claimTokenA = claimARes.data.claimToken;
      assert.ok(claimTokenA, "Claim token A must be returned");

      // 2.3 Implement feature & test in repoDir
      const mathJsPath = join(repoDir, "math.js");
      const mathTestPath = join(repoDir, "math.test.js");
      const currentMath = readFileSync(mathJsPath, "utf-8");
      readFileSync(mathTestPath, "utf-8");

      // Add add function
      const updatedMath = currentMath + "\nexport function add(a, b) { return a + b; }\n";
      const updatedMathTest =
        `import { subtract, add } from "./math.js";\n` +
        `if (subtract(5, 2) !== 3) throw new Error("test failed");\n` +
        `if (add(2, 3) !== 5) throw new Error("add failed");\n` +
        `console.log("math tests pass");\n`;

      execFileSync(process.execPath, ["-e", `fs.writeFileSync(process.argv[1], process.argv[2])`, mathJsPath, updatedMath]);
      execFileSync(process.execPath, ["-e", `fs.writeFileSync(process.argv[1], process.argv[2])`, mathTestPath, updatedMathTest]);

      // Run unit test in fixture repo
      const testARes = spawnSync(process.execPath, ["math.test.js"], { cwd: repoDir, encoding: "utf-8" });
      assert.equal(testARes.status, 0, `math.test.js failed: ${testARes.stderr}`);
      assert.ok(testARes.stdout.includes("math tests pass"));

      // Commit changes in fixture repo
      execFileSync("git", ["add", "math.js", "math.test.js"], { cwd: repoDir, stdio: "pipe" });
      execFileSync("git", ["commit", "-m", "Implement add function"], { cwd: repoDir, stdio: "pipe" });
      const headA = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoDir, encoding: "utf-8" }).trim();

      // 2.4 Submit Completed Handoff for Task A using documented payload structure
      const handoffARes = runCli(["handoff", "submit"], {
        cwd: repoDir,
        home: homeDir,
        input: {
          schemaVersion: 1,
          projectId,
          actorId: "muse",
          requestId: "muse-handoff-a-1",
          payload: {
            taskId: taskAId,
            claimToken: claimTokenA,
            outcome: "completed",
            summary: "Implemented add(a, b) in math.js and verified with math.test.js.",
            evidence: {
              checkoutRoot: repoDir,
              head: headA,
              dirty: false,
              files: [
                { path: "math.js", change: "modified" },
                { path: "math.test.js", change: "modified" }
              ],
              checks: [
                { command: "node math.test.js", outcome: "passed", summary: "All tests passed" }
              ]
            },
            unresolved: [],
            nextSteps: ["Task B can now be implemented using add(a, b)"],
            blockingQuestionIds: []
          }
        }
      });
      assert.equal(handoffARes.status, 0, `Handoff A failed: ${handoffARes.stderr || JSON.stringify(handoffARes.error)}`);
      assert.equal(handoffARes.data.task.status, "completed");

      // Step 3: Flash actions
      // 3.1 Retrieve Task B Context
      const ctxBRes = runCli(["context", "get"], {
        cwd: repoDir,
        home: homeDir,
        input: {
          schemaVersion: 1,
          projectId,
          payload: { taskId: taskBId, mode: "work" }
        }
      });
      assert.equal(ctxBRes.status, 0);
      assert.equal(ctxBRes.data.snapshot.dependencies[0].status, "completed");

      // 3.2 Claim Task B
      const claimBRes = runCli(["task", "claim"], {
        cwd: repoDir,
        home: homeDir,
        input: {
          schemaVersion: 1,
          projectId,
          actorId: "flash",
          requestId: "flash-claim-b-1",
          payload: { taskId: taskBId }
        }
      });
      assert.equal(claimBRes.status, 0);
      const claimTokenB = claimBRes.data.claimToken;
      assert.ok(claimTokenB);

      // 3.3 Ask Muse a Clarification Question
      const askRes = runCli(["question", "ask"], {
        cwd: repoDir,
        home: homeDir,
        input: {
          schemaVersion: 1,
          projectId,
          actorId: "flash",
          requestId: "flash-ask-b-1",
          payload: {
            taskId: taskBId,
            toAgentId: "muse",
            body: "Should multiply handle negative multiplier using repeated subtraction or direct multiplication?"
          }
        }
      });
      assert.equal(askRes.status, 0);
      const questionId = askRes.data.question.id;
      assert.ok(questionId);

      // 3.4 Submit Blocked Handoff
      const handoffBBlockedRes = runCli(["handoff", "submit"], {
        cwd: repoDir,
        home: homeDir,
        input: {
          schemaVersion: 1,
          projectId,
          actorId: "flash",
          requestId: "flash-handoff-b-blocked",
          payload: {
            taskId: taskBId,
            claimToken: claimTokenB,
            outcome: "blocked",
            summary: "Blocked pending clarification on negative multiplier handling in multiply().",
            evidence: {
              checkoutRoot: repoDir,
              head: headA,
              dirty: false,
              files: [],
              checks: []
            },
            unresolved: ["Clarification requested from Muse"],
            nextSteps: ["Await answer, reopen Task B, and complete implementation"],
            blockingQuestionIds: [questionId]
          }
        }
      });
      assert.equal(handoffBBlockedRes.status, 0);
      assert.equal(handoffBBlockedRes.data.task.status, "blocked");

      // Step 4: Muse answers & Flash resumes
      // 4.1 Muse checks inbox
      const museInboxRes = runCli(["inbox", "list"], {
        cwd: repoDir,
        home: homeDir,
        input: {
          schemaVersion: 1,
          projectId,
          actorId: "muse",
          payload: { after: 0, limit: 20 }
        }
      });
      assert.equal(museInboxRes.status, 0);
      assert.equal(museInboxRes.data.events.length, 1);
      assert.equal(museInboxRes.data.events[0].kind, "question");
      assert.equal(museInboxRes.data.events[0].questionId, questionId);

      // Muse answers
      const ansRes = runCli(["question", "answer"], {
        cwd: repoDir,
        home: homeDir,
        input: {
          schemaVersion: 1,
          projectId,
          actorId: "muse",
          requestId: "muse-ans-1",
          payload: {
            questionId,
            body: "Use standard JavaScript multiplication a * b directly for clarity."
          }
        }
      });
      assert.equal(ansRes.status, 0);

      // 4.2 Flash checks inbox
      const flashInboxRes = runCli(["inbox", "list"], {
        cwd: repoDir,
        home: homeDir,
        input: {
          schemaVersion: 1,
          projectId,
          actorId: "flash",
          payload: { after: 0, limit: 20 }
        }
      });
      assert.equal(flashInboxRes.status, 0);
      assert.equal(flashInboxRes.data.events.length, 1);
      assert.equal(flashInboxRes.data.events[0].kind, "answer");

      // Flash reopens Task B
      const reopenRes = runCli(["task", "reopen"], {
        cwd: repoDir,
        home: homeDir,
        input: {
          schemaVersion: 1,
          projectId,
          actorId: "flash",
          requestId: "flash-reopen-b-1",
          payload: { taskId: taskBId }
        }
      });
      assert.equal(reopenRes.status, 0);
      assert.equal(reopenRes.data.task.status, "open");

      // Flash reclaims Task B (attempt 2)
      const claimB2Res = runCli(["task", "claim"], {
        cwd: repoDir,
        home: homeDir,
        input: {
          schemaVersion: 1,
          projectId,
          actorId: "flash",
          requestId: "flash-claim-b-2",
          payload: { taskId: taskBId }
        }
      });
      assert.equal(claimB2Res.status, 0);
      assert.equal(claimB2Res.data.task.attempt, 2);
      const claimTokenB2 = claimB2Res.data.claimToken;
      assert.ok(claimTokenB2);

      // 4.3 Implement multiply and test
      const currentMathAfterA = readFileSync(mathJsPath, "utf-8");
      const updatedMathWithMultiply = currentMathAfterA + "\nexport function multiply(a, b) { return a * b; }\n";
      const updatedMathTestWithMultiply =
        `import { subtract, add, multiply } from "./math.js";\n` +
        `if (subtract(5, 2) !== 3) throw new Error("test failed");\n` +
        `if (add(2, 3) !== 5) throw new Error("add failed");\n` +
        `if (multiply(3, 4) !== 12) throw new Error("multiply failed");\n` +
        `console.log("math tests pass");\n`;

      execFileSync(process.execPath, ["-e", `fs.writeFileSync(process.argv[1], process.argv[2])`, mathJsPath, updatedMathWithMultiply]);
      execFileSync(process.execPath, ["-e", `fs.writeFileSync(process.argv[1], process.argv[2])`, mathTestPath, updatedMathTestWithMultiply]);

      const testBRes = spawnSync(process.execPath, ["math.test.js"], { cwd: repoDir, encoding: "utf-8" });
      assert.equal(testBRes.status, 0);

      execFileSync("git", ["add", "math.js", "math.test.js"], { cwd: repoDir, stdio: "pipe" });
      execFileSync("git", ["commit", "-m", "Implement multiply function"], { cwd: repoDir, stdio: "pipe" });
      const headB = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoDir, encoding: "utf-8" }).trim();

      // 4.4 Submit Completed Handoff for Task B
      const handoffBCompletedRes = runCli(["handoff", "submit"], {
        cwd: repoDir,
        home: homeDir,
        input: {
          schemaVersion: 1,
          projectId,
          actorId: "flash",
          requestId: "flash-handoff-b-completed",
          payload: {
            taskId: taskBId,
            claimToken: claimTokenB2,
            outcome: "completed",
            summary: "Implemented multiply(a, b) in math.js using standard multiplication and verified with math.test.js.",
            evidence: {
              checkoutRoot: repoDir,
              head: headB,
              dirty: false,
              files: [
                { path: "math.js", change: "modified" },
                { path: "math.test.js", change: "modified" }
              ],
              checks: [
                { command: "node math.test.js", outcome: "passed", summary: "All tests passed" }
              ]
            },
            unresolved: [],
            nextSteps: ["Two-agent arithmetic features complete"],
            blockingQuestionIds: []
          }
        }
      });
      assert.equal(handoffBCompletedRes.status, 0);
      assert.equal(handoffBCompletedRes.data.task.status, "completed");

      // Step 5: Fresh Session Verification
      const freshContextRes = runCli(["context", "get"], {
        cwd: repoDir,
        home: homeDir,
        input: {
          schemaVersion: 1,
          projectId,
          payload: { taskId: taskBId, mode: "work" }
        }
      });
      assert.equal(freshContextRes.status, 0);
      const snapshot = freshContextRes.data.snapshot;
      assert.equal(snapshot.task.status, "completed");
      assert.equal(snapshot.dependencies[0].status, "completed");
      assert.equal(snapshot.handoffs.length, 3, "Snapshot includes handoffs across task B (2) and dependency A (1)");
      assert.equal(snapshot.handoffs.filter((h: any) => h.taskId === taskBId).length, 2, "Task B must record both blocked and completed handoffs in history");
      assert.equal(snapshot.handoffs.filter((h: any) => h.taskId === taskAId).length, 1, "Task A completed handoff must be retained via dependency");
      assert.equal(snapshot.questions.length, 1, "Question must be preserved in snapshot");
      assert.ok(snapshot.questions[0].answer, "Answer must be attached to question in snapshot");
    } finally {
      rmSync(targetDir, { recursive: true, force: true });
    }
  });
});
