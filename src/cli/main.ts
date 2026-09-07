#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { openCore, CoreOpenError, parseRequest, validationDetails } from "../core/index.js";
import type { Request, Response } from "../core/contracts.js";
import { parseCliArgs, CliValidationError, READ_OPERATIONS, OperationName } from "./args.js";
import { readBoundedInput, CliInputError } from "./input.js";
import { handleSuccessOutput, handleErrorOutput } from "./output.js";
import { generateInstructions } from "./instructions.js";
import { resolveHomeDir, doesStateExist } from "./home.js";

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
  lore <namespace> <verb> --input <file|-> [--home <dir>] [--json]
  lore instructions show --project <uuid> --agent <agent-id> [--home <dir>]
  lore --help

Everyday:
  context                 Retrieve formatted context (work or review mode)
  handoff                 Submit a completed or blocked handoff with git evidence
  ask                     Ask a task-linked question
  inbox                   List inbox events for an agent

Other operations:
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
  instructions show       Print generic session instruction template

Options:
  --input <file|->        Path to JSON envelope input file or '-' for stdin (max 64 KiB)
  --home <dir>            State directory (default: LOREFORGE_HOME or ~/.loreforge/context-v1)
  --json                  Output exactly one JSON response line on stdout
  --project <uuid>        Project UUID (for instructions show)
  --agent <agent-id>      Agent ID (for instructions show)
  --help, -h              Show this help message
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

  // 3. Handle Instructions Show
  if (parsed.kind === "instructions") {
    try {
      const homeDir = resolveHomeDir(parsed.home, env);
      const text = generateInstructions({
        projectId: parsed.projectId,
        agentId: parsed.agentId,
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
  const { operation, inputPath, home: explicitHome, json } = parsed;
  const home = resolveHomeDir(explicitHome, env);

  // 4a. Read bounded input (enforcing 64 KiB byte limit, UTF-8, JSON shape)
  let rawPayload: Record<string, unknown>;
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

  // 4b. Pure validation via parseRequest before opening state
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
