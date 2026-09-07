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

export interface HelpParsedArgs {
  kind: "help";
  topic?: string;
}

export type ParsedArgs = StandardParsedArgs | InstructionsParsedArgs | HelpParsedArgs;

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
    } else if (arg.startsWith("--agent=")) {
      agentId = arg.slice("--agent=".length);
      if (!agentId) throw new CliValidationError("Empty value for --agent");
    } else if (arg.startsWith("-")) {
      throw new CliValidationError(`Unknown flag: ${arg}`);
    } else {
      positionals.push(arg);
    }
    i++;
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
