#!/usr/bin/env node
import { readProjectBinding } from "./project-config.js";
import { runManagement, currentProject } from "./management.js";
import { OpError } from "../core/errors.js";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { openCore, CoreOpenError, parseRequest, validationDetails } from "../core/index.js";
import type { Request, Response } from "../core/contracts.js";
import { parseCliArgs, CliValidationError, READ_OPERATIONS, OperationName } from "./args.js";
import { readBoundedInput, CliInputError } from "./input.js";
import { handleSuccessOutput, handleErrorOutput } from "./output.js";
import { generateInstructions } from "./instructions.js";
import { resolveHomeDir, doesStateExist } from "./home.js";
import { resolveInitOptions, runInit } from "./init.js";
import { detectCodingClis } from "./detect.js";
import { homedir } from "node:os";

export interface CliDependencies {
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  env?: Record<string, string | undefined>;
  openCoreFn?: typeof openCore;
}

export function printHelp(stdout: NodeJS.WritableStream = process.stdout, topic?: string): void {
  const helpText = (
`Loreforge — shared memory for independent agents.

Usage:
  lore context  --input <file|-> [--home <dir>] [--json]
  lore handoff  --input <file|-> [--home <dir>] [--json]
  lore ask      --input <file|-> [--home <dir>] [--json]
  lore inbox    --input <file|-> [--home <dir>] [--json]
  lore search   --query "..." [--files path,path] [--limit 5] --project <uuid> [--home <dir>] [--json]
  lore note get <id> --project <uuid> [--home <dir>] [--json]
  lore <namespace> <verb> --input <file|-> [--home <dir>] [--json]
  lore instructions show --project <uuid> --agent <agent-id> [--home <dir>]
  lore init [--agent id[:role]]... [--root <git>] [--name <name>] [--write-rules] [--write-user-rules] [--demo] [--detect|--no-detect] [--home <dir>] [--json]
  lore detect [--json]
  lore doctor [--home <dir>] [--json]
  lore project current [--home <dir>] [--json]
  lore task list [--claimable|--expired] [--status <status>] [--cursor <cursor>] [--limit <n>]
  lore backup --output <file> [--home <dir>]
  lore restore --input <backup> --home <new-directory>
  lore export [--project <uuid>] [--format json|markdown] [--output <file>]
  lore mcp [--home <dir>]
  lore --help

Everyday:
  context                 Retrieve formatted context (work or review mode)
  handoff                 Submit a completed or blocked handoff with git evidence
  ask                     Ask a task-linked question
  inbox                   List inbox events for an agent
  search                  Search current notes and handoffs (SQLite FTS5)

Other operations:
  project list/current    Discover projects or resolve this repository
  agent list              Discover registered agents
  doctor                  Diagnose repository binding, schema and integrity
  review record/list      Record/read reviews tied to a handoff and commit
  note history            Follow a correction chain (paged)
  decision list           List active decisions (paged)
  index check/rebuild     Check or rebuild derived search data
  backup/restore/export   Back up state, restore into a new home, export records
  mcp                     Serve core operations over MCP stdio
  project register        Register a git repository as a project
  agent register          Register an agent identity
  task create             Create a task
  task get                Retrieve task details
  task list               List tasks
  task claim              Acquire a 2-hour claim lease on an open task
  task renew              Extend an active claim lease
  task release            Release a claim back to open
  task reopen             Reopen a blocked task after questions are answered
  task cancel             Cancel a task
  question answer         Answer a pending question
  decision record         Record an architectural decision
  note add                Record a standalone finding (no task required)
  note get                Retrieve a note or searchable handoff by id
  search query            Search notes and handoffs; empty hits are success
  instructions show       Print generic session instruction template
  init                    Register a repo and agents, optional sample tasks and session rules
  detect                  List local coding CLIs (PATH + config dirs; does not read keys)

Options:
  --input <file|->        Path to JSON envelope input file or '-' for stdin (max 64 KiB)
  --home <dir>            State directory (default: LOREFORGE_HOME or ~/.loreforge/context-v1)
  --json                  Output exactly one JSON response line on stdout
  --project <uuid>        Explicit project (otherwise resolved from current repository)
  --agent <id[:role]>     Agent id, optional :implement|:review|:both (repeatable on init)
  --mode work|review     Context mode for instructions show (defaults to roster role)
  --root <dir>            Git repository root (init)
  --name <name>           Project display name (init)
  --write-rules           Init: write repo AGENTS.md / .grok/rules (not ~/.grok)
  --write-user-rules      Init: also overwrite ~/.grok/rules and ~/.claude/rules
  --demo                  Init: create two sample tasks
  --detect / --no-detect  Init: auto-fill agents from local CLIs (default: detect)
  --query <text>          Search text (search only)
  --files <paths>         Comma-separated or repeatable relative paths (search only)
  --limit <n>             Search/task-list cap, max 100 (defaults 5/20)
  --include-superseded    Include superseded records in search
  --claimable / --expired Filter task list by live lease/dependency state
  --status / --cursor     Task status filter and opaque next-page cursor
  --help, -h              Show this help message

Search covers notes, handoffs, tasks and decisions. Ranking: title-token hits, then path overlap, then FTS5 bm25, then
newest created_at, then id. Default search hides superseded items. Excerpts
are at most 240 characters; use note get for full text. Hits [] with ok true
means no matches, not a failure. Verified status is the author's assertion.
`
  );
  stdout.write(helpText);
}

/**
 * Main programmatic CLI runner.
 * Returns the process exit code.
 */
export async function runCli(
  rawArgs: string[],
  deps: CliDependencies = {}
): Promise<number> {
  const stdout = deps.stdout ?? process.stdout;
  const stderr = deps.stderr ?? process.stderr;
  const stdin = deps.stdin ?? process.stdin;
  const env = deps.env ?? process.env;
  const openCoreImpl = deps.openCoreFn ?? openCore;

  // 1. Parse CLI arguments
  let parsed;
  try {
    parsed = parseCliArgs(rawArgs);
  } catch (err: unknown) {
    if (err instanceof CliValidationError) {
      return handleErrorOutput(
        { code: "VALIDATION", message: err.message },
        rawArgs.includes("--json"),
        stdout,
        stderr
      );
    }
    return handleErrorOutput(
      { code: "INTERNAL", message: err instanceof Error ? err.message : "Argument parsing error" },
      rawArgs.includes("--json"),
      stdout,
      stderr
    );
  }

  // 2. Handle Help
  if (parsed.kind === "help") {
    printHelp(stdout, parsed.topic);
    return 0;
  }

  if (parsed.kind === "management") {
    try { return await runManagement(parsed, env, stdout); }
    catch (error) {
      const code = error instanceof OpError || error instanceof CoreOpenError ? error.code : error instanceof CliValidationError ? "VALIDATION" : "IO";
      return handleErrorOutput({code, message:error instanceof Error ? error.message : "Operation failed"}, parsed.json, stdout, stderr);
    }
  }

  if (parsed.kind === "detect") {
    const found = detectCodingClis({
      path: env.PATH ?? "",
      home: env.HOME || homedir(),
      pathext: env.PATHEXT,
    });
    if (parsed.json) {
      stdout.write(`${JSON.stringify({ schemaVersion: 1, ok: true, data: { clis: found } })}\n`);
    } else if (found.length === 0) {
      stdout.write("No known coding CLIs found on PATH or in home config dirs.\n");
    } else {
      stdout.write("Local CLIs (not a billing check; auth-file means a login file exists):\n");
      for (const row of found) {
        stdout.write(`  ${row.id.padEnd(8)} ${row.evidence.join(", ")}\n`);
      }
    }
    return 0;
  }

  if (parsed.kind === "init") {
    try {
      const resolved = await resolveInitOptions(parsed, stdin, stdout, env.PWD || process.cwd(), env);
      const result = await runInit(resolved, env);
      if (parsed.json) {
        stdout.write(`${JSON.stringify({ schemaVersion: 1, ok: true, data: result })}\n`);
      } else {
        stdout.write(`Project ${result.projectId}\nHome ${result.home}\n`);
        stdout.write(`Agents ${result.agents.map((a) => `${a.id}:${a.role}`).join(", ")}\n`);
        if (result.taskIds.length > 0) stdout.write(`Demo tasks ${result.taskIds.join(", ")}\n`);
        if (result.filesWritten.length > 0) {
          stdout.write("Wrote:\n");
          for (const file of result.filesWritten) stdout.write(`  ${file}\n`);
        }
        stdout.write("Open each CLI in the git repo and ask what's next. Do not paste a plan.\n");
      }
      return 0;
    } catch (err: unknown) {
      if (err instanceof CliValidationError) {
        return handleErrorOutput({ code: "VALIDATION", message: err.message }, parsed.json, stdout, stderr);
      }
      return handleErrorOutput(
        { code: "INTERNAL", message: err instanceof Error ? err.message : "Init failed" },
        parsed.json,
        stdout,
        stderr,
      );
    }
  }

  // 3. Handle Instructions Show
  if (parsed.kind === "instructions") {
    try {
      const homeDir = resolveHomeDir(parsed.home, env);
      const text = generateInstructions({
        projectId: parsed.projectId,
        agentId: parsed.agentId,
        mode: parsed.mode ?? (readProjectBinding()?.agents.find(agent => agent.id === parsed.agentId)?.role === "review" ? "review" : "work"),
        homeDir
      });
      stdout.write(text + "\n");
      return 0;
    } catch (err: unknown) {
      if (err instanceof CliValidationError) {
        return handleErrorOutput(
          { code: "VALIDATION", message: err.message },
          false,
          stdout,
          stderr
        );
      }
      return handleErrorOutput(
        { code: "INTERNAL", message: err instanceof Error ? err.message : "Instructions error" },
        false,
        stdout,
        stderr
      );
    }
  }

  // 4. Handle Operation Command
  const { operation, inputPath, builtEnvelope, home: explicitHome, json } = parsed;
  let home: string;
  try { home = resolveHomeDir(explicitHome, env); }
  catch (error) { return handleErrorOutput({code:"VALIDATION",message:error instanceof Error ? error.message : "Invalid repository configuration"}, json, stdout, stderr); }

  // 4a. Read bounded input (enforcing 64 KiB byte limit, UTF-8, JSON shape)
  // Flag-built envelopes (search --query, note get <id>) skip stdin/file input.
  let rawPayload: Record<string, unknown>;
  if (builtEnvelope) {
    rawPayload = builtEnvelope;
  } else {
    if (!inputPath) {
      return handleErrorOutput(
        { code: "VALIDATION", message: "Missing required --input <file|-> argument" },
        json,
        stdout,
        stderr
      );
    }
    try {
      rawPayload = await readBoundedInput(inputPath, stdin);
    } catch (err: unknown) {
      if (err instanceof CliInputError) {
        return handleErrorOutput({ code: err.code, message: err.message }, json, stdout, stderr);
      }
      return handleErrorOutput(
        { code: "IO", message: err instanceof Error ? err.message : "Input error" },
        json,
        stdout,
        stderr
      );
    }
  }

  // 4b. Pure validation via parseRequest before opening state
  const globalOperation = ["project.register", "agent.register", "project.list", "agent.list"].includes(operation);
  if (!globalOperation && rawPayload.projectId === undefined) {
    try { rawPayload.projectId = parsed.projectId ?? currentProject(home).projectId; }
    catch (error) { return handleErrorOutput({code:"VALIDATION",message:error instanceof Error ? error.message : "Specify --project or initialize this repository"},json,stdout,stderr); }
  }
  const candidateRequest = {
    ...rawPayload,
    operation
  };

  let request: Request;
  try {
    request = parseRequest(candidateRequest);
  } catch (err: unknown) {
    const details = err instanceof z.ZodError ? validationDetails(err) : undefined;
    return handleErrorOutput(
      {
        code: "VALIDATION",
        message: "Request validation failed: envelope or payload does not conform to schema",
        details
      },
      json,
      stdout,
      stderr
    );
  }

  // 4c. Missing-state guard for read operations:
  // Missing state on a read returns NOT_FOUND and must NOT create an empty DB.
  if (READ_OPERATIONS.has(operation) && !doesStateExist(home)) {
    return handleErrorOutput(
      {
        code: "NOT_FOUND",
        message: `Database state does not exist at ${home}`
      },
      json,
      stdout,
      stderr
    );
  }

  // 4d. Open core
  let core;
  try {
    core = openCoreImpl({ home });
  } catch (err: unknown) {
    if (err instanceof CoreOpenError) {
      return handleErrorOutput(
        { code: err.code, message: err.message },
        json,
        stdout,
        stderr
      );
    }
    return handleErrorOutput(
      {
        code: "IO",
        message: err instanceof Error ? err.message : "Failed to open state database"
      },
      json,
      stdout,
      stderr
    );
  }

  // 4e. Execute request
  try {
    const response: Response = await core.execute(request);
    if (response.ok) {
      handleSuccessOutput(operation, response as any, json, stdout);
      return 0;
    } else {
      return handleErrorOutput(response.error, json, stdout, stderr);
    }
  } catch (err: unknown) {
    return handleErrorOutput(
      {
        code: "INTERNAL",
        message: err instanceof Error ? err.message : "Unexpected internal execution failure"
      },
      json,
      stdout,
      stderr
    );
  } finally {
    try {
      core.close();
    } catch {
      // Ignore errors on closing
    }
  }
}

// Invoke when executed directly as script
const isDirectExecution =
  process.argv[1] &&
  (process.argv[1] === fileURLToPath(import.meta.url) ||
    process.argv[1].endsWith("/lore") ||
    process.argv[1].endsWith("/company") ||
    process.argv[1].endsWith("/main.ts") ||
    process.argv[1].endsWith("/main.js"));

if (isDirectExecution) {
  runCli(process.argv.slice(2)).then((code) => {
    process.exit(code);
  });
}
