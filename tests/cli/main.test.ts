import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Writable, Readable } from "node:stream";
import { runCli } from "../../src/cli/main.js";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

class StringWritable extends Writable {
  public content = "";
  _write(chunk: any, encoding: any, callback: any) {
    this.content += chunk.toString();
    callback();
  }
}

function streamFromString(str: string): NodeJS.ReadableStream {
  const readable = new Readable();
  readable.push(Buffer.from(str, "utf-8"));
  readable.push(null);
  return readable;
}

describe("CLI main runner (A16, A17)", () => {
  it("A17: --help exits 0 and prints help without creating state directory", async () => {
    const tempHome = mkdtempSync(join(tmpdir(), "agent-company-cli-help-"));
    const nonExistentState = join(tempHome, "non-existent-sub");
    try {
      const stdout = new StringWritable();
      const code = await runCli(["--help"], {
        stdout: stdout as any,
        env: { AGENT_COMPANY_HOME: nonExistentState }
      });

      assert.equal(code, 0);
      assert.ok(stdout.content.includes("Loreforge — shared memory for independent agents."));
      assert.ok(stdout.content.includes("lore search"));
      assert.ok(stdout.content.includes("Empty list means no matches") || stdout.content.includes("Hits []"));
      assert.equal(existsSync(nonExistentState), false, "State directory must not be created on --help");
    } finally {
      rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it("A24: instructions show exits 0 and creates no state", async () => {
    const tempHome = mkdtempSync(join(tmpdir(), "agent-company-cli-inst-"));
    const nonExistentState = join(tempHome, "non-existent-sub");
    try {
      const stdout = new StringWritable();
      const code = await runCli(
        [
          "instructions",
          "show",
          "--project",
          "11111111-1111-4111-8111-111111111111",
          "--agent",
          "flash",
          "--home",
          nonExistentState
        ],
        { stdout: stdout as any }
      );

      assert.equal(code, 0);
      assert.ok(stdout.content.includes("11111111-1111-4111-8111-111111111111"));
      assert.equal(existsSync(nonExistentState), false, "State directory must not be created on instructions show");
    } finally {
      rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it("A17: read against missing state returns NOT_FOUND (exit 3) and creates no state or db", async () => {
    const tempHome = mkdtempSync(join(tmpdir(), "agent-company-cli-read-"));
    const missingHome = join(tempHome, "no-such-home");
    let openCoreCalled = false;

    try {
      const stdout = new StringWritable();
      const stderr = new StringWritable();

      const input = JSON.stringify({
        schemaVersion: 1,
        projectId: "11111111-1111-4111-8111-111111111111",
        payload: { taskId: "22222222-2222-4222-8222-222222222222" }
      });

      const code = await runCli(
        ["task", "get", "--input", "-", "--home", missingHome, "--json"],
        {
          stdin: streamFromString(input),
          stdout: stdout as any,
          stderr: stderr as any,
          openCoreFn: (() => {
            openCoreCalled = true;
            throw new Error("openCore should not be called for missing state read");
          }) as any
        }
      );

      assert.equal(code, 3, "Exit code must be 3 for NOT_FOUND on missing state read");
      assert.equal(openCoreCalled, false, "openCore must not be invoked for missing-state read");
      assert.equal(existsSync(missingHome), false, "Missing home directory must not be created");

      const response = JSON.parse(stdout.content.trim());
      assert.equal(response.ok, false);
      assert.equal(response.error.code, "NOT_FOUND");
    } finally {
      rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it("A16: rejects invalid schema payload before opening state (exit 2)", async () => {
    const tempHome = mkdtempSync(join(tmpdir(), "agent-company-cli-val-"));
    let openCoreCalled = false;

    try {
      const stdout = new StringWritable();
      const stderr = new StringWritable();

      // Invalid: missing required requestId on mutation
      const badInput = JSON.stringify({
        schemaVersion: 1,
        projectId: "11111111-1111-4111-8111-111111111111",
        actorId: "flash",
        payload: { taskId: "22222222-2222-4222-8222-222222222222" }
      });

      const code = await runCli(
        ["task", "claim", "--input", "-", "--home", tempHome, "--json"],
        {
          stdin: streamFromString(badInput),
          stdout: stdout as any,
          stderr: stderr as any,
          openCoreFn: (() => {
            openCoreCalled = true;
            throw new Error("openCore should not be called on validation failure");
          }) as any
        }
      );

      assert.equal(code, 2, "Exit code must be 2 for VALIDATION failure");
      assert.equal(openCoreCalled, false, "openCore must not be invoked when schema validation fails");

      const response = JSON.parse(stdout.content.trim());
      assert.equal(response.ok, false);
      assert.equal(response.error.code, "VALIDATION");
    } finally {
      rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it("executes valid request via openCore handle and formats success", async () => {
    const tempHome = mkdtempSync(join(tmpdir(), "agent-company-cli-exec-"));
    try {
      const stdout = new StringWritable();
      const stderr = new StringWritable();

      const input = JSON.stringify({
        schemaVersion: 1,
        requestId: "reg-req-1",
        payload: { root: "/tmp", name: "TmpProj" }
      });

      const fakeCore = {
        execute: async (req: any) => {
          assert.equal(req.operation, "project.register");
          return {
            schemaVersion: 1 as const,
            ok: true as const,
            data: {
              project: {
                id: "11111111-1111-4111-8111-111111111111",
                name: "TmpProj",
                root: "/tmp",
                gitCommonDir: "/tmp/.git",
                createdAt: "2026-09-05T00:00:00Z"
              }
            }
          };
        },
        close: () => {}
      };

      const code = await runCli(
        ["project", "register", "--input", "-", "--home", tempHome, "--json"],
        {
          stdin: streamFromString(input),
          stdout: stdout as any,
          stderr: stderr as any,
          openCoreFn: (() => fakeCore) as any
        }
      );

      assert.equal(code, 0);
      const response = JSON.parse(stdout.content.trim());
      assert.equal(response.ok, true);
      assert.equal(response.data.project.id, "11111111-1111-4111-8111-111111111111");
    } finally {
      rmSync(tempHome, { recursive: true, force: true });
    }
  });
});
