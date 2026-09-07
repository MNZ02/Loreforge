#!/usr/bin/env node
// Temporary Grok reproduction: A26 compiled CLI from a foreign cwd against
// an explicit temp home and two worktree paths of one repository.
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
const distBin = join(packageRoot, "dist", "cli", "main.js");
if (!existsSync(distBin)) {
  console.log("MISSING_DIST", distBin);
  process.exit(2);
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function runCli(cwd, home, args, input) {
  const res = spawnSync(process.execPath, [distBin, ...args, "--home", home, "--json", "--input", "-"], {
    cwd,
    input: JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, AGENT_COMPANY_HOME: "/this/must/not/be/used" },
  });
  let parsed;
  try {
    parsed = JSON.parse((res.stdout || "").trim().split("\n")[0]);
  } catch {
    parsed = null;
  }
  return { status: res.status, stdout: res.stdout, stderr: res.stderr, parsed };
}

const foreignCwd = mkdtempSync(join(tmpdir(), "grok-a26-cwd-"));
const fixture = mkdtempSync(join(tmpdir(), "grok-a26-fix-"));
const home = join(fixture, "home");
const repo = join(fixture, "repo");
const worktree = join(fixture, "linked-worktree");
mkdirSync(repo);
try {
  execFileSync("git", ["init", "-b", "main", repo], { stdio: "pipe" });
  git(repo, ["config", "user.name", "Grok Review"]);
  git(repo, ["config", "user.email", "grok@example.test"]);
  writeFileSync(join(repo, "hello.txt"), "hello\n");
  git(repo, ["add", "hello.txt"]);
  git(repo, ["commit", "-m", "init"]);
  execFileSync("git", ["worktree", "add", worktree, "HEAD"], { cwd: repo, stdio: "pipe" });

  const help = spawnSync(process.execPath, [distBin, "--help"], { cwd: foreignCwd, encoding: "utf8" });
  console.log("HELP_STATUS", help.status);
  console.log("HELP_HAS_BANNER", (help.stdout || "").includes("Agent Company CLI"));
  console.log("HELP_CREATED_HOME", existsSync(home));

  const regRoot = runCli(foreignCwd, home, ["project", "register"], {
    schemaVersion: 1,
    requestId: "reg-root",
    payload: { root: repo, name: "A26" },
  });
  const regWt = runCli(foreignCwd, home, ["project", "register"], {
    schemaVersion: 1,
    requestId: "reg-wt",
    payload: { root: worktree, name: "A26-worktree-alias" },
  });
  console.log("REG_ROOT", regRoot.status, regRoot.parsed?.ok, regRoot.parsed?.data?.project?.id);
  console.log("REG_WT", regWt.status, regWt.parsed?.ok, regWt.parsed?.data?.project?.id);
  const same = regRoot.parsed?.data?.project?.id && regRoot.parsed.data.project.id === regWt.parsed?.data?.project?.id;
  console.log("SAME_PROJECT", same);
  console.log("HOME_DB", existsSync(join(home, "company.sqlite3")));
  console.log("FOREIGN_NO_DB", !existsSync(join(foreignCwd, "company.sqlite3")));

  const ok = help.status === 0 && regRoot.parsed?.ok && regWt.parsed?.ok && same;
  process.exit(ok ? 0 : 1);
} finally {
  try {
    execFileSync("git", ["worktree", "remove", "--force", worktree], { cwd: repo, stdio: "pipe" });
  } catch {}
  rmSync(foreignCwd, { recursive: true, force: true });
  rmSync(fixture, { recursive: true, force: true });
}
