import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execErr, execOk, mutRequest } from "../support/harness.js";
import { setupFlow } from "../support/flow.js";
import type { Decision } from "../../src/core/contracts.js";

function recordRequest(projectId: string, actor: string, requestId: string, payload: unknown): unknown {
  return mutRequest("decision.record", projectId, actor, requestId, payload);
}

describe("decision supersession (A15)", () => {
  it("keeps immutable history with project-scoped single-active chains", async () => {
    const env = await setupFlow();
    try {
      const first = await execOk<{ decision: Decision }>(
        env.held.core,
        recordRequest(env.projectId, "muse", "dec-1", { body: "Use SQLite.", paths: [], supersedesId: null }),
      );
      const second = await execOk<{ decision: Decision }>(
        env.held.core,
        recordRequest(env.projectId, "flash", "dec-2", {
          body: "Use SQLite with WAL.",
          paths: [],
          supersedesId: first.decision.id,
        }),
      );
      assert.equal(second.decision.supersedesId, first.decision.id);

      // A second supersession of the same decision conflicts.
      const double = await execErr(
        env.held.core,
        recordRequest(env.projectId, "muse", "dec-3", {
          body: "Third opinion.",
          paths: [],
          supersedesId: first.decision.id,
        }),
      );
      assert.equal(double.code, "CONFLICT");

      // Unknown IDs and foreign-project IDs conflict without leaking.
      const unknown = await execErr(
        env.held.core,
        recordRequest(env.projectId, "muse", "dec-4", {
          body: "Ghost supersession.",
          paths: [],
          supersedesId: "99999999-9999-4999-8999-999999999999",
        }),
      );
      assert.equal(unknown.code, "CONFLICT");

      const foreign = await execErr(
        env.held.core,
        recordRequest("99999999-9999-4999-8999-999999999999", "muse", "dec-5", {
          body: "Foreign project.",
          paths: [],
          supersedesId: second.decision.id,
        }),
      );
      assert.equal(foreign.code, "NOT_FOUND");
    } finally {
      env.cleanup();
    }
  });

  it("scopes supersession targets to their own project", async () => {
    const env = await setupFlow();
    const envB = await setupFlow();
    try {
      const inB = await execOk<{ decision: Decision }>(
        envB.held.core,
        recordRequest(envB.projectId, "muse", "dec-b1", {
          body: "B decision.",
          paths: [],
          supersedesId: null,
        }),
      );
      const cross = await execErr(
        env.held.core,
        recordRequest(env.projectId, "muse", "dec-cross", {
          body: "Cross-project supersession.",
          paths: [],
          supersedesId: inB.decision.id,
        }),
      );
      assert.equal(cross.code, "CONFLICT");
      assert.ok(!JSON.stringify(cross).includes("B decision."));
    } finally {
      env.cleanup();
      envB.cleanup();
    }
  });
});
