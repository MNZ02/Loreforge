import {
  closeCore,
  execOk,
  gitDirty,
  gitHead,
  initGitRepo,
  mutRequest,
  openTestCore,
  regRequest,
  removeDir,
  type TestCore,
} from "./harness.js";
import type { Handoff, Project, Question, Task } from "../../src/core/contracts.js";

// Shared multi-step flows for storage tests: project setup plus the
// create/claim/submit/ask/answer verbs with honest Git evidence.

export interface FlowEnv {
  held: TestCore;
  repo: string;
  projectId: string;
  cleanup: () => void;
}

export async function setupFlow(now?: () => number): Promise<FlowEnv> {
  const held: TestCore = openTestCore(undefined, now);
  const repo = initGitRepo();
  const data = await execOk<{ project: Project }>(
    held.core,
    regRequest("project.register", "setup", { root: repo, name: "P" }),
  );
  await execOk(held.core, regRequest("agent.register", "setup-muse", { id: "muse", displayName: "Muse" }));
  await execOk(held.core, regRequest("agent.register", "setup-flash", { id: "flash", displayName: "Flash" }));
  await execOk(held.core, regRequest("agent.register", "setup-human", { id: "human", displayName: "Human" }));
  return {
    held,
    repo,
    projectId: data.project.id,
    cleanup: () => {
      removeDir(repo);
      try {
        closeCore(held.core);
      } catch {
        // Cleanup best-effort.
      }
      removeDir(held.home);
    },
  };
}

export async function flowCreate(
  env: FlowEnv,
  actor: string,
  requestId: string,
  dependsOn: string[] = [],
): Promise<Task> {
  const data = await execOk<{ task: Task }>(
    env.held.core,
    mutRequest("task.create", env.projectId, actor, requestId, {
      title: `Task ${requestId}`,
      description: "Flow task",
      dependsOn,
    }),
  );
  return data.task;
}

export async function flowClaim(
  env: FlowEnv,
  actor: string,
  requestId: string,
  taskId: string,
): Promise<{ task: Task; claimToken: string }> {
  return execOk<{ task: Task; claimToken: string }>(
    env.held.core,
    mutRequest("task.claim", env.projectId, actor, requestId, { taskId }),
  );
}

export interface SubmitOptions {
  outcome?: "completed" | "blocked";
  summary?: string;
  files?: Array<{ path: string; change: "added" | "modified" | "deleted" }>;
  blockingQuestionIds?: string[];
}

export async function flowSubmit(
  env: FlowEnv,
  actor: string,
  requestId: string,
  taskId: string,
  claimToken: string,
  options: SubmitOptions = {},
): Promise<{ task: Task; handoff: Handoff }> {
  return execOk<{ task: Task; handoff: Handoff }>(
    env.held.core,
    mutRequest("handoff.submit", env.projectId, actor, requestId, {
      taskId,
      claimToken,
      outcome: options.outcome ?? "completed",
      summary: options.summary ?? "All done",
      evidence: {
        checkoutRoot: env.repo,
        head: gitHead(env.repo),
        dirty: gitDirty(env.repo),
        files: options.files ?? [{ path: "src/a.ts", change: "modified" }],
        checks: [{ command: "npm run test:core", outcome: "passed", summary: "green" }],
      },
      unresolved: [],
      nextSteps: [],
      blockingQuestionIds: options.blockingQuestionIds ?? [],
    }),
  );
}

export async function flowAsk(
  env: FlowEnv,
  actor: string,
  requestId: string,
  taskId: string,
  toAgentId: string,
  body = "What should I do?",
): Promise<Question> {
  const data = await execOk<{ question: Question }>(
    env.held.core,
    mutRequest("question.ask", env.projectId, actor, requestId, { taskId, toAgentId, body }),
  );
  return data.question;
}

export async function flowAnswer(
  env: FlowEnv,
  actor: string,
  requestId: string,
  questionId: string,
  body = "Do it this way.",
): Promise<Question> {
  const data = await execOk<{ question: Question }>(
    env.held.core,
    mutRequest("question.answer", env.projectId, actor, requestId, { questionId, body }),
  );
  return data.question;
}
