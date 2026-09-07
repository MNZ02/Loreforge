import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, basename, resolve } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import type { Readable, Writable } from "node:stream";
import { openCore } from "../core/index.js";
import type { Response } from "../core/contracts.js";
import { generateInstructions, quoteShell } from "./instructions.js";
import { CliValidationError, parseAgentSpec, type InitAgentSpec, type InitRole } from "./args.js";
import { resolveHomeDir } from "./home.js";
import { detectCodingClis, detectedToAgents, type DetectedCli } from "./detect.js";

export interface InitOptions {
  home?: string;
  root?: string;
  name?: string;
  agents: InitAgentSpec[];
  writeRules: boolean;
  demo: boolean;
  json: boolean;
  detect?: boolean;
}

export interface InitResult {
  projectId: string;
  home: string;
  root: string;
  agents: InitAgentSpec[];
  filesWritten: string[];
  taskIds: string[];
  detected: DetectedCli[];
}

function defaultExecPath(): string {
  try {
    const currentDir = fileURLToPath(new URL(".", import.meta.url));
    const distBin = resolve(currentDir, "../../dist/cli/main.js");
    if (existsSync(distBin)) return `node ${quoteShell(distBin)}`;
  } catch {
    // fall through
  }
  return "lore";
}

function titleCase(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

function executeOk<T>(response: Response): T {
  if (!response.ok) {
    throw new CliValidationError(response.error.message);
  }
  return response.data as T;
}

function roleGuidance(role: InitRole): string {
  if (role === "review") {
    return [
      "Your init role is **review**. Use context mode `review`. Do not claim a task to implement unless the user asks you to edit.",
      "Any registered agent may still claim any open task if the user reassigns.",
    ].join("\n");
  }
  if (role === "implement") {
    return [
      "Your init role is **implement**. Use context mode `work` and claim an open task before editing.",
      "Any registered agent may still claim any open task if the user reassigns.",
    ].join("\n");
  }
  return [
    "Your init role is **both**. Use `work` if you will edit, `review` if you will not.",
    "Any registered agent may claim any open task.",
  ].join("\n");
}

export function renderInitRule(params: {
  execPath: string;
  homeDir: string;
  projectId: string;
  agentId: string;
  role: InitRole;
  roster: InitAgentSpec[];
}): string {
  const roster = params.roster.map((a) => `- \`${a.id}\`: ${a.role}`).join("\n");
  const snippet = generateInstructions({
    projectId: params.projectId,
    agentId: params.agentId,
    homeDir: params.homeDir,
    execPath: params.execPath,
  });
  return `${snippet}

## Role for this session

${roleGuidance(params.role)}

Roster from \`lore init\` (labels, not locks):
${roster}

Loreforge does not start other models, create worktrees, merge, or deploy.
`;
}

const MARK_START = "<!-- loreforge:start -->";
const MARK_END = "<!-- loreforge:end -->";

export function upsertMarkedSection(filePath: string, body: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const block = `${MARK_START}\n${body.trim()}\n${MARK_END}\n`;
  if (!existsSync(filePath)) {
    writeFileSync(filePath, block, "utf8");
    return;
  }
  const current = readFileSync(filePath, "utf8");
  const startAt = current.indexOf(MARK_START);
  const endAt = current.indexOf(MARK_END);
  if (startAt >= 0 && endAt > startAt) {
    const afterEnd = endAt + MARK_END.length;
    const suffix = current.slice(afterEnd).replace(/^\n/, "");
    writeFileSync(filePath, `${current.slice(0, startAt)}${block}${suffix}`, "utf8");
    return;
  }
  const prefix = current.trimEnd();
  writeFileSync(filePath, prefix.length > 0 ? `${prefix}\n\n${block}` : block, "utf8");
}

async function promptLine(
  stdin: NodeJS.ReadableStream,
  stdout: NodeJS.WritableStream,
  question: string,
  fallback: string,
): Promise<string> {
  const rl = createInterface({
    input: stdin as Readable,
    output: stdout as Writable,
    terminal: Boolean((stdin as NodeJS.ReadStream).isTTY),
  });
  try {
    const answer = await rl.question(fallback ? `${question} [${fallback}]: ` : `${question}: `);
    const trimmed = answer.trim();
    return trimmed.length > 0 ? trimmed : fallback;
  } finally {
    rl.close();
  }
}

export async function resolveInitOptions(
  options: InitOptions,
  stdin: NodeJS.ReadableStream,
  stdout: NodeJS.WritableStream,
  cwd: string,
  env: Record<string, string | undefined> = process.env,
  userHome = homedir(),
): Promise<InitOptions> {
  const detected =
    options.detect === false
      ? []
      : detectCodingClis({
          path: env.PATH ?? "",
          home: userHome,
          pathDelimiter: env.Path && !env.PATH ? ";" : ":",
          pathext: env.PATHEXT,
        });
  const detectedAgents = detectedToAgents(detected);
  if (options.agents.length > 0) return { ...options, agents: options.agents };
  if (!Boolean((stdin as NodeJS.ReadStream).isTTY)) {
    if (detectedAgents.length === 0) {
      throw new CliValidationError(
        "lore init found no local CLIs; pass --agent id[:role] (repeatable)",
      );
    }
    return { ...options, agents: detectedAgents };
  }
  const root = await promptLine(stdin, stdout, "Git repo to register", options.root ?? cwd);
  const name = await promptLine(stdin, stdout, "Project name", options.name ?? basename(resolve(root)));
  const detectedDefault = detectedAgents.map((a) => `${a.id}:${a.role}`).join(",") || "codex:implement,claude:review";
  if (detected.length > 0) {
    stdout.write("Detected CLIs (binary/config dir; auth-file means a login file exists, not a billed plan):\n");
    for (const row of detected) {
      stdout.write(`  ${row.id}  ${row.evidence.join(", ")}${row.signedIn ? "  signed-in-file" : ""}\n`);
    }
  }
  const agentLine = await promptLine(
    stdin,
    stdout,
    "Agents as id:role (role=implement|review|both), comma-separated",
    detectedDefault,
  );
  const agents = agentLine
    .split(",")
    .map((part) => parseAgentSpec(part))
    .filter((a, i, all) => all.findIndex((b) => b.id === a.id) === i);
  if (agents.length === 0) {
    throw new CliValidationError("at least one agent is required");
  }
  const writeRaw = await promptLine(stdin, stdout, "Write session rules into detected CLIs? (Y/n)", "Y");
  const demoRaw = await promptLine(stdin, stdout, "Create two sample tasks? (Y/n)", "Y");
  return {
    ...options,
    root,
    name,
    agents,
    writeRules: options.writeRules || /^y/i.test(writeRaw),
    demo: options.demo || /^y/i.test(demoRaw),
  };
}

export async function runInit(
  options: InitOptions,
  env: Record<string, string | undefined>,
  extras: { execPath?: string; userHome?: string } = {},
): Promise<InitResult> {
  const execPath = extras.execPath ?? defaultExecPath();
  const userHome = extras.userHome ?? homedir();
  if (options.agents.length === 0) {
    throw new CliValidationError("lore init requires at least one --agent id[:role]");
  }
  const root = resolve(options.root ?? process.cwd());
  const name = (options.name ?? basename(root)).slice(0, 100);
  const home = resolveHomeDir(options.home, env);
  const core = openCore({ home });
  const filesWritten: string[] = [];
  const taskIds: string[] = [];
  try {
    const project = executeOk<{ project: { id: string } }>(
      await core.execute({
        schemaVersion: 1,
        operation: "project.register",
        requestId: "init-project-1",
        payload: { root, name },
      }),
    ).project;

    for (const agent of options.agents) {
      executeOk(
        await core.execute({
          schemaVersion: 1,
          operation: "agent.register",
          requestId: `init-agent-${agent.id}`,
          payload: { id: agent.id, displayName: titleCase(agent.id) },
        }),
      );
    }

    const actorId = options.agents[0].id;
    const rosterText = options.agents.map((a) => `${a.id}=${a.role}`).join(", ");
    executeOk(
      await core.execute({
        schemaVersion: 1,
        operation: "decision.record",
        projectId: project.id,
        actorId,
        requestId: "init-decision-roster-1",
        payload: {
          body: `Init roster (labels, not locks; any agent may claim any open task): ${rosterText}.`,
          paths: [],
          supersedesId: null,
        },
      }),
    );

    if (options.demo) {
      const first = executeOk<{ task: { id: string } }>(
        await core.execute({
          schemaVersion: 1,
          operation: "task.create",
          projectId: project.id,
          actorId,
          requestId: "init-demo-task-1",
          payload: {
            title: "Demo: make a small documented change",
            description:
              "Implementer: claim this task, make a tiny change in this repo, run a check, hand off with git evidence.",
            dependsOn: [],
          },
        }),
      ).task;
      const second = executeOk<{ task: { id: string } }>(
        await core.execute({
          schemaVersion: 1,
          operation: "task.create",
          projectId: project.id,
          actorId,
          requestId: "init-demo-task-2",
          payload: {
            title: "Demo: review the other agent's change",
            description:
              "Reviewer: wait until the implementer task is completed, fetch context in review mode, do not implement unless asked.",
            dependsOn: [first.id],
          },
        }),
      ).task;
      taskIds.push(first.id, second.id);
    }

    mkdirSync(home, { recursive: true });
    const initPath = join(home, "init.json");
    writeFileSync(
      initPath,
      `${JSON.stringify({ projectId: project.id, root, agents: options.agents }, null, 2)}\n`,
      "utf8",
    );
    filesWritten.push(initPath);

    if (options.writeRules) {
      const combined = options.agents
        .map((agent) =>
          renderInitRule({
            execPath,
            homeDir: home,
            projectId: project.id,
            agentId: agent.id,
            role: agent.role,
            roster: options.agents,
          }),
        )
        .join("\n---\n\n");

      const repoRule = join(root, ".grok", "rules", "loreforge.md");
      mkdirSync(dirname(repoRule), { recursive: true });
      writeFileSync(repoRule, combined, "utf8");
      filesWritten.push(repoRule);

      upsertMarkedSection(
        join(root, "AGENTS.md"),
        combined,
      );
      filesWritten.push(join(root, "AGENTS.md"));

      const ids = new Set(options.agents.map((a) => a.id));
      if (ids.has("claude") || ids.has("anthropic")) {
        upsertMarkedSection(join(root, "CLAUDE.md"), combined);
        filesWritten.push(join(root, "CLAUDE.md"));
      }

      for (const agent of options.agents) {
        const body = renderInitRule({
          execPath,
          homeDir: home,
          projectId: project.id,
          agentId: agent.id,
          role: agent.role,
          roster: options.agents,
        });
        if (agent.id === "grok") {
          const path = join(userHome, ".grok", "rules", "loreforge.md");
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, body, "utf8");
          filesWritten.push(path);
        }
        if (agent.id === "claude") {
          const path = join(userHome, ".claude", "rules", "loreforge.md");
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, body, "utf8");
          filesWritten.push(path);
        }
        if (agent.id === "cursor") {
          const path = join(root, ".cursor", "rules", "loreforge.mdc");
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, body, "utf8");
          filesWritten.push(path);
        }
      }
    }

    const detected = detectCodingClis({
      path: env.PATH ?? "",
      home: userHome,
      pathext: env.PATHEXT,
    });
    return {
      projectId: project.id,
      home,
      root,
      agents: options.agents,
      filesWritten,
      taskIds,
      detected,
    };
  } finally {
    core.close();
  }
}
