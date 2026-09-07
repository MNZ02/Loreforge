import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseCliArgs, CliValidationError } from "../../src/cli/args.js";

describe("CLI Argument Parser (A16, A17)", () => {
  it("parses valid standard operation", () => {
    const parsed = parseCliArgs([
      "task",
      "claim",
      "--input",
      "payload.json",
      "--home",
      "/tmp/my-home",
      "--json"
    ]);

    assert.equal(parsed.kind, "operation");
    if (parsed.kind === "operation") {
      assert.equal(parsed.operation, "task.claim");
      assert.equal(parsed.inputPath, "payload.json");
      assert.equal(parsed.home, "/tmp/my-home");
      assert.equal(parsed.json, true);
    }
  });

  it("parses stdin input indicator '-'", () => {
    const parsed = parseCliArgs(["context", "get", "--input", "-"]);
    assert.equal(parsed.kind, "operation");
    if (parsed.kind === "operation") {
      assert.equal(parsed.operation, "context.get");
      assert.equal(parsed.inputPath, "-");
      assert.equal(parsed.json, false);
    }
  });

  it("parses everyday short commands", () => {
    const context = parseCliArgs(["context", "--input", "-"]);
    const handoff = parseCliArgs(["handoff", "--input", "-"]);
    const ask = parseCliArgs(["ask", "--input", "-"]);
    const inbox = parseCliArgs(["inbox", "--input", "-"]);
    assert.equal(context.kind, "operation");
    assert.equal(handoff.kind, "operation");
    assert.equal(ask.kind, "operation");
    assert.equal(inbox.kind, "operation");
    if (context.kind === "operation") assert.equal(context.operation, "context.get");
    if (handoff.kind === "operation") assert.equal(handoff.operation, "handoff.submit");
    if (ask.kind === "operation") assert.equal(ask.operation, "question.ask");
    if (inbox.kind === "operation") assert.equal(inbox.operation, "inbox.list");
  });

  it("parses lore init with repeated --agent id:role", () => {
    const parsed = parseCliArgs([
      "init",
      "--agent",
      "codex:implement",
      "--agent",
      "grok:review",
      "--root",
      "/tmp/repo",
      "--name",
      "Demo",
      "--write-rules",
      "--demo",
      "--home",
      "/tmp/home",
      "--json",
    ]);
    assert.equal(parsed.kind, "init");
    if (parsed.kind === "init") {
      assert.deepEqual(parsed.agents, [
        { id: "codex", role: "implement" },
        { id: "grok", role: "review" },
      ]);
      assert.equal(parsed.root, "/tmp/repo");
      assert.equal(parsed.name, "Demo");
      assert.equal(parsed.writeRules, true);
      assert.equal(parsed.writeUserRules, false);
      assert.equal(parsed.demo, true);
      assert.equal(parsed.detect, true);
      assert.equal(parsed.json, true);
    }
  });

  it("parses lore detect", () => {
    const parsed = parseCliArgs(["detect", "--json"]);
    assert.equal(parsed.kind, "detect");
    if (parsed.kind === "detect") assert.equal(parsed.json, true);
  });

  it("parses lore init --no-detect", () => {
    const parsed = parseCliArgs(["init", "--no-detect", "--agent", "alice:both"]);
    assert.equal(parsed.kind, "init");
    if (parsed.kind === "init") assert.equal(parsed.detect, false);
  });

  it("rejects invalid init role", () => {
    assert.throws(
      () => parseCliArgs(["init", "--agent", "codex:owner"]),
      (err: any) => err instanceof CliValidationError && err.message.includes("Invalid role"),
    );
  });

  it("parses instructions show command", () => {
    const parsed = parseCliArgs([
      "instructions",
      "show",
      "--project",
      "11111111-1111-4111-8111-111111111111",
      "--agent",
      "flash",
      "--home",
      "/tmp/test-home"
    ]);

    assert.equal(parsed.kind, "instructions");
    if (parsed.kind === "instructions") {
      assert.equal(parsed.projectId, "11111111-1111-4111-8111-111111111111");
      assert.equal(parsed.agentId, "flash");
      assert.equal(parsed.home, "/tmp/test-home");
    }
  });

  it("detects global --help", () => {
    const parsed = parseCliArgs(["--help"]);
    assert.equal(parsed.kind, "help");
  });

  it("detects scoped <namespace> <verb> --help", () => {
    const parsed = parseCliArgs(["task", "claim", "--help"]);
    assert.equal(parsed.kind, "help");
    if (parsed.kind === "help") {
      assert.equal(parsed.topic, "task claim");
    }
  });

  it("throws CliValidationError on unknown command namespace", () => {
    assert.throws(
      () => parseCliArgs(["unknown", "verb", "--input", "test.json"]),
      (err: any) => err instanceof CliValidationError && err.code === "VALIDATION"
    );
  });

  it("throws CliValidationError on unknown verb", () => {
    assert.throws(
      () => parseCliArgs(["task", "destroy", "--input", "test.json"]),
      (err: any) => err instanceof CliValidationError && err.code === "VALIDATION"
    );
  });

  it("throws CliValidationError on missing --input", () => {
    assert.throws(
      () => parseCliArgs(["task", "claim"]),
      (err: any) => err instanceof CliValidationError && err.message.includes("--input")
    );
  });

  it("throws CliValidationError on unknown flag", () => {
    assert.throws(
      () => parseCliArgs(["task", "claim", "--input", "f.json", "--unrecognized"]),
      (err: any) => err instanceof CliValidationError && err.message.includes("Unknown flag")
    );
  });
});
