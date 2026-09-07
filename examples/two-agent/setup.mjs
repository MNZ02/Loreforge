#!/usr/bin/env node
import { existsSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const targetArg = process.argv[2];
if (!targetArg) {
  console.error("Usage: node examples/two-agent/setup.mjs <target-directory>");
  process.exit(1);
}

const targetDir = resolve(targetArg);

// Ensure it refuses an existing nonempty target instead of deleting user data
if (existsSync(targetDir)) {
  const contents = readdirSync(targetDir);
  if (contents.length > 0) {
    console.error(`Refusing to initialize: target directory is not empty (${targetDir})`);
    process.exit(1);
  }
} else {
  mkdirSync(targetDir, { recursive: true });
}

const repoDir = join(targetDir, "repo");
const homeDir = join(targetDir, "home");
mkdirSync(repoDir, { recursive: true });
mkdirSync(homeDir, { recursive: true });

// Initialize disposable Git fixture repository
execFileSync("git", ["init", "-b", "main"], { cwd: repoDir, stdio: "pipe" });
execFileSync("git", ["config", "user.name", "Fixture Setup"], { cwd: repoDir, stdio: "pipe" });
execFileSync("git", ["config", "user.email", "fixture@example.local"], { cwd: repoDir, stdio: "pipe" });

writeFileSync(
  join(repoDir, "math.js"),
  `// Base arithmetic fixture\nexport function subtract(a, b) { return a - b; }\n`
);
writeFileSync(
  join(repoDir, "math.test.js"),
  `import { subtract } from "./math.js";\nif (subtract(5, 2) !== 3) throw new Error("test failed");\nconsole.log("math tests pass");\n`
);
execFileSync("git", ["add", "."], { cwd: repoDir, stdio: "pipe" });
execFileSync("git", ["commit", "-m", "Initial fixture commit"], { cwd: repoDir, stdio: "pipe" });

const currentFileDir = fileURLToPath(new URL(".", import.meta.url));
const packageRoot = resolve(currentFileDir, "../..");
const mainCliPath = join(packageRoot, "src", "cli", "main.ts");

function runCompany(namespace, verb, inputPayload) {
  const inputStr = JSON.stringify(inputPayload);
  const res = spawnSync(
    process.execPath,
    ["--import", "tsx", mainCliPath, namespace, verb, "--input", "-", "--home", homeDir, "--json"],
    {
      cwd: packageRoot,
      input: inputStr,
      encoding: "utf-8"
    }
  );

  if (res.status !== 0) {
    throw new Error(
      `Command failed: ${namespace} ${verb} (code ${res.status}): ${res.stderr || res.stdout}`
    );
  }

  const parsed = JSON.parse(res.stdout.trim());
  if (!parsed.ok) {
    throw new Error(`Operation ${namespace} ${verb} failed: ${JSON.stringify(parsed.error)}`);
  }
  return parsed.data;
}

// 1. Register Project
const projData = runCompany("project", "register", {
  schemaVersion: 1,
  requestId: "req-setup-proj",
  payload: {
    root: repoDir,
    name: "TwoAgentFixture"
  }
});
const projectId = projData.project.id;

// 2. Register Agents
runCompany("agent", "register", {
  schemaVersion: 1,
  requestId: "req-setup-agent-muse",
  payload: {
    id: "muse",
    displayName: "Muse Agent"
  }
});

runCompany("agent", "register", {
  schemaVersion: 1,
  requestId: "req-setup-agent-flash",
  payload: {
    id: "flash",
    displayName: "Flash Agent"
  }
});

// 3. Create Task A
const taskAData = runCompany("task", "create", {
  schemaVersion: 1,
  projectId,
  actorId: "muse",
  requestId: "req-setup-task-a",
  payload: {
    title: "Implement addition arithmetic function",
    description: "Export function add(a, b) in math.js and add unit test in math.test.js.",
    dependsOn: []
  }
});
const taskAId = taskAData.task.id;

// 4. Create Task B (depends on Task A)
const taskBData = runCompany("task", "create", {
  schemaVersion: 1,
  projectId,
  actorId: "flash",
  requestId: "req-setup-task-b",
  payload: {
    title: "Implement multiplication arithmetic function",
    description: "Export function multiply(a, b) in math.js using repeated addition or formula, and add unit test.",
    dependsOn: [taskAId]
  }
});
const taskBId = taskBData.task.id;

const ids = {
  projectId,
  taskAId,
  taskBId,
  homeDir,
  repoDir,
  packageRoot,
  cliBin: join(packageRoot, "dist", "cli", "main.js")
};

writeFileSync(join(targetDir, "ids.json"), JSON.stringify(ids, null, 2) + "\n");

console.log("Two-agent S1 fixture initialized successfully!");
console.log(`Directory:    ${targetDir}`);
console.log(`Project ID:   ${projectId}`);
console.log(`Task A ID:    ${taskAId} (assigned to muse)`);
console.log(`Task B ID:    ${taskBId} (assigned to flash, depends on A)`);
console.log(`State Home:   ${homeDir}`);
console.log(`Repo Root:    ${repoDir}`);
console.log(`Package Root: ${packageRoot}`);
console.log(`CLI Bin:      ${join(packageRoot, "dist", "cli", "main.js")}`);
console.log(`IDs saved to: ${join(targetDir, "ids.json")}`);
