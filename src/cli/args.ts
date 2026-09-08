import type { Operation } from "../core/schemas/request.js";
export type OperationName = Operation;

export const READ_OPERATIONS: ReadonlySet<OperationName> = new Set([
  "project.list", "agent.list", "decision.list", "note.history", "index.check", "review.list",
  "task.get",
  "task.list",
  "inbox.list",
  "context.get",
  "note.get",
  "search.query",
]);

export interface StandardParsedArgs {
  kind: "operation";
  operation: OperationName;
  inputPath: string | null;
  builtEnvelope?: Record<string, unknown>;
  projectId?: string;
  home?: string;
  json: boolean;
  help: boolean;
}

export interface InstructionsParsedArgs {
  kind: "instructions";
  projectId: string;
  agentId: string;
  mode?: "work" | "review";
  home?: string;
  help: boolean;
}

export type InitRole = "implement" | "review" | "both";

export interface InitAgentSpec {
  id: string;
  role: InitRole;
}

export interface InitParsedArgs {
  kind: "init";
  home?: string;
  json: boolean;
  root?: string;
  name?: string;
  agents: InitAgentSpec[];
  writeRules: boolean;
  writeUserRules: boolean;
  demo: boolean;
  detect: boolean;
  help: boolean;
}

export interface DetectParsedArgs {
  kind: "detect";
  json: boolean;
  help: boolean;
}

export interface HelpParsedArgs {
  kind: "help";
  topic?: string;
}

export interface ManagementArgs {
  kind: "management"; command: "doctor" | "current" | "backup" | "restore" | "export" | "mcp";
  home?: string; input?: string; output?: string; projectId?: string; format: "json" | "markdown"; json: boolean;
}

function parseManagement(args: string[]): ManagementArgs {
  const command = (args[0] === "project" ? "current" : args[0]) as ManagementArgs["command"];
  const result: ManagementArgs = { kind: "management", command, format: "json", json: false };
  const allowed: Record<string, string[]> = { doctor: ["home"], current: ["home"], backup: ["home", "output"], restore: ["home", "input"], export: ["home", "output", "project", "format"], mcp: ["home"] };
  for (let i = args[0] === "project" ? 2 : 1; i < args.length; i++) {
    if (args[i] === "--json") { result.json = true; continue; }
    const match = /^(--[a-z]+)(?:=(.*))?$/.exec(args[i]);
    const flag = match?.[1].slice(2);
    if (!flag || !allowed[command].includes(flag)) throw new CliValidationError(`Unknown flag: ${args[i]}`);
    const value = match?.[2] ?? args[++i];
    if (!value || value.startsWith("--")) throw new CliValidationError(`Missing value for --${flag}`);
    if (flag === "format" && value !== "json" && value !== "markdown") throw new CliValidationError("format must be json or markdown");
    (result as unknown as Record<string, unknown>)[flag === "project" ? "projectId" : flag] = value;
  }
  if (command === "backup" && !result.output) throw new CliValidationError("backup requires --output <file>");
  if (command === "restore" && (!result.input || !result.home)) throw new CliValidationError("restore requires --input <backup> and --home <new-directory>");
  return result;
}

export type ParsedArgs =
  | ManagementArgs
  | StandardParsedArgs
  | InstructionsParsedArgs
  | InitParsedArgs
  | DetectParsedArgs
  | HelpParsedArgs;

// Everyday verbs Astra named: lore context / handoff / ask / inbox.
// Full namespace+verb forms remain valid.
export const SHORT_COMMANDS: Record<string, OperationName> = {
  context: "context.get",
  handoff: "handoff.submit",
  ask: "question.ask",
  inbox: "inbox.list",
  search: "search.query",
};

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const SEARCH_ONLY_FLAGS = new Set(["--query", "--files", "--limit", "--include-superseded"]);

const VALID_OPERATIONS: Record<string, Record<string, OperationName>> = {
  index: { check: "index.check", rebuild: "index.rebuild" },
  review: { record: "review.record", list: "review.list" },
  project: {
    list: "project.list",    register: "project.register"
  },
  agent: {
    list: "agent.list",    register: "agent.register"
  },
  task: {
    create: "task.create",
    get: "task.get",
    list: "task.list",
    claim: "task.claim",
    renew: "task.renew",
    release: "task.release",
    reopen: "task.reopen",
    cancel: "task.cancel"
  },
  handoff: {
    submit: "handoff.submit"
  },
  question: {
    ask: "question.ask",
    answer: "question.answer"
  },
  inbox: {
    list: "inbox.list"
  },
  decision: {
    list: "decision.list",    record: "decision.record"
  },
  context: {
    get: "context.get"
  },
  note: {
    history: "note.history",    add: "note.add",
    get: "note.get"
  },
  search: {
    query: "search.query"
  }
};

export class CliValidationError extends Error {
  public readonly code = "VALIDATION" as const;
  public readonly exitCode = 2;
  constructor(message: string) {
    super(message);
    this.name = "CliValidationError";
  }
}

const INIT_ROLES = new Set<InitRole>(["implement", "review", "both"]);
const AGENT_ID_RE = /^[a-z][a-z0-9_-]{0,63}$/;

/** Parse `id` or `id:implement|review|both`. Default role is both. */
export function parseAgentSpec(raw: string): InitAgentSpec {
  const trimmed = raw.trim();
  const colon = trimmed.indexOf(":");
  const id = (colon === -1 ? trimmed : trimmed.slice(0, colon)).trim();
  const roleRaw = (colon === -1 ? "both" : trimmed.slice(colon + 1)).trim();
  if (!AGENT_ID_RE.test(id)) {
    throw new CliValidationError(`Invalid agent id '${id}'`);
  }
  if (!INIT_ROLES.has(roleRaw as InitRole)) {
    throw new CliValidationError(`Invalid role '${roleRaw}' for agent '${id}' (use implement, review, or both)`);
  }
  return { id, role: roleRaw as InitRole };
}

/**
 * Parses raw command-line argument arrays strictly according to CONTRACT.md.
 * Throws CliValidationError on unknown flags, unknown commands, or missing required options.
 */
export function parseCliArgs(args: string[]): ParsedArgs {
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    // If command prefix precedes --help, provide context-aware help
    if (args.length > 0 && !args[0].startsWith("-")) {
      const ns = args[0];
      const verb = args[1] && !args[1].startsWith("-") ? args[1] : undefined;
      return { kind: "help", topic: verb ? `${ns} ${verb}` : ns };
    }
    return { kind: "help" };
  }

  if (["doctor", "backup", "restore", "export", "mcp"].includes(args[0]) || (args[0] === "project" && args[1] === "current")) return parseManagement(args);
  const positionals: string[] = [];
  let inputPath: string | undefined;
  let home: string | undefined;
  let json = false;
  let projectId: string | undefined;
  let agentId: string | undefined;
  const agentSpecs: string[] = [];
  let root: string | undefined;
  let name: string | undefined;
  let writeRules = false;
  let writeUserRules = false;
  let demo = false;
  let detect = true;
  let mode: "work" | "review" | undefined;
  let query: string | undefined;
  let claimable: boolean | undefined, expired: boolean | undefined, status: string | undefined, cursor: string | undefined;
  const filesRaw: string[] = [];
  let limitRaw: string | undefined;
  let includeSuperseded = false;

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === "--input") {
      i++;
      if (i >= args.length || args[i].startsWith("--")) {
        throw new CliValidationError("Missing value for --input flag");
      }
      inputPath = args[i];
    } else if (arg.startsWith("--input=")) {
      inputPath = arg.slice("--input=".length);
      if (!inputPath) throw new CliValidationError("Empty value for --input");
    } else if (arg === "--home") {
      i++;
      if (i >= args.length || args[i].startsWith("--")) {
        throw new CliValidationError("Missing value for --home flag");
      }
      home = args[i];
    } else if (arg.startsWith("--home=")) {
      home = arg.slice("--home=".length);
      if (!home) throw new CliValidationError("Empty value for --home");
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--project") {
      i++;
      if (i >= args.length || args[i].startsWith("--")) {
        throw new CliValidationError("Missing value for --project flag");
      }
      projectId = args[i];
    } else if (arg.startsWith("--project=")) {
      projectId = arg.slice("--project=".length);
      if (!projectId) throw new CliValidationError("Empty value for --project");
    } else if (arg === "--agent") {
      i++;
      if (i >= args.length || args[i].startsWith("--")) {
        throw new CliValidationError("Missing value for --agent flag");
      }
      agentId = args[i];
      agentSpecs.push(args[i]);
    } else if (arg.startsWith("--agent=")) {
      agentId = arg.slice("--agent=".length);
      if (!agentId) throw new CliValidationError("Empty value for --agent");
      agentSpecs.push(agentId);
    } else if (arg === "--root") {
      i++;
      if (i >= args.length || args[i].startsWith("--")) {
        throw new CliValidationError("Missing value for --root flag");
      }
      root = args[i];
    } else if (arg.startsWith("--root=")) {
      root = arg.slice("--root=".length);
      if (!root) throw new CliValidationError("Empty value for --root");
    } else if (arg === "--name") {
      i++;
      if (i >= args.length || args[i].startsWith("--")) {
        throw new CliValidationError("Missing value for --name flag");
      }
      name = args[i];
    } else if (arg.startsWith("--name=")) {
      name = arg.slice("--name=".length);
      if (!name) throw new CliValidationError("Empty value for --name");
    } else if (arg === "--write-rules") {
      writeRules = true;
    } else if (arg === "--write-user-rules") {
      writeUserRules = true;
    } else if (arg === "--demo") {
      demo = true;
    } else if (arg === "--detect") {
      detect = true;
    } else if (arg === "--no-detect") {
      detect = false;
    } else if (arg === "--mode") {
      const value = args[++i];
      if (value !== "work" && value !== "review") throw new CliValidationError("mode must be work or review");
      mode = value;
    } else if (arg === "--claimable") {
      claimable = true;
    } else if (arg === "--expired") {
      expired = true;
    } else if (arg === "--status" || arg === "--cursor") {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new CliValidationError(`Missing value for ${arg}`);
      if (arg === "--status") status = value; else cursor = value;
    } else if (arg === "--query") {
      i++;
      if (i >= args.length || args[i].startsWith("--")) {
        throw new CliValidationError("Missing value for --query flag");
      }
      query = args[i];
    } else if (arg.startsWith("--query=")) {
      query = arg.slice("--query=".length);
      if (!query) throw new CliValidationError("Empty value for --query");
    } else if (arg === "--files") {
      i++;
      if (i >= args.length || args[i].startsWith("--")) {
        throw new CliValidationError("Missing value for --files flag");
      }
      filesRaw.push(args[i]);
    } else if (arg.startsWith("--files=")) {
      const value = arg.slice("--files=".length);
      if (!value) throw new CliValidationError("Empty value for --files");
      filesRaw.push(value);
    } else if (arg === "--limit") {
      i++;
      if (i >= args.length || args[i].startsWith("--")) {
        throw new CliValidationError("Missing value for --limit flag");
      }
      limitRaw = args[i];
    } else if (arg.startsWith("--limit=")) {
      limitRaw = arg.slice("--limit=".length);
      if (!limitRaw) throw new CliValidationError("Empty value for --limit");
    } else if (arg === "--include-superseded") {
      includeSuperseded = true;
    } else if (arg.startsWith("-")) {
      throw new CliValidationError(`Unknown flag: ${arg}`);
    } else {
      positionals.push(arg);
    }
    i++;
  }

  if (mode && positionals.join(" ") !== "instructions show") throw new CliValidationError("--mode is only valid for instructions show");
  const isTaskList = positionals.join(" ") === "task list";
  const taskFlags = claimable !== undefined || expired !== undefined || status !== undefined || cursor !== undefined;
  if (taskFlags && !isTaskList) throw new CliValidationError("Task filters are only valid for task list");
  if (isTaskList && inputPath && (taskFlags || limitRaw !== undefined)) throw new CliValidationError("Use task filters inside --input, or use flags; do not mix them");
  if (isTaskList && !inputPath && query === undefined && filesRaw.length === 0 && !includeSuperseded) {
    return { kind: "operation", operation: "task.list", inputPath: null, projectId, home, json, help: false,
      builtEnvelope: { schemaVersion: 1, ...(projectId ? {projectId} : {}), payload: { ...(status ? {status} : {}), ...(cursor ? {cursor} : {}), ...(claimable ? {claimable} : {}), ...(expired ? {expired} : {}), ...(limitRaw !== undefined ? {limit: parseLimit(limitRaw)} : {}) } } };
  }
  const searchFlagsUsed =
    query !== undefined || filesRaw.length > 0 || limitRaw !== undefined || includeSuperseded;
  const isSearchCommand =
    (positionals.length === 1 && positionals[0] === "search") ||
    (positionals[0] === "search" && positionals[1] === "query");
  if (searchFlagsUsed && !isSearchCommand) {
    const used = [...SEARCH_ONLY_FLAGS].find((flag) =>
      args.some((arg) => arg === flag || arg.startsWith(`${flag}=`)),
    );
    throw new CliValidationError(`Unknown flag: ${used ?? "--query"}`);
  }

  if (isSearchCommand && inputPath && searchFlagsUsed) {
    throw new CliValidationError("Use search filters inside --input, or use --query with flags; do not mix them");
  }

  if (positionals.length === 1 && positionals[0] === "detect") {
    return { kind: "detect", json, help: false };
  }

  if (positionals.length === 1 && positionals[0] === "init") {
    const seen = new Set<string>();
    const agents: InitAgentSpec[] = [];
    for (const spec of agentSpecs) {
      const parsedAgent = parseAgentSpec(spec);
      if (seen.has(parsedAgent.id)) {
        throw new CliValidationError(`Duplicate agent id '${parsedAgent.id}'`);
      }
      seen.add(parsedAgent.id);
      agents.push(parsedAgent);
    }
    return {
      kind: "init",
      home,
      json,
      root,
      name,
      agents,
      writeRules,
      writeUserRules,
      demo,
      detect,
      help: false,
    };
  }

  if (positionals.length === 1 && SHORT_COMMANDS[positionals[0]]) {
    if (positionals[0] === "search" && query !== undefined) {
      return buildSearchArgs({ inputPath, query, filesRaw, limitRaw, includeSuperseded, projectId, home, json });
    }
    if (!inputPath) {
      throw new CliValidationError("Missing required --input <file|-> argument");
    }
    return {
      kind: "operation",
      operation: SHORT_COMMANDS[positionals[0]],
      inputPath,
      ...(projectId ? {projectId} : {}),
      home,
      json,
      help: false
    };
  }

  if (positionals.length < 2) {
    throw new CliValidationError(`Expected <command> or <namespace> <verb>, received: ${positionals.join(" ")}`);
  }

  const [namespace, verb, ...extraPos] = positionals;
  if (namespace === "note" && verb === "get" && extraPos.length === 1) {
    return buildNoteGetArgs({ noteId: extraPos[0], inputPath, projectId, home, json });
  }
  if (extraPos.length > 0) {
    throw new CliValidationError(`Unexpected positional arguments: ${extraPos.join(" ")}`);
  }

  // Handle instructions show
  if (namespace === "instructions" && verb === "show") {
    if (!projectId) {
      throw new CliValidationError("Missing required --project flag for instructions show");
    }
    if (!agentId) {
      throw new CliValidationError("Missing required --agent flag for instructions show");
    }
    return {
      kind: "instructions",
      projectId,
      agentId,
      ...(mode ? {mode} : {}),
      home,
      help: false
    };
  }

  const nsOps = VALID_OPERATIONS[namespace];
  if (!nsOps) {
    throw new CliValidationError(`Unknown namespace: ${namespace}`);
  }
  const op = nsOps[verb];
  if (!op) {
    throw new CliValidationError(`Unknown verb '${verb}' for namespace '${namespace}'`);
  }

  if (op === "search.query" && query !== undefined) {
    return buildSearchArgs({ inputPath, query, filesRaw, limitRaw, includeSuperseded, projectId, home, json });
  }

  if (!inputPath && ["project.list", "agent.list", "decision.list", "index.check"].includes(op)) {
    return {kind:"operation",operation:op,inputPath:null,projectId,home,json,help:false,builtEnvelope:{schemaVersion:1,payload:{}}};
  }
  if (!inputPath) {
    throw new CliValidationError("Missing required --input <file|-> argument");
  }

  return {
    kind: "operation",
    operation: op,
    inputPath,
    ...(projectId ? {projectId} : {}),
    home,
    json,
    help: false
  };
}

function splitFiles(values: string[]): string[] {
  const files: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    for (const part of value.split(",")) {
      const path = part.trim();
      if (!path) continue;
      if (seen.has(path)) {
        throw new CliValidationError(`Duplicate file path '${path}'`);
      }
      seen.add(path);
      files.push(path);
    }
  }
  return files;
}

function parseLimit(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  if (!/^[0-9]+$/.test(raw)) {
    throw new CliValidationError("--limit must be an integer between 1 and 100");
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new CliValidationError("--limit must be an integer between 1 and 100");
  }
  return value;
}

function buildSearchArgs(params: {
  inputPath?: string;
  query: string;
  filesRaw: string[];
  limitRaw?: string;
  includeSuperseded: boolean;
  projectId?: string;
  home?: string;
  json: boolean;
}): StandardParsedArgs {
  if (params.inputPath) {
    throw new CliValidationError("Use either --input or --query, not both");
  }

  const payload: Record<string, unknown> = {
    query: params.query,
    files: splitFiles(params.filesRaw),
    includeSuperseded: params.includeSuperseded,
  };
  const limit = parseLimit(params.limitRaw);
  if (limit !== undefined) payload.limit = limit;
  return {
    kind: "operation",
    operation: "search.query",
    inputPath: null,
    builtEnvelope: {
      schemaVersion: 1,
      ...(params.projectId ? { projectId: params.projectId } : {}),
      payload,
    },
    home: params.home,
    json: params.json,
    help: false,
  };
}

function buildNoteGetArgs(params: {
  noteId: string;
  inputPath?: string;
  projectId?: string;
  home?: string;
  json: boolean;
}): StandardParsedArgs {
  if (params.inputPath) {
    throw new CliValidationError("Use either --input or a note id positional, not both");
  }
  if (!UUID_RE.test(params.noteId)) {
    throw new CliValidationError("note get id must be a UUID");
  }

  return {
    kind: "operation",
    operation: "note.get",
    inputPath: null,
    builtEnvelope: {
      schemaVersion: 1,
      ...(params.projectId ? { projectId: params.projectId } : {}),
      payload: { noteId: params.noteId },
    },
    home: params.home,
    json: params.json,
    help: false,
  };
}
