import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import {
  handleSuccessOutput,
  handleErrorOutput,
  ERROR_EXIT_CODES
} from "../../src/cli/output.js";

class StringWritable extends Writable {
  public content = "";
  _write(chunk: any, encoding: any, callback: any) {
    this.content += chunk.toString();
    callback();
  }
}

describe("CLI Output Formatting (A17)", () => {
  it("formats successful response as JSON on stdout", () => {
    const stdout = new StringWritable();
    handleSuccessOutput(
      "task.get",
      { schemaVersion: 1, ok: true, data: { task: { id: "123" } } as any },
      true,
      stdout as any
    );

    const parsed = JSON.parse(stdout.content.trim());
    assert.equal(parsed.schemaVersion, 1);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.data.task.id, "123");
  });

  it("visibly includes claimToken for task.claim in human-readable mode", () => {
    const stdout = new StringWritable();
    handleSuccessOutput(
      "task.claim",
      {
        schemaVersion: 1,
        ok: true,
        data: {
          task: { id: "task-1", status: "running", attempt: 1, leaseUntil: "2026-09-05T12:00:00Z" },
          claimToken: "secret-token-xyz"
        } as any
      },
      false,
      stdout as any
    );

    assert.ok(stdout.content.includes("secret-token-xyz"), "Claim token must be visible in human task claim output");
    assert.ok(stdout.content.includes("task-1"));
  });

  it("excludes claimToken from other human-readable outputs", () => {
    const stdout = new StringWritable();
    handleSuccessOutput(
      "task.get",
      {
        schemaVersion: 1,
        ok: true,
        data: {
          task: { id: "task-1", title: "Test", status: "open", ownerId: null }
        } as any
      },
      false,
      stdout as any
    );

    assert.ok(!stdout.content.includes("secret-token-xyz"));
  });

  it("formats error response as JSON on stdout and returns exit code", () => {
    const stdout = new StringWritable();
    const stderr = new StringWritable();

    const exitCode = handleErrorOutput(
      { code: "VALIDATION", message: "Invalid payload shape" },
      true,
      stdout as any,
      stderr as any
    );

    assert.equal(exitCode, 2);
    assert.equal(stderr.content, ""); // Nothing on stderr in --json mode
    const parsed = JSON.parse(stdout.content.trim());
    assert.equal(parsed.schemaVersion, 1);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, "VALIDATION");
  });

  it("formats error response on stderr for human mode and returns exit code", () => {
    const stdout = new StringWritable();
    const stderr = new StringWritable();

    const exitCode = handleErrorOutput(
      { code: "NOT_FOUND", message: "Task not found" },
      false,
      stdout as any,
      stderr as any
    );

    assert.equal(exitCode, 3);
    assert.equal(stdout.content, ""); // Nothing on stdout in non-json error
    assert.ok(stderr.content.includes("Error [NOT_FOUND]: Task not found"));
  });

  it("maps all documented error codes to correct exit codes", () => {
    assert.equal(ERROR_EXIT_CODES.VALIDATION, 2);
    assert.equal(ERROR_EXIT_CODES.NOT_FOUND, 3);
    assert.equal(ERROR_EXIT_CODES.CONFLICT, 4);
    assert.equal(ERROR_EXIT_CODES.STALE_CLAIM, 5);
    assert.equal(ERROR_EXIT_CODES.BUSY, 6);
    assert.equal(ERROR_EXIT_CODES.IO, 7);
    assert.equal(ERROR_EXIT_CODES.INTERNAL, 1);
  });
});
