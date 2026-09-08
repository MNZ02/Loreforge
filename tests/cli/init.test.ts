import test, { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { runInit, upsertMarkedSection, renderInitRule } from "../../src/cli/init.js";
import { runCli } from "../../src/cli/main.js";
import { Writable } from "node:stream";

class StringWritable extends Writable {
  public content = "";
  _write(chunk: unknown, _encoding: unknown, callback: () => void) {
    this.content += String(chunk);
    callback();
  }
}

function gitRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "loreforge-init-repo-"));
  execFileSync("git", ["init"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root });
  writeFileSync(join(root, "README.md"), "demo\n");
  execFileSync("git", ["add", "README.md"], { cwd: root });
  execFileSync("git", ["commit", "-m", "init"], { cwd: root });
  return root;
}

describe("lore init", () => {
  it("upserts a marked section without dropping the rest of the file", () => {
    const dir = mkdtempSync(join(tmpdir(), "loreforge-mark-"));
    try {
      const file = join(dir, "AGENTS.md");
      writeFileSync(file, "# Keep me\n");
      upsertMarkedSection(file, "first");
      upsertMarkedSection(file, "second");
      const text = readFileSync(file, "utf8");
      assert.ok(text.startsWith("# Keep me"));
      assert.ok(text.includes("second"));
      assert.equal(text.includes("first"), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renderInitRule names the role and roster", () => {
    const text = renderInitRule({
      execPath: "lore",
      homeDir: "/tmp/home",
      projectId: "11111111-1111-4111-8111-111111111111",
      agentId: "codex",
      role: "implement",
      roster: [
        { id: "codex", role: "implement" },
        { id: "grok", role: "review" },
      ],
    });
    assert.ok(text.includes("implement"));
    assert.ok(text.includes("`grok`: review"));
    assert.ok(text.includes("codex"));
  });

  it("registers agents, demo tasks, and optional rules without touching the real home", async () => {
    const root = gitRepo();
    const home = mkdtempSync(join(tmpdir(), "loreforge-init-home-"));
    const userHome = mkdtempSync(join(tmpdir(), "loreforge-init-user-"));
    try {
      const result = await runInit(
        {
          home,
          root,
          name: "InitDemo",
          agents: [
            { id: "codex", role: "implement" },
            { id: "grok", role: "review" },
          ],
          writeRules: true,
          writeUserRules: true,
          demo: true,
          json: true,
          detect: false,
        },
        { LOREFORGE_HOME: home },
        { execPath: "lore", userHome },
      );
      assert.equal(result.agents.length, 2);
      assert.equal(result.taskIds.length, 2);
      assert.ok(existsSync(join(home, "init.json")));
      assert.ok(existsSync(join(root, ".grok", "rules", "loreforge.md")));
      assert.ok(existsSync(join(root, "AGENTS.md")));
      assert.ok(existsSync(join(userHome, ".grok", "rules", "loreforge.md")));
      assert.equal(existsSync(join(userHome, ".claude", "rules", "loreforge.md")), false);
      const grokRule = readFileSync(join(userHome, ".grok", "rules", "loreforge.md"), "utf8");
      assert.ok(grokRule.includes("review"));
      assert.ok(grokRule.includes("Agent label: grok"));
      assert.equal(grokRule.includes(result.projectId), false);
      assert.equal(grokRule.includes(home), false);
      const agentsMd = readFileSync(join(root, "AGENTS.md"), "utf8");
      assert.ok(agentsMd.includes("Roster"));
      assert.equal(agentsMd.includes("Agent ID:   claude"), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
      rmSync(userHome, { recursive: true, force: true });
    }
  });

  it("write-rules does not overwrite the user home Grok rule", async () => {
    const root = gitRepo();
    const home = mkdtempSync(join(tmpdir(), "loreforge-init-home-"));
    const userHome = mkdtempSync(join(tmpdir(), "loreforge-init-user-"));
    try {
      const result = await runInit(
        {
          home,
          root,
          name: "InitDemo",
          agents: [{ id: "grok", role: "review" }],
          writeRules: true,
          writeUserRules: false,
          demo: false,
          json: true,
          detect: false,
        },
        { LOREFORGE_HOME: home },
        { execPath: "lore", userHome },
      );
      assert.ok(result.filesWritten.some((f) => f.endsWith("AGENTS.md")));
      assert.equal(existsSync(join(userHome, ".grok", "rules", "loreforge.md")), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
      rmSync(userHome, { recursive: true, force: true });
    }
  });

  it("CLI init --json creates demo tasks", async () => {
    const root = gitRepo();
    const home = mkdtempSync(join(tmpdir(), "loreforge-init-cli-"));
    try {
      const stdout = new StringWritable();
      const stderr = new StringWritable();
      const code = await runCli(
        [
          "init",
          "--agent",
          "claude:both",
          "--root",
          root,
          "--name",
          "CliDemo",
          "--demo",
          "--home",
          home,
          "--json",
        ],
        { stdout: stdout as unknown as NodeJS.WritableStream, stderr: stderr as unknown as NodeJS.WritableStream },
      );
      assert.equal(code, 0, stderr.content);
      const payload = JSON.parse(stdout.content);
      assert.equal(payload.ok, true);
      assert.equal(payload.data.agents[0].id, "claude");
      assert.equal(payload.data.taskIds.length, 2);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});
