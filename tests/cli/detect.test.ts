import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectCodingClis, findBinary } from "../../src/cli/detect.js";
import { runCli } from "../../src/cli/main.js";
import { Writable } from "node:stream";

class StringWritable extends Writable {
  public content = "";
  _write(chunk: unknown, _encoding: unknown, callback: () => void) {
    this.content += String(chunk);
    callback();
  }
}

describe("detectCodingClis", () => {
  it("finds a binary on PATH without executing it", () => {
    const dir = mkdtempSync(join(tmpdir(), "loreforge-bin-"));
    try {
      writeFileSync(join(dir, "grok"), "");
      assert.equal(findBinary("grok", dir, ":"), join(dir, "grok"));
      assert.equal(findBinary("claude", dir, ":"), null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports config dir and auth-file presence without reading secrets", async () => {
    const home = mkdtempSync(join(tmpdir(), "loreforge-detect-home-"));
    const bin = mkdtempSync(join(tmpdir(), "loreforge-detect-bin-"));
    try {
      mkdirSync(join(home, ".grok"));
      writeFileSync(join(home, ".grok", "auth.json"), "{\"token\":\"secret\"}");
      writeFileSync(join(bin, "grok"), "");
      mkdirSync(join(home, ".claude"));
      const found = detectCodingClis({ path: bin, home });
      const grok = found.find((row) => row.id === "grok");
      const claude = found.find((row) => row.id === "claude");
      assert.ok(grok);
      assert.equal(grok.signedIn, true);
      assert.ok(grok.evidence.includes("auth-file:present"));
      assert.ok(grok.binary?.endsWith("grok"));
      assert.ok(claude);
      assert.equal(claude.signedIn, false);
      assert.ok(claude.evidence.includes("dir:.claude"));
      assert.equal(found.some((row) => row.id === "muse"), false);

      const stdout = new StringWritable();
      const code = await runCli(["detect", "--json"], {
        stdout: stdout as unknown as NodeJS.WritableStream,
        env: { PATH: bin, HOME: home },
      });
      assert.equal(code, 0);
      const payload = JSON.parse(stdout.content);
      assert.equal(payload.ok, true);
      assert.ok(payload.data.clis.some((row: { id: string }) => row.id === "grok"));
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(bin, { recursive: true, force: true });
    }
  });
});
