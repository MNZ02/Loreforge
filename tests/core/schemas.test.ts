import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ZodError } from "zod";
import {
  OPERATIONS,
  parseRequest,
  type Operation,
  type Request,
} from "../../src/core/contracts.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const TASK_ID = "22222222-2222-4222-8222-222222222222";
const QUESTION_ID = "33333333-3333-4333-8333-333333333333";
const HEAD = "0".repeat(40);

function evidence() {
  return {
    checkoutRoot: "/tmp/example-checkout",
    head: HEAD,
    dirty: false,
    files: [{ path: "src/a.ts", change: "added" }],
    checks: [{ command: "npm run test:core", outcome: "passed", summary: "all green" }],
  };
}

function handoffPayload() {
  return {
    taskId: TASK_ID,
    claimToken: "claim-token-1",
    outcome: "completed",
    summary: "done",
    evidence: evidence(),
    unresolved: [],
    nextSteps: ["verify"],
    blockingQuestionIds: [],
  };
}

// A fully valid envelope per operation, following the contract tables.
export function validEnvelope(operation: Operation): Record<string, unknown> {
  switch (operation) {
    case "project.list": case "agent.list":
      return { schemaVersion: 1, operation, payload: {} };
    case "decision.list": case "index.check":
      return { schemaVersion: 1, operation, projectId: PROJECT_ID, payload: {} };
    case "note.history":
      return { schemaVersion: 1, operation, projectId: PROJECT_ID, payload: { noteId: TASK_ID } };
    case "review.list":
      return { schemaVersion: 1, operation, projectId: PROJECT_ID, payload: { handoffId: TASK_ID } };
    case "review.record":
      return { schemaVersion: 1, operation, projectId: PROJECT_ID, actorId: "muse", requestId: "review-1", payload: { handoffId: TASK_ID, observedCommit: HEAD, outcome: "approved", body: "Reviewed" } };
    case "index.rebuild":
      return { schemaVersion: 1, operation, projectId: PROJECT_ID, actorId: "muse", requestId: "rebuild-1", payload: {} };
    case "project.register":
      return {
        schemaVersion: 1,
        operation,
        requestId: "register-1",
        payload: { root: "/tmp/example-repo", name: "Example" },
      };
    case "agent.register":
      return {
        schemaVersion: 1,
        operation,
        requestId: "register-2",
        payload: { id: "muse", displayName: "Muse" },
      };
    case "task.create":
      return {
        schemaVersion: 1,
        operation,
        projectId: PROJECT_ID,
        actorId: "muse",
        requestId: "create-1",
        payload: { title: "First task", description: "Do it", dependsOn: [] },
      };
    case "task.get":
      return {
        schemaVersion: 1,
        operation,
        projectId: PROJECT_ID,
        payload: { taskId: TASK_ID },
      };
    case "task.list":
      return { schemaVersion: 1, operation, projectId: PROJECT_ID, payload: {} };
    case "task.claim":
      return {
        schemaVersion: 1,
        operation,
        projectId: PROJECT_ID,
        actorId: "muse",
        requestId: "claim-1",
        payload: { taskId: TASK_ID },
      };
    case "task.renew":
    case "task.release":
      return {
        schemaVersion: 1,
        operation,
        projectId: PROJECT_ID,
        actorId: "muse",
        requestId: `${operation}-1`,
        payload: { taskId: TASK_ID, claimToken: "claim-token-1" },
      };
    case "task.reopen":
    case "task.cancel":
      return {
        schemaVersion: 1,
        operation,
        projectId: PROJECT_ID,
        actorId: "muse",
        requestId: `${operation}-1`,
        payload: { taskId: TASK_ID },
      };
    case "handoff.submit":
      return {
        schemaVersion: 1,
        operation,
        projectId: PROJECT_ID,
        actorId: "muse",
        requestId: "handoff-1",
        payload: handoffPayload(),
      };
    case "question.ask":
      return {
        schemaVersion: 1,
        operation,
        projectId: PROJECT_ID,
        actorId: "muse",
        requestId: "ask-1",
        payload: { taskId: TASK_ID, toAgentId: "flash", body: "Which path?" },
      };
    case "question.answer":
      return {
        schemaVersion: 1,
        operation,
        projectId: PROJECT_ID,
        actorId: "flash",
        requestId: "answer-1",
        payload: { questionId: QUESTION_ID, body: "This one." },
      };
    case "inbox.list":
      return {
        schemaVersion: 1,
        operation,
        projectId: PROJECT_ID,
        actorId: "flash",
        payload: { after: 0, limit: 20 },
      };
    case "decision.record":
      return {
        schemaVersion: 1,
        operation,
        projectId: PROJECT_ID,
        actorId: "muse",
        requestId: "decision-1",
        payload: { body: "Use SQLite", paths: [], supersedesId: null },
      };
    case "context.get":
      return {
        schemaVersion: 1,
        operation,
        projectId: PROJECT_ID,
        payload: { taskId: TASK_ID },
      };
    case "note.add":
      return {
        schemaVersion: 1,
        operation,
        projectId: PROJECT_ID,
        actorId: "muse",
        requestId: "note-1",
        payload: {
          title: "Finding",
          finding: "The column is missing.",
          reason: "Resume fails without it.",
          evidenceRefs: ["reports/example.md"],
          paths: ["src/a.ts"],
          observedCommit: null,
          status: "proposed",
          taskId: null,
          supersedesId: null,
        },
      };
    case "note.get":
      return {
        schemaVersion: 1,
        operation,
        projectId: PROJECT_ID,
        payload: { noteId: TASK_ID },
      };
    case "search.query":
      return {
        schemaVersion: 1,
        operation,
        projectId: PROJECT_ID,
        payload: { query: "coupon migration" },
      };
  }
}

describe("contract operations", () => {
  it("defines all twenty-seven operations", () => {
    assert.equal(OPERATIONS.length, 27);
    assert.equal(new Set(OPERATIONS).size, 27);
  });

  for (const operation of OPERATIONS) {
    it(`accepts a valid ${operation} envelope`, () => {
      const parsed: Request = parseRequest(validEnvelope(operation));
      assert.equal(parsed.schemaVersion, 1);
      assert.equal(parsed.operation, operation);
    });
  }

  it("rejects non-object inputs", () => {
    for (const bad of [null, undefined, 42, "x", [], [{ schemaVersion: 1 }]]) {
      assert.throws(() => parseRequest(bad), ZodError, `input ${JSON.stringify(bad)}`);
    }
  });

  it("rejects wrong schemaVersion and unknown operations", () => {
    const base = validEnvelope("task.get");
    assert.throws(() => parseRequest({ ...base, schemaVersion: 2 }), ZodError);
    assert.throws(() => parseRequest({ ...base, schemaVersion: "1" }), ZodError);
    assert.throws(() => parseRequest({ ...base, operation: "task.frob" }), ZodError);
    assert.throws(() => parseRequest({ ...base, payload: null }), ZodError);
    assert.throws(() => parseRequest({ ...base, payload: [1] }), ZodError);
  });

  it("rejects unknown top-level keys", () => {
    const base = validEnvelope("task.get");
    assert.throws(() => parseRequest({ ...base, debug: true }), ZodError);
  });

  it("rejects unknown nested payload keys", () => {
    const base = validEnvelope("task.create") as Record<string, unknown>;
    const payload = base.payload as Record<string, unknown>;
    assert.throws(
      () => parseRequest({ ...base, payload: { ...payload, priority: "high" } }),
      ZodError,
    );
    const handoff = validEnvelope("handoff.submit") as Record<string, unknown>;
    const hpayload = handoff.payload as Record<string, unknown>;
    const hevidence = hpayload.evidence as Record<string, unknown>;
    assert.throws(
      () =>
        parseRequest({
          ...handoff,
          payload: { ...hpayload, evidence: { ...hevidence, sneaky: 1 } },
        }),
      ZodError,
    );
  });
});

describe("envelope field rules", () => {
  it("forbids projectId and actorId on registration operations", () => {
    for (const operation of ["project.register", "agent.register"] as const) {
      const base = validEnvelope(operation);
      assert.throws(() => parseRequest({ ...base, projectId: PROJECT_ID }), ZodError, operation);
      assert.throws(() => parseRequest({ ...base, actorId: "muse" }), ZodError, operation);
    }
  });

  it("requires requestId on registrations and forbids it on reads", () => {
    const reg = validEnvelope("project.register");
    const { requestId: _dropped, ...withoutKey } = reg;
    assert.throws(() => parseRequest(withoutKey), ZodError);
    for (const operation of ["task.get", "task.list", "context.get", "inbox.list", "note.get", "search.query"] as const) {
      const base = validEnvelope(operation);
      assert.throws(() => parseRequest({ ...base, requestId: "r-1" }), ZodError, operation);
    }
  });

  it("forbids actorId on reads other than inbox.list", () => {
    for (const operation of ["task.get", "task.list", "context.get", "note.get", "search.query"] as const) {
      const base = validEnvelope(operation);
      assert.throws(() => parseRequest({ ...base, actorId: "muse" }), ZodError, operation);
    }
    const inbox = validEnvelope("inbox.list");
    const { actorId: _dropped, ...withoutActor } = inbox;
    assert.throws(() => parseRequest(withoutActor), ZodError);
  });

  it("requires projectId, actorId, and requestId on mutations", () => {
    const base = validEnvelope("task.claim") as Record<string, unknown>;
    for (const key of ["projectId", "actorId", "requestId"]) {
      const { [key]: _dropped, ...rest } = base;
      assert.throws(() => parseRequest(rest), ZodError, key);
    }
  });

  it("requires projectId on reads", () => {
    const base = validEnvelope("task.list") as Record<string, unknown>;
    const { projectId: _dropped, ...rest } = base;
    assert.throws(() => parseRequest(rest), ZodError);
  });

  it("rejects omitted required payload fields", () => {
    const create = validEnvelope("task.create") as Record<string, unknown>;
    const payload = create.payload as Record<string, unknown>;
    for (const key of ["title", "description", "dependsOn"]) {
      const { [key]: _dropped, ...rest } = payload;
      assert.throws(() => parseRequest({ ...create, payload: rest }), ZodError, key);
    }
    const decision = validEnvelope("decision.record") as Record<string, unknown>;
    const dpayload = decision.payload as Record<string, unknown>;
    const { supersedesId: _dropped2, ...drest } = dpayload;
    assert.throws(() => parseRequest({ ...decision, payload: drest }), ZodError);
  });

  it("applies read defaults before use", () => {
    const list = parseRequest(validEnvelope("task.list"));
    assert.equal(list.operation, "task.list");
    if (list.operation === "task.list") assert.equal(list.payload.limit, 20);
    const context = parseRequest(validEnvelope("context.get"));
    if (context.operation === "context.get") assert.equal(context.payload.mode, "work");
    const inbox = parseRequest({
      schemaVersion: 1,
      operation: "inbox.list",
      projectId: PROJECT_ID,
      actorId: "flash",
      payload: {},
    });
    if (inbox.operation === "inbox.list") {
      assert.equal(inbox.payload.after, 0);
      assert.equal(inbox.payload.limit, 20);
    }
    const search = parseRequest({
      schemaVersion: 1,
      operation: "search.query",
      projectId: PROJECT_ID,
      payload: { query: "coupon" },
    });
    if (search.operation === "search.query") {
      assert.equal(search.payload.limit, 5);
      assert.deepEqual(search.payload.files, []);
      assert.equal(search.payload.includeSuperseded, false);
    }
  });
});
