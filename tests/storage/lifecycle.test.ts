import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  closeCore,
  execOk,
  openTestCore,
  regRequest,
  removeDir,
  tempDir,
  type TestCore,
} from "../support/harness.js";
import { runCoreChild } from "../support/proc.js";
import type { Agent } from "../../src/core/contracts.js";
import { MIGRATIONS } from "../../src/storage/schema.js";

const APPLIED_VERSIONS = MIGRATIONS.map((migration) => migration.version);

function migrationVersions(home: string): number[] {
  const db = new DatabaseSync(join(home, "loreforge.sqlite3"));
  try {
    db.exec("PRAGMA foreign_keys = ON");
    const rows = db
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .all() as Array<{ version: number }>;
    return rows.map((row) => row.version);
  } finally {
    db.close();
  }
}

describe("storage lifecycle (A01)", async () => {
  it("initializes twice, preserves data, and applies each schema version once", async () => {
    const first: TestCore = openTestCore();
    let createdAt = "";
    try {
      const agent = await execOk<{ agent: Agent }>(
        first.core,
        regRequest("agent.register", "boot-1", { id: "muse", displayName: "Muse" }),
      );
      createdAt = agent.agent.createdAt;
    } finally {
      closeCore(first.core);
    }
    const second: TestCore = openTestCore(first.home);
    try {
      // Same id and name replays the existing record byte-for-byte.
      const again = await execOk<{ agent: Agent }>(
        second.core,
        regRequest("agent.register", "boot-1", { id: "muse", displayName: "Muse" }),
      );
      assert.equal(again.agent.createdAt, createdAt);
      const other = await execOk<{ agent: Agent }>(
        second.core,
        regRequest("agent.register", "boot-2", { id: "flash", displayName: "Flash" }),
      );
      assert.equal(other.agent.id, "flash");
    } finally {
      closeCore(second.core);
    }
    assert.deepEqual(migrationVersions(first.home), APPLIED_VERSIONS);
    removeDir(first.home);
  });

  it("initializes from two processes concurrently without losing data", async () => {
    const home = tempDir("company-home-");
    try {
      const gate = join(home, "gate");
      const pendingA = runCoreChild(
        home,
        regRequest("agent.register", "conc-a", { id: "proc-a", displayName: "Proc A" }),
        { gate },
      );
      const pendingB = runCoreChild(
        home,
        regRequest("agent.register", "conc-b", { id: "proc-b", displayName: "Proc B" }),
        { gate },
      );
      // Let both children reach the gate (tsx startup), then release them at
      // once so their opens and migrations race.
      await new Promise((resolve) => setTimeout(resolve, 5000));
      writeFileSync(gate, "go\n");
      const [resultA, resultB] = await Promise.all([pendingA, pendingB]);
      assert.equal(resultA.exitCode, 0, resultA.stderr);
      assert.equal(resultB.exitCode, 0, resultB.stderr);
      assert.ok(resultA.response?.ok, JSON.stringify(resultA.response));
      assert.ok(resultB.response?.ok, JSON.stringify(resultB.response));
      const check: TestCore = openTestCore(home);
      try {
        const replayA = await execOk<{ agent: Agent }>(
          check.core,
          regRequest("agent.register", "conc-a", { id: "proc-a", displayName: "Proc A" }),
        );
        assert.equal(replayA.agent.displayName, "Proc A");
        const replayB = await execOk<{ agent: Agent }>(
          check.core,
          regRequest("agent.register", "conc-b", { id: "proc-b", displayName: "Proc B" }),
        );
        assert.equal(replayB.agent.displayName, "Proc B");
      } finally {
        closeCore(check.core);
      }
      assert.deepEqual(migrationVersions(home), APPLIED_VERSIONS);
    } finally {
      removeDir(home);
    }
  });

  it("never reports IO when two processes open a fresh home at once (GROK-003)", async () => {
    // Repeated fresh-home first-open races. The loser of the startup race
    // must join via bounded retry, never surface IO "cannot initialize
    // database": PRAGMA journal_mode = WAL fails fast with SQLITE_BUSY and
    // must be retried within the busy budget, not mapped to IO.
    for (let round = 0; round < 6; round += 1) {
      const home = tempDir("company-home-");
      try {
        const gate = join(home, "gate");
        const pendingA = runCoreChild(
          home,
          regRequest("agent.register", `g3a-${round}`, { id: "proc-a", displayName: "Proc A" }),
          { gate },
        );
        const pendingB = runCoreChild(
          home,
          regRequest("agent.register", `g3b-${round}`, { id: "proc-b", displayName: "Proc B" }),
          { gate },
        );
        // Let both children reach the gate (tsx startup), then release them
        // at once so their opens race.
        await new Promise((resolve) => setTimeout(resolve, round === 0 ? 5000 : 2500));
        writeFileSync(gate, "go\n");
        const [resultA, resultB] = await Promise.all([pendingA, pendingB]);
        assert.equal(resultA.exitCode, 0, resultA.stderr);
        assert.equal(resultB.exitCode, 0, resultB.stderr);
        for (const [name, result] of [
          ["A", resultA],
          ["B", resultB],
        ] as const) {
          const code = result.response?.ok
            ? null
            : (result.response as unknown as { error?: { code?: string } } | null)?.error?.code ??
              "no-response";
          assert.notEqual(code, "IO", `round ${round} child ${name} must not fail first open with IO`);
          assert.ok(result.response?.ok, `round ${round} child ${name}: ${JSON.stringify(result.response)}`);
        }
      } finally {
        removeDir(home);
      }
    }
  });

  it("enables foreign keys, uses a private database file, and guards schema", async () => {
    const held: TestCore = openTestCore();
    try {
      const dbPath = join(held.home, "loreforge.sqlite3");
      assert.ok(existsSync(dbPath));
      assert.equal(statSync(dbPath).mode & 0o777, 0o600);
      assert.equal(statSync(held.home).mode & 0o777, 0o700);
      const probe = new DatabaseSync(dbPath);
      try {
        probe.exec("PRAGMA foreign_keys = ON");
        // The schema itself enforces references: an orphan task row fails.
        assert.throws(() =>
          probe
            .prepare("INSERT INTO tasks (id, project_id, title, description, status, owner_id, claim_token, attempt, lease_until, created_at, updated_at) VALUES ('t1', 'missing-project', 't', 'd', 'open', NULL, NULL, 0, NULL, 1, 1)")
            .run(),
        );
      } finally {
        probe.close();
      }
    } finally {
      closeCore(held.core);
    }
  });
});
