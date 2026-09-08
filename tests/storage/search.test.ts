import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  closeCore,
  execErr,
  execOk,
  mutRequest,
  openTestCore,
  readRequest,
  removeDir,
  tempDir,
} from "../support/harness.js";
import { flowClaim, flowCreate, flowSubmit, setupFlow } from "../support/flow.js";
import type { NoteRecord, SearchHit, SearchQueryData } from "../../src/core/contracts.js";
import { MIGRATIONS } from "../../src/storage/schema.js";
import { DB_FILENAME } from "../../src/storage/db.js";

function addPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "Note",
    finding: "Finding",
    reason: "Reason",
    evidenceRefs: [],
    paths: [],
    observedCommit: null,
    status: "proposed",
    taskId: null,
    supersedesId: null,
    ...overrides,
  };
}

async function search(
  core: { execute: (request: unknown) => Promise<unknown> },
  projectId: string,
  payload: Record<string, unknown>,
): Promise<SearchQueryData> {
  return execOk<SearchQueryData>(core as never, readRequest("search.query", projectId, payload));
}

describe("search over notes and handoffs", () => {
  it("PsiGenei-style fixture: coupon correction is current; F6 handoff is findable; other projects stay out", async () => {
    const env = await setupFlow();
    const other = await setupFlow();
    try {
      const oldNote = await execOk<{ note: NoteRecord }>(
        env.held.core,
        mutRequest(
          "note.add",
          env.projectId,
          "muse",
          "psi-coupon-old",
          addPayload({
            title: "Coupon migration repair",
            finding:
              "Staging coupon migration repair used 20260907000000_coupon_checkout_committed_at.sql to add checkout_committed_at.",
            reason: "Referral resume reads checkout_committed_at.",
            evidenceRefs: ["reports/psigenei-security-2026-09-06/SECURITY-REVIEW.md"],
            paths: ["supabase/migrations/20260907000000_coupon_checkout_committed_at.sql"],
          }),
        ),
      );
      const correction = await execOk<{ note: NoteRecord }>(
        env.held.core,
        mutRequest(
          "note.add",
          env.projectId,
          "flash",
          "psi-coupon-new",
          addPayload({
            title: "Coupon migration repair correction",
            finding:
              "Coupon migration repair must use 20260907000002_coupon_checkout_committed_at.sql, not 20260907000000, to avoid a staging version collision.",
            reason: "Flash already used 20260907000000 for analytics views.",
            evidenceRefs: ["reports/psigenei-security-2026-09-06/GROK-IMPLEMENTATION-RECHECK.md"],
            paths: ["supabase/migrations/20260907000002_coupon_checkout_committed_at.sql"],
            supersedesId: oldNote.note.id,
            status: "proposed",
          }),
        ),
      );

      const f6 = await flowCreate(env, "muse", "psi-f6");
      const claimed = await flowClaim(env, "muse", "psi-f6-claim", f6.id);
      const f6Handoff = await flowSubmit(env, "muse", "psi-f6-handoff", f6.id, claimed.claimToken, {
        summary:
          "F6 payment retry after stranded claims: claim-before-grant lost paid plan grants; a retry returned alreadyProcessed without installing user_plans.",
        files: [
          { path: "src/lib/payments/grant-user-plan.ts", change: "modified" },
          { path: "supabase/migrations/20260907000001_grant_plan_after_payment.sql", change: "added" },
        ],
      });

      await execOk(
        other.held.core,
        mutRequest(
          "note.add",
          other.projectId,
          "muse",
          "other-coupon",
          addPayload({
            title: "Coupon migration repair",
            finding:
              "Unrelated project coupon migration repair also mentions 20260907000002_coupon_checkout_committed_at.sql.",
            paths: ["supabase/migrations/20260907000002_coupon_checkout_committed_at.sql"],
          }),
        ),
      );

      const coupon = await search(env.held.core, env.projectId, {
        query: "coupon migration repair",
        files: ["supabase/migrations/20260907000002_coupon_checkout_committed_at.sql"],
        limit: 5,
      });
      assert.ok(coupon.hits.length >= 1, "expected coupon hits");
      assert.equal(coupon.hits[0].id, correction.note.id);
      assert.equal(coupon.hits[0].current, true);
      assert.match(coupon.hits[0].excerpt, /20260907000002/);
      assert.ok(
        !coupon.hits.some((hit: SearchHit) => hit.id === oldNote.note.id),
        "superseded 20260907000000 note must not appear as current",
      );
      assert.ok(!coupon.hits.some((hit: SearchHit) => hit.id === f6Handoff.handoff.id));

      const history = await search(env.held.core, env.projectId, {
        query: "coupon migration repair",
        includeSuperseded: true,
        limit: 10,
      });
      assert.ok(history.hits.some((hit) => hit.id === oldNote.note.id && hit.current === false));
      const oldFull = await execOk<{ note: NoteRecord }>(
        env.held.core,
        readRequest("note.get", env.projectId, { noteId: oldNote.note.id }),
      );
      assert.match(oldFull.note.finding, /20260907000000/);

      const f6Search = await search(env.held.core, env.projectId, {
        query: "payment retry stranded claims",
        files: ["src/lib/payments/grant-user-plan.ts"],
        limit: 5,
      });
      assert.ok(
        f6Search.hits.some((hit) => hit.id === f6Handoff.handoff.id && hit.source === "handoff"),
        "F6 handoff must be searchable without copying into a note",
      );
      const f6Hit = f6Search.hits.find((hit) => hit.id === f6Handoff.handoff.id);
      assert.ok(f6Hit);
      assert.equal(f6Hit.source, "handoff");
      assert.ok(f6Hit.evidenceRefs.includes("src/lib/payments/grant-user-plan.ts"));

      const leaked = await search(env.held.core, env.projectId, {
        query: "Unrelated project coupon",
        limit: 5,
      });
      assert.equal(leaked.hits.length, 0);

      const otherHits = await search(other.held.core, other.projectId, {
        query: "coupon migration repair",
        limit: 5,
      });
      assert.ok(otherHits.hits.every((hit) => hit.id !== correction.note.id));
      assert.ok(otherHits.hits.every((hit) => hit.id !== f6Handoff.handoff.id));
    } finally {
      env.cleanup();
      other.cleanup();
    }
  });

  it("distinguishes empty matches from search failure", async () => {
    const env = await setupFlow();
    try {
      const empty = await search(env.held.core, env.projectId, {
        query: "zzzxnotatokenintheindex",
        limit: 5,
      });
      assert.deepEqual(empty.hits, []);
      assert.equal(empty.omittedCount, 0);

      const missingProject = await execErr(
        env.held.core,
        readRequest("search.query", "99999999-9999-4999-8999-999999999999", {
          query: "coupon",
        }),
      );
      assert.equal(missingProject.code, "NOT_FOUND");

      const bad = await execErr(
        env.held.core,
        readRequest("search.query", env.projectId, { query: "a" }),
      );
      assert.equal(bad.code, "VALIDATION");
    } finally {
      env.cleanup();
    }
  });

  it("migrates a v1 database and searches existing handoffs without copying them", async () => {
    const home = tempDir("company-v1-home-");
    const dbPath = join(home, DB_FILENAME);
    mkdirSync(home, { recursive: true });
    const db = new DatabaseSync(dbPath);
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL) STRICT",
    );
    db.exec(MIGRATIONS[0].sql);
    db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)").run(Date.now());
    const projectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const taskId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const handoffId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const now = Date.now();
    db.prepare(
      "INSERT INTO projects (id, name, root, git_common_dir, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(projectId, "Legacy", "/tmp/legacy-root", "/tmp/legacy-root/.git", now);
    db.prepare("INSERT INTO agents (id, display_name, created_at) VALUES (?, ?, ?)").run(
      "muse",
      "Muse",
      now,
    );
    db.prepare(
      "INSERT INTO tasks (id, project_id, title, description, status, owner_id, claim_token, attempt, lease_until, created_at, updated_at) VALUES (?, ?, ?, ?, 'completed', NULL, NULL, 1, NULL, ?, ?)",
    ).run(taskId, projectId, "F6", "payment retry stranded claims", now, now);
    db.prepare(
      `INSERT INTO handoffs (
        id, project_id, task_id, actor_id, attempt, outcome, summary, evidence_json, unresolved_json,
        next_steps_json, blocking_ids_json, observed_checkout_root, observed_head, observed_dirty,
        observed_collected_at, created_at
      ) VALUES (?, ?, ?, 'muse', 1, 'completed', ?, ?, '[]', '[]', '[]', '/tmp/legacy-root', ?, 0, ?, ?)`,
    ).run(
      handoffId,
      projectId,
      taskId,
      "Payment retry after stranded claims left processed_payment_orders without user_plans.",
      JSON.stringify({
        checkoutRoot: "/tmp/legacy-root",
        head: "a".repeat(40),
        dirty: false,
        files: [{ path: "src/lib/payments/grant-user-plan.ts", change: "modified" }],
        checks: [],
      }),
      "a".repeat(40),
      now,
      now,
    );
    db.close();

    const held = openTestCore(home);
    try {
      const hits = await search(held.core, projectId, {
        query: "payment retry stranded claims",
        sources: ["handoff"],
        limit: 5,
      });
      assert.equal(hits.hits.length, 1);
      assert.equal(hits.hits[0].id, handoffId);
      assert.equal(hits.hits[0].source, "handoff");

      const added = await execOk<{ note: NoteRecord }>(
        held.core,
        mutRequest(
          "note.add",
          projectId,
          "muse",
          "legacy-note",
          addPayload({ title: "Works on v1 homes", finding: "Additive migration keeps old rows." }),
        ),
      );
      assert.equal(added.note.current, true);
    } finally {
      closeCore(held.core);
      removeDir(home);
    }
  });
});
