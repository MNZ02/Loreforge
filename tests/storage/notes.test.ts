import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { execErr, execOk, mutRequest, readRequest, tempDir } from "../support/harness.js";
import { flowClaim, flowCreate, flowSubmit, setupFlow } from "../support/flow.js";
import { runCoreChild } from "../support/proc.js";
import type { NoteRecord, SearchQueryData } from "../../src/core/contracts.js";

function addPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "Standalone finding",
    finding: "Notes work without a task.",
    reason: "Agents should record discoveries without claiming.",
    evidenceRefs: ["reports/example.md"],
    paths: ["src/storage/schema.ts"],
    observedCommit: null,
    status: "proposed",
    taskId: null,
    supersedesId: null,
    ...overrides,
  };
}

describe("standalone notes", () => {
  it("adds and gets a note without a task or claim", async () => {
    const env = await setupFlow();
    try {
      const added = await execOk<{ note: NoteRecord }>(
        env.held.core,
        mutRequest("note.add", env.projectId, "muse", "note-1", addPayload()),
      );
      assert.equal(added.note.source, "note");
      assert.equal(added.note.status, "proposed");
      assert.equal(added.note.taskId, null);
      assert.equal(added.note.current, true);
      assert.equal(added.note.authorId, "muse");
      assert.match(added.note.createdAt, /^\d{4}-\d{2}-\d{2}T/);

      const got = await execOk<{ note: NoteRecord }>(
        env.held.core,
        readRequest("note.get", env.projectId, { noteId: added.note.id }),
      );
      assert.equal(got.note.id, added.note.id);
      assert.equal(got.note.finding, "Notes work without a task.");
      assert.deepEqual(got.note.paths, ["src/storage/schema.ts"]);
    } finally {
      env.cleanup();
    }
  });

  it("treats verified as stored attribution, not a proof field", async () => {
    const env = await setupFlow();
    try {
      const added = await execOk<{ note: NoteRecord }>(
        env.held.core,
        mutRequest(
          "note.add",
          env.projectId,
          "flash",
          "note-verified",
          addPayload({ status: "verified", title: "Attributed verification" }),
        ),
      );
      assert.equal(added.note.status, "verified");
      assert.equal(added.note.authorId, "flash");
    } finally {
      env.cleanup();
    }
  });

  it("optional taskId must exist in the same project", async () => {
    const env = await setupFlow();
    const other = await setupFlow();
    try {
      const task = await flowCreate(env, "muse", "t-note");
      const linked = await execOk<{ note: NoteRecord }>(
        env.held.core,
        mutRequest(
          "note.add",
          env.projectId,
          "muse",
          "note-task",
          addPayload({ taskId: task.id, title: "Linked" }),
        ),
      );
      assert.equal(linked.note.taskId, task.id);

      const missing = await execErr(
        env.held.core,
        mutRequest(
          "note.add",
          env.projectId,
          "muse",
          "note-missing-task",
          addPayload({ taskId: "99999999-9999-4999-8999-999999999999" }),
        ),
      );
      assert.equal(missing.code, "NOT_FOUND");

      const foreign = await execErr(
        env.held.core,
        mutRequest("note.add", env.projectId, "muse", "note-foreign-task", addPayload({ taskId: (await flowCreate(other, "muse", "t-other")).id })),
      );
      assert.equal(foreign.code, "NOT_FOUND");
    } finally {
      env.cleanup();
      other.cleanup();
    }
  });

  it("preserves original notes and exposes superseded history", async () => {
    const env = await setupFlow();
    try {
      const first = await execOk<{ note: NoteRecord }>(
        env.held.core,
        mutRequest(
          "note.add",
          env.projectId,
          "muse",
          "note-old",
          addPayload({ title: "Old filename", finding: "Used 20260907000000." }),
        ),
      );
      const correction = await execOk<{ note: NoteRecord }>(
        env.held.core,
        mutRequest(
          "note.add",
          env.projectId,
          "flash",
          "note-new",
          addPayload({
            title: "Corrected filename",
            finding: "Use 20260907000002.",
            supersedesId: first.note.id,
          }),
        ),
      );
      assert.equal(correction.note.supersedesId, first.note.id);
      assert.equal(correction.note.current, true);

      const old = await execOk<{ note: NoteRecord }>(
        env.held.core,
        readRequest("note.get", env.projectId, { noteId: first.note.id }),
      );
      assert.equal(old.note.current, false);
      assert.equal(old.note.supersededById, correction.note.id);
      assert.equal(old.note.finding, "Used 20260907000000.");

      const double = await execErr(
        env.held.core,
        mutRequest(
          "note.add",
          env.projectId,
          "muse",
          "note-double",
          addPayload({ title: "Second correction", supersedesId: first.note.id }),
        ),
      );
      assert.equal(double.code, "CONFLICT");
    } finally {
      env.cleanup();
    }
  });

  it("rejects cross-project supersession without leaking the other note", async () => {
    const env = await setupFlow();
    const other = await setupFlow();
    try {
      const inOther = await execOk<{ note: NoteRecord }>(
        other.held.core,
        mutRequest(
          "note.add",
          other.projectId,
          "muse",
          "note-b",
          addPayload({ title: "Secret other project", finding: "secret-body-xyz" }),
        ),
      );
      const cross = await execErr(
        env.held.core,
        mutRequest(
          "note.add",
          env.projectId,
          "muse",
          "note-cross",
          addPayload({ title: "Cross", supersedesId: inOther.note.id }),
        ),
      );
      assert.equal(cross.code, "CONFLICT");
      assert.ok(!JSON.stringify(cross).includes("secret-body-xyz"));
    } finally {
      env.cleanup();
      other.cleanup();
    }
  });

  it("can supersede a handoff for retrieval while preserving task history", async () => {
    const env = await setupFlow();
    try {
      const task = await flowCreate(env, "muse", "t-handoff");
      const claimed = await flowClaim(env, "muse", "claim-h", task.id);
      const submitted = await flowSubmit(env, "muse", "handoff-h", task.id, claimed.claimToken, {
        summary: "Original handoff about coupon checkout_committed_at using 20260907000000.",
        files: [{ path: "supabase/migrations/20260907000000_coupon_checkout_committed_at.sql", change: "added" }],
      });

      const correction = await execOk<{ note: NoteRecord }>(
        env.held.core,
        mutRequest(
          "note.add",
          env.projectId,
          "flash",
          "note-over-handoff",
          addPayload({
            title: "Handoff correction",
            finding: "The repair file is 20260907000002_coupon_checkout_committed_at.sql.",
            supersedesId: submitted.handoff.id,
          }),
        ),
      );
      assert.equal(correction.note.supersedesId, submitted.handoff.id);

      const gotHandoff = await execOk<{ note: NoteRecord }>(
        env.held.core,
        readRequest("note.get", env.projectId, { noteId: submitted.handoff.id }),
      );
      assert.equal(gotHandoff.note.source, "handoff");
      assert.equal(gotHandoff.note.current, false);
      assert.equal(gotHandoff.note.supersededById, correction.note.id);

      const context = await execOk<{ snapshot: { handoffs: Array<{ id: string; summary: string }> } }>(
        env.held.core,
        readRequest("context.get", env.projectId, { taskId: task.id, mode: "work" }),
      );
      assert.equal(context.snapshot.handoffs.length, 1);
      assert.equal(context.snapshot.handoffs[0].id, submitted.handoff.id);
      assert.match(context.snapshot.handoffs[0].summary, /20260907000000/);
    } finally {
      env.cleanup();
    }
  });

  it("two processes correcting the same note produce one current successor", async () => {
    const env = await setupFlow();
    try {
      const first = await execOk<{ note: NoteRecord }>(
        env.held.core,
        mutRequest("note.add", env.projectId, "muse", "note-base", addPayload({ title: "Base" })),
      );
      const payloadA = addPayload({ title: "Correction A", finding: "A wins or loses.", supersedesId: first.note.id });
      const payloadB = addPayload({ title: "Correction B", finding: "B wins or loses.", supersedesId: first.note.id });
      const gate = join(tempDir("company-gate-"), "gate");
      const pendingA = runCoreChild(
        env.held.home,
        mutRequest("note.add", env.projectId, "muse", "note-corr-a", payloadA),
        { gate },
      );
      const pendingB = runCoreChild(
        env.held.home,
        mutRequest("note.add", env.projectId, "flash", "note-corr-b", payloadB),
        { gate },
      );
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
        (losses[0] as Extract<NonNullable<(typeof losses)[0]>, { ok: false }>).error.code,
        "CONFLICT",
      );

      const search = await execOk<SearchQueryData>(
        env.held.core,
        readRequest("search.query", env.projectId, { query: "Correction wins loses" }),
      );
      const current = search.hits.filter((hit) => hit.current && hit.source === "note");
      assert.equal(current.length, 1);
      const winner = (wins[0] as Extract<NonNullable<(typeof wins)[0]>, { ok: true }>).data as {
        note: NoteRecord;
      };
      assert.equal(current[0].id, winner.note.id);

      const old = await execOk<{ note: NoteRecord }>(
        env.held.core,
        readRequest("note.get", env.projectId, { noteId: first.note.id }),
      );
      assert.equal(old.note.supersededById, winner.note.id);
    } finally {
      env.cleanup();
    }
  });
});
