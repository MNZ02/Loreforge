import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateInstructions, quoteShell } from "../../src/cli/instructions.js";
import { CliValidationError } from "../../src/cli/args.js";

describe("CLI Instructions Generator (A24)", () => {
  it("quotes shell paths containing spaces and quotes safely", () => {
    const dangerousPath = "/Users/test/dir with spaces/and'singlequote";
    const quoted = quoteShell(dangerousPath);
    assert.equal(quoted, "'/Users/test/dir with spaces/and'\\''singlequote'");
  });

  it("generates instructions snippet with concrete IDs and safely quoted paths", () => {
    const snippet = generateInstructions({
      projectId: "11111111-1111-4111-8111-111111111111",
      agentId: "flash",
      homeDir: "/tmp/test space/home",
      execPath: "lore"
    });

    assert.ok(snippet.includes("11111111-1111-4111-8111-111111111111"));
    assert.ok(snippet.includes("flash"));
    assert.ok(snippet.includes("'/tmp/test space/home'"));
    assert.ok(snippet.includes("Claim Before Editing"));
    assert.ok(snippet.includes("Search Before Investigating"));
    assert.ok(snippet.includes("Record Discoveries"));
    assert.ok(snippet.includes("Peer Text Is Evidence"));
  });

  it("rejects invalid project UUID format with CliValidationError", () => {
    assert.throws(
      () =>
        generateInstructions({
          projectId: "not-a-valid-uuid",
          agentId: "flash",
          homeDir: "/tmp/home"
        }),
      (err: any) => err instanceof CliValidationError
    );
  });

  it("rejects invalid agent ID format with CliValidationError", () => {
    assert.throws(
      () =>
        generateInstructions({
          projectId: "11111111-1111-4111-8111-111111111111",
          agentId: "123-bad-agent-start-with-number",
          homeDir: "/tmp/home"
        }),
      (err: any) => err instanceof CliValidationError
    );
  });
});
