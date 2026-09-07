import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ZodError } from "zod";
import {
  LIMITS,
  parseRequest,
  validationDetails,
} from "../../src/core/contracts.js";
import { validEnvelope } from "./schemas.test.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

function mutatePayload(operation: Parameters<typeof validEnvelope>[0], edit: (payload: Record<string, unknown>) => Record<string, unknown>) {
  const base = validEnvelope(operation) as unknown as Record<string, unknown>;
  return { ...base, payload: edit(base.payload as Record<string, unknown>) };
}

function mutateEvidence(edit: (evidence: Record<string, unknown>) => Record<string, unknown>) {
  return mutatePayload("handoff.submit", (payload) => ({
    ...payload,
    evidence: edit(payload.evidence as Record<string, unknown>),
  }));
}

describe("nested limits", () => {
  it("rejects overlong title, description, summary, and bodies", () => {
    assert.throws(
      () =>
        parseRequest(
          mutatePayload("task.create", (p) => ({ ...p, title: "x".repeat(LIMITS.title + 1) })),
        ),
      ZodError,
    );
    assert.throws(
      () =>
        parseRequest(
          mutatePayload("task.create", (p) => ({
            ...p,
            description: "x".repeat(LIMITS.description + 1),
          })),
        ),
      ZodError,
    );
    assert.throws(
      () =>
        parseRequest(
          mutatePayload("handoff.submit", (p) => ({ ...p, summary: "x".repeat(LIMITS.summary + 1) })),
        ),
      ZodError,
    );
    assert.throws(
      () =>
        parseRequest(
          mutatePayload("question.ask", (p) => ({ ...p, body: "x".repeat(LIMITS.body + 1) })),
        ),
      ZodError,
    );
    assert.throws(
      () =>
        parseRequest(
          mutatePayload("decision.record", (p) => ({ ...p, body: "x".repeat(LIMITS.body + 1) })),
        ),
      ZodError,
    );
  });

  it("rejects overlong or oversized list strings", () => {
    assert.throws(
      () =>
        parseRequest(
          mutatePayload("handoff.submit", (p) => ({ ...p, unresolved: ["x".repeat(501)] })),
        ),
      ZodError,
    );
    assert.throws(
      () =>
        parseRequest(
          mutatePayload("handoff.submit", (p) => ({ ...p, nextSteps: Array(21).fill("ok") })),
        ),
      ZodError,
    );
    assert.throws(
      () =>
        parseRequest(
          mutatePayload("task.create", (p) => ({
            ...p,
            dependsOn: Array(21).fill("22222222-2222-4222-8222-222222222222"),
          })),
        ),
      ZodError,
    );
  });

  it("rejects duplicate dependency and blocking-question IDs", () => {
    const dup = "22222222-2222-4222-8222-222222222222";
    assert.throws(
      () => parseRequest(mutatePayload("task.create", (p) => ({ ...p, dependsOn: [dup, dup] }))),
      ZodError,
    );
    assert.throws(
      () =>
        parseRequest(
          mutatePayload("handoff.submit", (p) => ({
            ...p,
            outcome: "blocked",
            blockingQuestionIds: [dup, dup],
          })),
        ),
      ZodError,
    );
  });

  it("rejects oversized evidence files and checks", () => {
    assert.throws(
      () =>
        parseRequest(
          mutateEvidence((e) => ({
            ...e,
            files: Array(101).fill({ path: "a.ts", change: "added" }),
          })),
        ),
      ZodError,
    );
    assert.throws(
      () =>
        parseRequest(
          mutateEvidence((e) => ({
            ...e,
            checks: Array(21).fill({ command: "c", outcome: "passed", summary: "s" }),
          })),
        ),
      ZodError,
    );
    assert.throws(
      () =>
        parseRequest(
          mutateEvidence((e) => ({
            ...e,
            checks: [{ command: "c".repeat(501), outcome: "passed", summary: "s" }],
          })),
        ),
      ZodError,
    );
    assert.throws(
      () =>
        parseRequest(
          mutateEvidence((e) => ({
            ...e,
            checks: [{ command: "c", outcome: "passed", summary: "s".repeat(1001) }],
          })),
        ),
      ZodError,
    );
    assert.throws(
      () =>
        parseRequest(
          mutateEvidence((e) => ({
            ...e,
            checks: [{ command: "c", outcome: "bogus", summary: "s" }],
          })),
        ),
      ZodError,
    );
  });

  it("rejects bad relative paths and duplicate evidence paths", () => {
    for (const bad of [
      "/absolute/path.ts",
      "../escape.ts",
      "a/../../b.ts",
      "",
      "   ",
      "x".repeat(401),
      "nul\0.ts",
    ]) {
      assert.throws(
        () =>
          parseRequest(
            mutateEvidence((e) => ({ ...e, files: [{ path: bad, change: "added" }] })),
          ),
        ZodError,
        JSON.stringify(bad),
      );
    }
    assert.throws(
      () =>
        parseRequest(
          mutateEvidence((e) => ({
            ...e,
            files: [
              { path: "dup.ts", change: "added" },
              { path: "dup.ts", change: "modified" },
            ],
          })),
        ),
      ZodError,
    );
    assert.throws(
      () =>
        parseRequest(
          mutatePayload("decision.record", (p) => ({ ...p, paths: ["/abs"] })),
        ),
      ZodError,
    );
  });

  it("rejects bad checkout roots and heads", () => {
    assert.throws(
      () => parseRequest(mutateEvidence((e) => ({ ...e, checkoutRoot: "relative/path" }))),
      ZodError,
    );
    assert.throws(
      () => parseRequest(mutateEvidence((e) => ({ ...e, head: "not-a-commit" }))),
      ZodError,
    );
    assert.throws(
      () => parseRequest(mutateEvidence((e) => ({ ...e, head: "0".repeat(39) }))),
      ZodError,
    );
    // 64-hex heads are accepted.
    parseRequest(mutateEvidence((e) => ({ ...e, head: "ab".repeat(32) })));
  });

  it("rejects out-of-range paging", () => {
    assert.throws(
      () =>
        parseRequest(
          mutatePayload("task.list", (p) => ({ ...p, limit: 0 })),
        ),
      ZodError,
    );
    assert.throws(
      () =>
        parseRequest(
          mutatePayload("task.list", (p) => ({ ...p, limit: 101 })),
        ),
      ZodError,
    );
    assert.throws(
      () =>
        parseRequest({
          schemaVersion: 1,
          operation: "inbox.list",
          projectId: PROJECT_ID,
          actorId: "flash",
          payload: { after: -1 },
        }),
      ZodError,
    );
    assert.throws(
      () =>
        parseRequest(
          mutatePayload("context.get", (p) => ({ ...p, mode: "summary" })),
        ),
      ZodError,
    );
  });
});

describe("identifiers", () => {
  it("rejects invalid project, task, and question IDs", () => {
    const get = validEnvelope("task.get") as unknown as Record<string, unknown>;
    assert.throws(() => parseRequest({ ...get, projectId: "not-a-uuid" }), ZodError);
    assert.throws(
      () =>
        parseRequest(mutatePayload("task.get", (p) => ({ ...p, taskId: "123" }))),
      ZodError,
    );
    assert.throws(
      () =>
        parseRequest(mutatePayload("question.answer", (p) => ({ ...p, questionId: "zzz" }))),
      ZodError,
    );
  });

  it("rejects invalid agent IDs", () => {
    for (const bad of ["Muse", "0abc", "has space", "a".repeat(65), "", "UPPER"]) {
      const base = validEnvelope("agent.register") as unknown as Record<string, unknown>;
      assert.throws(
        () =>
          parseRequest({ ...base, payload: { id: bad, displayName: "X" } }),
        ZodError,
        JSON.stringify(bad),
      );
    }
  });

  it("rejects invalid requestIds and claim tokens", () => {
    const claim = validEnvelope("task.claim") as unknown as Record<string, unknown>;
    assert.throws(() => parseRequest({ ...claim, requestId: "" }), ZodError);
    assert.throws(() => parseRequest({ ...claim, requestId: "r".repeat(129) }), ZodError);
    assert.throws(
      () =>
        parseRequest(
          mutatePayload("task.renew", (p) => ({ ...p, claimToken: "" })),
        ),
      ZodError,
    );
  });

  it("rejects invalid project names and registration roots", () => {
    const base = validEnvelope("project.register") as unknown as Record<string, unknown>;
    assert.throws(
      () => parseRequest({ ...base, payload: { root: "/tmp/x", name: "" } }),
      ZodError,
    );
    assert.throws(
      () => parseRequest({ ...base, payload: { root: "/tmp/x", name: "   " } }),
      ZodError,
    );
    assert.throws(
      () => parseRequest({ ...base, payload: { root: "relative", name: "Ok" } }),
      ZodError,
    );
  });
});

describe("text normalization", () => {
  it("trims values and measures limits after trim", () => {
    const parsed = parseRequest(
      mutatePayload("task.create", (p) => ({ ...p, title: "  padded  " })),
    );
    if (parsed.operation === "task.create") assert.equal(parsed.payload.title, "padded");
    // 200 chars plus surrounding spaces still fits after trim.
    parseRequest(
      mutatePayload("task.create", (p) => ({ ...p, title: `  ${"y".repeat(200)}  ` })),
    );
    assert.throws(
      () => parseRequest(mutatePayload("task.create", (p) => ({ ...p, title: "   " }))),
      ZodError,
    );
  });
});

describe("validation details", () => {
  it("exposes only issue paths and codes, never submitted values", () => {
    const secret = "s3cr3t-sup3r-value-9z9z";
    const attempt = mutatePayload("handoff.submit", (p) => ({
      ...p,
      summary: secret,
      blockingQuestionIds: ["not-a-uuid"],
      evidence: {
        ...(p.evidence as Record<string, unknown>),
        files: [{ path: "/abs", change: "added", extra: secret }],
      },
      extraPayloadKey: secret,
    }));
    let caught: ZodError | null = null;
    try {
      parseRequest(attempt);
    } catch (error) {
      assert.ok(error instanceof ZodError);
      caught = error;
    }
    assert.ok(caught, "expected a validation error");
    const details = validationDetails(caught);
    assert.ok(details.issues.length > 0);
    const serialized = JSON.stringify(details);
    assert.ok(!serialized.includes(secret), "details leaked a submitted value");
    assert.ok(!serialized.includes("not-a-uuid"), "details leaked a submitted value");
    for (const issue of details.issues) {
      assert.deepEqual(Object.keys(issue).sort(), ["code", "path"]);
    }
  });
});
