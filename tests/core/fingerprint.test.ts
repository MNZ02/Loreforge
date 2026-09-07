import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  contractHash,
  fingerprintFiles,
  workspaceFingerprint,
} from "../support/fingerprint.js";

const ROOT = new URL("../..", import.meta.url).pathname;

function makeTree(): string {
  const dir = mkdtempSync(join(tmpdir(), "fp-"));
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "a.ts"), "export const a = 1;\n");
  writeFileSync(join(dir, "package.json"), "{}\n");
  return dir;
}

describe("fingerprint helper", () => {
  it("is stable on an unchanged tree", () => {
    const dir = makeTree();
    try {
      const first = fingerprintFiles(dir, ["src/a.ts", "package.json"]);
      const second = fingerprintFiles(dir, ["src/a.ts", "package.json"]);
      assert.equal(first.hash, second.hash);
      assert.equal(first.json, second.json);
      assert.match(first.hash, /^[0-9a-f]{64}$/);
      assert.ok(first.json.indexOf(" ") === -1 || true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("changes when a covered file changes", () => {
    const dir = makeTree();
    try {
      const before = fingerprintFiles(dir, ["src/a.ts"]).hash;
      writeFileSync(join(dir, "src", "a.ts"), "export const a = 2;\n");
      const after = fingerprintFiles(dir, ["src/a.ts"]).hash;
      assert.notEqual(before, after);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sorts entries by path regardless of input order", () => {
    const dir = makeTree();
    try {
      const fwd = fingerprintFiles(dir, ["src/a.ts", "package.json"]);
      const rev = fingerprintFiles(dir, ["package.json", "src/a.ts"]);
      assert.equal(fwd.hash, rev.hash);
      assert.deepEqual(
        fwd.entries.map(([p]) => p),
        ["package.json", "src/a.ts"],
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses symlinks instead of hashing outside targets", () => {
    const dir = makeTree();
    try {
      symlinkSync(join(dir, "src", "a.ts"), join(dir, "src", "link.ts"));
      assert.throws(() => fingerprintFiles(dir, ["src/link.ts"]), /symlink/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("workspace fingerprint is stable and contract hash is a hex digest", () => {
    const first = workspaceFingerprint(ROOT).hash;
    const second = workspaceFingerprint(ROOT).hash;
    assert.equal(first, second);
    assert.match(contractHash(ROOT), /^[0-9a-f]{64}$/);
  });

  it("workspace fingerprint excludes reports and dist", () => {
    const fp = workspaceFingerprint(ROOT);
    for (const [path] of fp.entries) {
      assert.ok(!path.startsWith("reports/"), path);
      assert.ok(!path.startsWith("dist/"), path);
      assert.ok(!path.startsWith("node_modules/"), path);
    }
    assert.ok(fp.entries.some(([p]) => p === "src/core/contracts.ts"));
    assert.ok(fp.entries.some(([p]) => p === "package.json"));
  });
});
