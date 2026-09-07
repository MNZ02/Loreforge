import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  closeCore,
  execErr,
  execOk,
  mutRequest,
  openTestCore,
  readRequest,
  type TestCore,
} from "../support/harness.js";
import { runCoreChild } from "../support/proc.js";
import {
  flowAnswer,
  flowAsk,
  flowClaim,
  flowCreate,
  flowSubmit,
  setupFlow,
} from "../support/flow.js";
import type { InboxListData, Question, Task } from "../../src/core/contracts.js";

async function getTask(env: { held: TestCore; projectId: string }, taskId: string): Promise<Task> {
  const data = await execOk<{ task: Task }>(
    env.held.core,
    readRequest("task.get", env.projectId, { taskId }),
  );
  return data.task;
}

function inboxRequest(projectId: string, actorId: string, payload: unknown): unknown {
  return { schemaVersion: 1, operation: "inbox.list", projectId, actorId, payload };
}

describe("blocked handoff and reopen (A12)", () => {
  it("releases claim, requires answers, then reclaims and completes", async () => {
    const env = await setupFlow();
    try {
      const task = await flowCreate(env, "muse", "t-1");
      const { claimToken } = await flowClaim(env, "muse", "claim-1", task.id);
      const question = await flowAsk(env, "muse", "ask-1", task.id, "flash", "Which API?");
      const blocked = await flowSubmit(env, "muse", "submit-blocked", task.id, claimToken, {
        outcome: "blocked",
        blockingQuestionIds: [question.id],
      });
      assert.equal(blocked.task.status, "blocked");
      assert.equal(blocked.task.ownerId, null);

      // Cannot reopen while the linked question is unanswered.
      const early = await execErr(
        env.held.core,
        mutRequest("task.reopen", env.projectId, "muse", "reopen-early", { taskId: task.id }),
      );
      assert.equal(early.code, "CONFLICT");

      // Answering alone does not change task status.
      await flowAnswer(env, "flash", "answer-1", question.id, "Use v2.");
      assert.equal((await getTask(env, task.id)).status, "blocked");

      // Any registered actor can reopen once every linked question is answered.
      const reopened = await execOk<{ task: Task }>(
        env.held.core,
        mutRequest("task.reopen", env.projectId, "flash", "reopen-1", { taskId: task.id }),
      );
      assert.equal(reopened.task.status, "open");

      // Reclaim starts a new attempt; an optional unanswered question does not
      // prevent the final completion.
      const next = await flowClaim(env, "flash", "claim-2", task.id);
      assert.equal(next.task.attempt, 2);
      await flowAsk(env, "flash", "ask-2", task.id, "muse", "Optional?");
      const done = await flowSubmit(env, "flash", "submit-done", task.id, next.claimToken);
      assert.equal(done.task.status, "completed");
      assert.equal(done.handoff.attempt, 2);
    } finally {
      env.cleanup();
    }
  });
});

describe("question and answer receipts (A13)", () => {
  it("retries yield one question and one event each", async () => {
    const env = await setupFlow();
    try {
      const task = await flowCreate(env, "muse", "t-1");
      const first = await flowAsk(env, "muse", "ask-1", task.id, "flash", "Q?");
      const replay = await flowAsk(env, "muse", "ask-1", task.id, "flash", "Q?");
      assert.deepEqual(replay, first);

      const flashInbox = await execOk<InboxListData>(
        env.held.core,
        inboxRequest(env.projectId, "flash", {}),
      );
      const questionEvents = flashInbox.events.filter((e) => e.questionId === first.id);
      assert.equal(questionEvents.length, 1);
      assert.equal(questionEvents[0].kind, "question");

      const answered = await flowAnswer(env, "flash", "answer-1", first.id, "A.");
      assert.ok(answered.answer !== null);
      const replayAnswer = await flowAnswer(env, "flash", "answer-1", first.id, "A.");
      assert.deepEqual(replayAnswer, answered);

      const museInbox = await execOk<InboxListData>(
        env.held.core,
        inboxRequest(env.projectId, "muse", {}),
      );
      const answerEvents = museInbox.events.filter((e) => e.questionId === first.id);
      assert.equal(answerEvents.length, 1);
      assert.equal(answerEvents[0].kind, "answer");
    } finally {
      env.cleanup();
    }
  });

  it("rejects wrong recipients and concurrent double answers", async () => {
    const env = await setupFlow();
    try {
      const task = await flowCreate(env, "muse", "t-1");
      const question = await flowAsk(env, "muse", "ask-1", task.id, "flash", "Q?");
      const wrong = await execErr(
        env.held.core,
        mutRequest("question.answer", env.projectId, "muse", "answer-wrong", {
          questionId: question.id,
          body: "Impostor answer.",
        }),
      );
      assert.equal(wrong.code, "CONFLICT");

      const gate = join(env.held.home, "gate");
      const answerFor = (requestId: string): unknown =>
        mutRequest("question.answer", env.projectId, "flash", requestId, {
          questionId: question.id,
          body: `Answer ${requestId}.`,
        });
      const pendingA = runCoreChild(env.held.home, answerFor("answer-a"), { gate });
      const pendingB = runCoreChild(env.held.home, answerFor("answer-b"), { gate });
      await new Promise((resolve) => setTimeout(resolve, 5000));
      writeFileSync(gate, "go\n");
      const [resultA, resultB] = await Promise.all([pendingA, pendingB]);
      assert.equal(resultA.exitCode, 0, resultA.stderr);
      assert.equal(resultB.exitCode, 0, resultB.stderr);
      const wins = [resultA.response, resultB.response].filter((r) => r?.ok === true);
      const losses = [resultA.response, resultB.response].filter((r) => r?.ok === false);
      assert.equal(wins.length, 1);
      assert.equal(losses.length, 1);
      assert.equal(
        (losses[0] as Extract<NonNullable<typeof losses[0]>, { ok: false }>).error.code,
        "CONFLICT",
      );

      // Exactly one answer won: a fresh answer conflicts and the asker has a
      // single answer event.
      const late = await execErr(
        env.held.core,
        mutRequest("question.answer", env.projectId, "flash", "answer-late", {
          questionId: question.id,
          body: "Too late.",
        }),
      );
      assert.equal(late.code, "CONFLICT");
      const museInbox = await execOk<InboxListData>(
        env.held.core,
        inboxRequest(env.projectId, "muse", {}),
      );
      assert.equal(museInbox.events.filter((e) => e.questionId === question.id).length, 1);

      // Answer records survive restarts: the persisted answer still blocks.
      closeCore(env.held.core);
      const reopened: TestCore = openTestCore(env.held.home);
      try {
        const afterRestart = await execErr(
          reopened.core,
          mutRequest("question.answer", env.projectId, "flash", "answer-restart", {
            questionId: question.id,
            body: "After restart.",
          }),
        );
        assert.equal(afterRestart.code, "CONFLICT");
      } finally {
        closeCore(reopened.core);
      }
    } finally {
      env.cleanup();
    }
  });

  it("rejects questions on terminal tasks and foreign question IDs", async () => {
    const env = await setupFlow();
    try {
      const task = await flowCreate(env, "muse", "t-1");
      const { claimToken } = await flowClaim(env, "muse", "claim-1", task.id);
      await flowSubmit(env, "muse", "submit-1", task.id, claimToken);
      const onTerminal = await execErr(
        env.held.core,
        mutRequest("question.ask", env.projectId, "muse", "ask-t", {
          taskId: task.id,
          toAgentId: "flash",
          body: "Too late?",
        }),
      );
      assert.equal(onTerminal.code, "CONFLICT");
      // Answers remain permitted after terminal state.
      const live = await flowCreate(env, "muse", "t-2");
      const q = await flowAsk(env, "muse", "ask-2", live.id, "flash", "Q?");
      const { claimToken: token2 } = await flowClaim(env, "muse", "claim-2", live.id);
      await flowSubmit(env, "muse", "submit-2", live.id, token2);
      const answered = await flowAnswer(env, "flash", "answer-2", q.id, "Still helps.");
      assert.ok(answered.answer !== null);

      const foreign = await execErr(
        env.held.core,
        mutRequest("question.answer", "99999999-9999-4999-8999-999999999999", "flash", "answer-x", {
          questionId: q.id,
          body: "Wrong project.",
        }),
      );
      assert.equal(foreign.code, "NOT_FOUND");
    } finally {
      env.cleanup();
    }
  });
});

describe("inbox cursors (A14)", () => {
  it("pages without loss or duplication and never consumes", async () => {
    const env = await setupFlow();
    try {
      const task = await flowCreate(env, "muse", "t-1");
      const q1 = await flowAsk(env, "muse", "ask-1", task.id, "flash", "One?");
      const q2 = await flowAsk(env, "muse", "ask-2", task.id, "flash", "Two?");
      const q3 = await flowAsk(env, "muse", "ask-3", task.id, "flash", "Three?");
      await flowAnswer(env, "flash", "answer-1", q1.id, "First answer.");
      await flowAsk(env, "flash", "ask-4", task.id, "muse", "Back at you?");

      const page1 = await execOk<InboxListData>(
        env.held.core,
        inboxRequest(env.projectId, "flash", { limit: 2 }),
      );
      assert.equal(page1.events.length, 2);
      assert.equal(page1.hasMore, true);
      const page2 = await execOk<InboxListData>(
        env.held.core,
        inboxRequest(env.projectId, "flash", { after: page1.nextCursor }),
      );
      assert.equal(page2.events.map((e) => e.questionId).join(","), [q3.id].join(","));
      assert.equal(page2.hasMore, false);
      const seen = [...page1.events, ...page2.events].map((e) => e.id);
      assert.deepEqual(seen, [...seen].sort((a, b) => a - b));
      assert.equal(new Set(seen).size, 3);

      // Empty page preserves the cursor; rereads are identical (no consume).
      const empty = await execOk<InboxListData>(
        env.held.core,
        inboxRequest(env.projectId, "flash", { after: page2.nextCursor }),
      );
      assert.deepEqual(empty.events, []);
      assert.equal(empty.nextCursor, page2.nextCursor);
      assert.equal(empty.hasMore, false);
      const repeat = await execOk<InboxListData>(
        env.held.core,
        inboxRequest(env.projectId, "flash", { limit: 2 }),
      );
      assert.deepEqual(repeat, page1);

      // Recipient and project scoping: muse sees its own events only.
      const museInbox = await execOk<InboxListData>(
        env.held.core,
        inboxRequest(env.projectId, "muse", {}),
      );
      assert.ok(museInbox.events.every((e) => e.recipientId === "muse"));
      assert.ok(museInbox.events.some((e) => e.kind === "answer" && e.questionId === q1.id));
      assert.ok(!museInbox.events.some((e) => e.questionId === q2.id));
    } finally {
      env.cleanup();
    }
  });
});
