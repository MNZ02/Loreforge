import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { readBoundedInput, CliInputError, MAX_JSON_BYTES } from "../../src/cli/input.js";

function streamFromString(str: string): NodeJS.ReadableStream {
  const readable = new Readable();
  readable.push(Buffer.from(str, "utf-8"));
  readable.push(null);
  return readable;
}

function streamFromBuffer(buf: Buffer): NodeJS.ReadableStream {
  const readable = new Readable();
  readable.push(buf);
  readable.push(null);
  return readable;
}

describe("CLI Bounded Input (A16)", () => {
  it("successfully reads valid small JSON object from stdin", async () => {
    const input = JSON.stringify({ schemaVersion: 1, requestId: "req-1", payload: {} });
    const parsed = await readBoundedInput("-", streamFromString(input));
    assert.equal(parsed.schemaVersion, 1);
    assert.equal(parsed.requestId, "req-1");
  });

  it("fails with VALIDATION when input exceeds 64 KiB limit", async () => {
    // Generate 65 KiB of JSON data
    const largeData = JSON.stringify({
      schemaVersion: 1,
      payload: { padding: "X".repeat(MAX_JSON_BYTES + 100) }
    });

    await assert.rejects(
      async () => {
        await readBoundedInput("-", streamFromString(largeData));
      },
      (err: any) => err instanceof CliInputError && err.code === "VALIDATION" && err.exitCode === 2
    );
  });

  it("fails with VALIDATION on invalid UTF-8", async () => {
    // Invalid UTF-8 sequence: 0xC3 followed by 0x28 (not a valid UTF-8 continuation byte)
    const invalidUtf8 = Buffer.from([0x7b, 0x22, 0xc3, 0x28, 0x22, 0x7d]);
    await assert.rejects(
      async () => {
        await readBoundedInput("-", streamFromBuffer(invalidUtf8));
      },
      (err: any) => err instanceof CliInputError && err.code === "VALIDATION"
    );
  });

  it("fails with VALIDATION on malformed JSON without leaking input content", async () => {
    const secretContent = "SUPER_SECRET_TOKEN_DO_NOT_LEAK";
    const malformed = `{"schemaVersion": 1, "badJson": "${secretContent}" unclosed`;

    await assert.rejects(
      async () => {
        await readBoundedInput("-", streamFromString(malformed));
      },
      (err: any) => {
        assert.ok(err instanceof CliInputError);
        assert.equal(err.code, "VALIDATION");
        assert.ok(!err.message.includes(secretContent), "Error message must not leak input text");
        return true;
      }
    );
  });

  it("fails with VALIDATION when input contains forbidden 'operation' field", async () => {
    const inputWithOp = JSON.stringify({
      schemaVersion: 1,
      operation: "task.claim",
      payload: {}
    });

    await assert.rejects(
      async () => {
        await readBoundedInput("-", streamFromString(inputWithOp));
      },
      (err: any) => err instanceof CliInputError && err.code === "VALIDATION" && err.message.includes("operation")
    );
  });
});
