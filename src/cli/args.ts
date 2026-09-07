export type OperationName =
  | "project.register"
  | "agent.register"
  | "task.create"
  | "task.get"
  | "task.list"
  | "task.claim"
  | "task.renew"
  | "task.release"
  | "task.reopen"
  | "task.cancel"
  | "handoff.submit"
  | "question.ask"
  | "question.answer"
  | "inbox.list"
  | "decision.record"
  | "context.get";

export const READ_OPERATIONS: ReadonlySet<OperationName> = new Set([
  "task.get",
  "task.list",
  "inbox.list",
  "context.get"
]);

export interface StandardParsedArgs {
  kind: "operation";
  operation: OperationName;
  inputPath: string;
  home?: string;
  json: boolean;
  help: boolean;
}

export interface InstructionsParsedArgs {
  kind: "instructions";
  projectId: string;
  agentId: string;
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

export type ParsedArgs =
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
};

const VALID_OPERATIONS: Record<string, Record<string, OperationName>> = {
  project: {
    register: "project.register"
  },
  agent: {
    register: "agent.register"
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
    record: "decision.record"
  },
  context: {
    get: "context.get"
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
  let demo = false;
  let detect = true;

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
    } else if (arg === "--demo") {
      demo = true;
    } else if (arg === "--detect") {
      detect = true;
    } else if (arg === "--no-detect") {
      detect = false;
    } else if (arg.startsWith("-")) {
      throw new CliValidationError(`Unknown flag: ${arg}`);
    } else {
      positionals.push(arg);
    }
    i++;
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
      demo,
      detect,
      help: false,
    };
  }

  if (positionals.length === 1 && SHORT_COMMANDS[positionals[0]]) {
    if (!inputPath) {
      throw new CliValidationError("Missing required --input <file|-> argument");
    }
    return {
      kind: "operation",
      operation: SHORT_COMMANDS[positionals[0]],
      inputPath,
      home,
      json,
      help: false
    };
  }

  if (positionals.length < 2) {
    throw new CliValidationError(`Expected <command> or <namespace> <verb>, received: ${positionals.join(" ")}`);
  }

  const [namespace, verb, ...extraPos] = positionals;
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

  if (!inputPath) {
    throw new CliValidationError("Missing required --input <file|-> argument");
  }

  return {
    kind: "operation",
    operation: op,
    inputPath,
    home,
    json,
    help: false
  };
}
