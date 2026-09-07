import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  execErr,
  execOk,
  gitHead,
  mutRequest,
  readRequest,
  removeDir,
} from "../support/harness.js";
import {
  flowAnswer,
  flowAsk,
  flowClaim,
  flowCreate,
  flowSubmit,
  setupFlow,
} from "../support/flow.js";
import type {
  ContextSnapshot,
  Decision,
  Handoff,
  Question,
  Task,
} from "../../src/core/contracts.js";

async function getSnapshot(
  env: { held: { core: { execute: (r: unknown) => Promise<unknown> } }; projectId: string },
  taskId: string,
  mode?: "work" | "review",
): Promise<ContextSnapshot> {
  const response = (await env.held.core.execute(
    readRequest("context.get", env.projectId, mode === undefined ? { taskId } : { taskId, mode }),
  )) as { ok: boolean; data?: { snapshot: ContextSnapshot }; error?: { code: string } };
  assert.equal(response.ok, true);
  return (response.data as { snapshot: ContextSnapshot }).snapshot;
}

async function recordDecision(
  env: { held: { core: { execute: (r: unknown) => Promise<unknown> } }; projectId: string },
  actor: string,
  requestId: string,
  body: string,
  paths: string[],
  supersedesId: string | null = null,
): Promise<Decision> {
  const response = (await env.held.core.execute(
    mutRequest("decision.record", env.projectId, actor, requestId, { body, paths, supersedesId }),
  )) as { ok: boolean; data?: { decision: Decision } };
  assert.equal(response.ok, true);
  return (response.data as { decision: Decision }).decision;
}

describe("context selection (work mode)", () => {
  it("selects task, dependencies, handoffs, questions, and relevant decisions", async () => {
    const env = await setupFlow();
    try {
      const dep = await flowCreate(env, "muse", "dep-1");
      const depClaim = await flowClaim(env, "muse", "claim-dep", dep.id);
      await flowSubmit(env, "muse", "submit-dep", dep.id, depClaim.claimToken, {
        files: [{ path: "src/a.ts", change: "added" }],
      });
      const task = await flowCreate(env, "muse", "t-1", [dep.id]);
      const claim = await flowClaim(env, "flash", "claim-t", task.id);
      const question = await flowAsk(env, "flash", "ask-1", task.id, "muse", "Blocking?");
      await flowSubmit(env, "flash", "submit-t", task.id, claim.claimToken, {
        files: [{ path: "src/a.ts", change: "modified" }],
      });

      const wide = await recordDecision(env, "muse", "dec-wide", "Always test.", []);
      const matching = await recordDecision(env, "muse", "dec-match", "Touch a.ts carefully.", ["src/a.ts"]);
      await recordDecision(env, "muse", "dec-other", "Unrelated.", ["other/x.ts"]);
      const superseded = await recordDecision(env, "muse", "dec-old", "Old rule.", []);
      await recordDecision(env, "flash", "dec-new", "New rule.", [], superseded.id);

      const snapshot = await getSnapshot(env, task.id);
      assert.equal(snapshot.mode, "work");
      assert.equal(snapshot.task.id, task.id);
      assert.equal(snapshot.project.id, env.projectId);
      assert.deepEqual(snapshot.dependencies.map((d: Task) => d.id), [dep.id]);

      // Current task and direct dependencies, newest first.
      assert.equal(snapshot.handoffs.length, 2);
      assert.equal(snapshot.handoffs[0].taskId, task.id);
      assert.equal(snapshot.handoffs[1].taskId, dep.id);
      const workHandoff = snapshot.handoffs[0] as Handoff;
      assert.equal(typeof workHandoff.summary, "string");

      // Current task only: the dependency's questions never appear here.
      assert.equal(snapshot.questions.length, 1);
      assert.equal((snapshot.questions[0] as Question).id, question.id);

      // Active wide decisions plus exact path matches; superseded and
      // unrelated-path decisions stay out.
      const ids = snapshot.decisions.map((d: Decision) => d.id);
      assert.ok(ids.includes(wide.id));
      assert.ok(ids.includes(matching.id));
      assert.ok(!ids.includes(superseded.id));
      assert.ok(snapshot.decisions.some((d: Decision) => d.id === snapshot.decisions.find((x: Decision) => x.body === "New rule.")?.id));

      assert.deepEqual(snapshot.omitted, {
        handoffs: 0,
        questions: 0,
        decisions: 0,
        policy: { handoffNarratives: false, questions: 0 },
      });
      assert.equal(snapshot.currentGit.head, gitHead(env.repo));
      assert.equal(snapshot.currentGit.dirty, false);
      assert.equal(snapshot.currentGit.error, null);
      assert.ok(Date.parse(snapshot.currentGit.collectedAt) > 0);
    } finally {
      env.cleanup();
    }
  });

  it("orders unanswered questions first", async () => {
    const env = await setupFlow();
    try {
      const task = await flowCreate(env, "muse", "t-1");
      const q1 = await flowAsk(env, "muse", "ask-1", task.id, "flash", "First?");
      const q2 = await flowAsk(env, "muse", "ask-2", task.id, "flash", "Second?");
      await flowAnswer(env, "flash", "answer-1", q1.id, "Answered.");
      const snapshot = await getSnapshot(env, task.id);
      assert.equal(snapshot.questions.length, 2);
      assert.equal((snapshot.questions[0] as Question).id, q2.id);
      assert.equal((snapshot.questions[1] as Question).id, q1.id);
      assert.ok((snapshot.questions[1] as Question).answer !== null);
    } finally {
      env.cleanup();
    }
  });
});

describe("context review mode", () => {
  it("omits prose and Q&A from selection while keeping evidence and decisions", async () => {
    let current = 1_700_000_000_000;
    const env = await setupFlow(() => current);
    try {
      const task = await flowCreate(env, "muse", "t-1");
      const claim = await flowClaim(env, "muse", "claim-1", task.id);
      await flowAsk(env, "muse", "ask-1", task.id, "flash", "Secret plan?");
      await flowAsk(env, "muse", "ask-2", task.id, "flash", "Another?");
      await flowSubmit(env, "muse", "submit-1", task.id, claim.claimToken, {
        summary: "Implementation details reviewers must not see.",
      });
      const wide = await recordDecision(env, "muse", "dec-wide", "Always test.", []);

      const work = await getSnapshot(env, task.id, "work");
      const review = await getSnapshot(env, task.id, "review");
      assert.equal(review.mode, "review");

      // No question bodies anywhere in review selection.
      assert.deepEqual(review.questions, []);
      assert.equal(review.omitted.questions, 0);
      assert.equal(review.omitted.policy.questions, 2);
      assert.equal(review.omitted.policy.handoffNarratives, true);

      // Handoffs keep identity, evidence, observed data, outcome metadata,
      // and blocking IDs, but no narrative fields.
      assert.equal(review.handoffs.length, 1);
      const serialized = JSON.stringify(review.handoffs);
      assert.ok(!serialized.includes("Implementation details reviewers must not see."));
      const stripped = review.handoffs[0] as Record<string, unknown>;
      for (const key of ["summary", "unresolved", "nextSteps"]) {
        assert.ok(!(key in stripped), key);
      }
      for (const key of ["id", "taskId", "outcome", "evidence", "observed", "blockingQuestionIds"]) {
        assert.ok(key in stripped, key);
      }

      // Decisions match work mode exactly.
      assert.deepEqual(
        review.decisions.map((d: Decision) => d.id),
        work.decisions.map((d: Decision) => d.id),
      );
      assert.ok(review.decisions.some((d: Decision) => d.id === wide.id));

      // Deterministic for the same snapshot and clock.
      current += 0;
      const again = await getSnapshot(env, task.id, "review");
      assert.deepEqual(again, review);
    } finally {
      env.cleanup();
    }
  });
});

describe("context caps and omitted counts", () => {
  it("caps handoffs at 20 across task and dependencies", async () => {
    const env = await setupFlow();
    try {
      const depIds: string[] = [];
      for (let i = 0; i < 20; i += 1) {
        const dep = await flowCreate(env, "muse", `dep-${i}`);
        const claim = await flowClaim(env, "muse", `claim-dep-${i}`, dep.id);
        await flowSubmit(env, "muse", `submit-dep-${i}`, dep.id, claim.claimToken);
        depIds.push(dep.id);
      }
      const task = await flowCreate(env, "muse", "t-cap", depIds);
      const claim = await flowClaim(env, "muse", "claim-t", task.id);
      await flowSubmit(env, "muse", "submit-t", task.id, claim.claimToken);
      const snapshot = await getSnapshot(env, task.id);
      assert.equal(snapshot.handoffs.length, 20);
      assert.equal(snapshot.omitted.handoffs, 1);
      assert.equal(snapshot.handoffs[0].taskId, task.id);
    } finally {
      env.cleanup();
    }
  });

  it("caps questions and decisions at 20 with accurate omissions", async () => {
    const env = await setupFlow();
    try {
      const task = await flowCreate(env, "muse", "t-1");
      for (let i = 0; i < 21; i += 1) {
        await flowAsk(env, "muse", `ask-${i}`, task.id, "flash", `Question ${i}?`);
      }
      for (let i = 0; i < 21; i += 1) {
        await recordDecision(env, "muse", `dec-${i}`, `Rule ${i}.`, []);
      }
      const snapshot = await getSnapshot(env, task.id);
      assert.equal(snapshot.questions.length, 20);
      assert.equal(snapshot.omitted.questions, 1);
      assert.equal(snapshot.decisions.length, 20);
      assert.equal(snapshot.omitted.decisions, 1);
    } finally {
      env.cleanup();
    }
  });
});

describe("context robustness", () => {
  it("survives a missing registered checkout", async () => {
    const env = await setupFlow();
    try {
      const task = await flowCreate(env, "muse", "t-1");
      removeDir(env.repo);
      const snapshot = await getSnapshot(env, task.id);
      assert.equal(snapshot.task.id, task.id);
      assert.equal(snapshot.currentGit.head, null);
      assert.equal(snapshot.currentGit.dirty, null);
      assert.equal(typeof snapshot.currentGit.error, "string");
      assert.ok(Date.parse(snapshot.currentGit.collectedAt) > 0);
    } finally {
      env.cleanup();
    }
  });

  it("rejects foreign tasks without leaking", async () => {
    const env = await setupFlow();
    try {
      const task = await flowCreate(env, "muse", "t-1");
      const foreign = await execErr(
        env.held.core,
        readRequest("context.get", "99999999-9999-4999-8999-999999999999", { taskId: task.id }),
      );
      assert.equal(foreign.code, "NOT_FOUND");
      const missing = await execErr(
        env.held.core,
        readRequest("context.get", env.projectId, {
          taskId: "99999999-9999-4999-8999-999999999999",
        }),
      );
      assert.equal(missing.code, "NOT_FOUND");
      assert.ok(!JSON.stringify(missing).includes("Task t-1"));
    } finally {
      env.cleanup();
    }
  });
});

describe("completion tails (A05/A06 endings)", () => {
  it("reclaimed tasks complete once; late original tokens change nothing", async () => {
    let current = 1_700_000_000_000;
    const env = await setupFlow(() => current);
    try {
      const task = await flowCreate(env, "muse", "t-1");
      const first = await flowClaim(env, "muse", "claim-1", task.id);
      current += 2 * 60 * 60 * 1000 + 1;
      const second = await flowClaim(env, "flash", "claim-2", task.id);
      assert.equal(second.task.attempt, 2);
      const done = await flowSubmit(env, "flash", "submit-2", task.id, second.claimToken);
      assert.equal(done.handoff.attempt, 2);
      const late = await execErr(
        env.held.core,
        mutRequest("handoff.submit", env.projectId, "muse", "submit-late", {
          taskId: task.id,
          claimToken: first.claimToken,
          outcome: "completed",
          summary: "Late.",
          evidence: {
            checkoutRoot: env.repo,
            head: gitHead(env.repo),
            dirty: false,
            files: [],
            checks: [],
          },
          unresolved: [],
          nextSteps: [],
          blockingQuestionIds: [],
        }),
      );
      assert.equal(late.code, "STALE_CLAIM");
      const snapshot = await getSnapshot(env, task.id);
      assert.equal(snapshot.handoffs.length, 1);
      void done;
    } finally {
      env.cleanup();
    }
  });

  it("unblocks dependent claims once the dependency completes", async () => {
    const env = await setupFlow();
    try {
      const first = await flowCreate(env, "muse", "t-a");
      const second = await flowCreate(env, "muse", "t-b", [first.id]);
      const blocked = await execErr(
        env.held.core,
        mutRequest("task.claim", env.projectId, "muse", "claim-b-early", { taskId: second.id }),
      );
      assert.equal(blocked.code, "CONFLICT");
      const claimA = await flowClaim(env, "muse", "claim-a", first.id);
      await flowSubmit(env, "muse", "submit-a", first.id, claimA.claimToken);
      const claimB = await flowClaim(env, "muse", "claim-b", second.id);
      assert.equal(claimB.task.status, "running");
    } finally {
      env.cleanup();
    }
  });
});
