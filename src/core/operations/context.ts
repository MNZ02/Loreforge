import type { DatabaseSync } from "node:sqlite";
import type {
  ContextGetData,
  ContextSnapshot,
  Decision,
  Question,
  Request,
  ReviewHandoff,
  Task,
  WorkHandoff,
} from "../contracts.js";
import { OpError } from "../errors.js";
import { observeCurrentGit } from "../../evidence/git.js";
import { withRead } from "../../storage/db.js";
import { requireProject, toProject, toTask, type TaskRow } from "./common.js";
import { toDecision, type DecisionRow } from "./decisions.js";
import { toHandoff, type HandoffRow } from "./handoffs.js";
import { toQuestion, type AnswerRow, type QuestionRow } from "./messages.js";

type ContextGetRequest = Extract<Request, { operation: "context.get" }>;

const SELECTION_CAP = 20;

function placeholders(count: number): string {
  return count === 0 ? "" : new Array(count).fill("?").join(",");
}

function toReviewHandoff(handoff: WorkHandoff): ReviewHandoff {
  const { summary: _summary, unresolved: _unresolved, nextSteps: _nextSteps, ...rest } = handoff;
  return rest;
}

interface QuestionJoinRow extends QuestionRow {
  answer_question_id: string | null;
  answer_id: string | null;
  answer_actor_id: string | null;
  answer_body: string | null;
  answer_created_at: number | null;
}

function joinRowToQuestion(row: QuestionJoinRow): Question {
  const { answer_question_id, answer_id, answer_actor_id, answer_body, answer_created_at, ...base } = row;
  const answer: AnswerRow | undefined =
    answer_question_id === null ||
    answer_id === null ||
    answer_actor_id === null ||
    answer_body === null ||
    answer_created_at === null
      ? undefined
      : {
          question_id: answer_question_id,
          id: answer_id,
          actor_id: answer_actor_id,
          body: answer_body,
          created_at: answer_created_at,
        };
  return toQuestion(base, answer);
}

export async function getContext(db: DatabaseSync, nowMs: number, request: ContextGetRequest): Promise<ContextGetData> {
  const project = requireProject(db, request.projectId);
  // Git observation happens outside the read transaction: never hold DB locks
  // during Git. A missing/unreadable checkout yields nulls plus an error.
  const currentGit = await observeCurrentGit(project.root, nowMs);
  const mode = request.payload.mode;

  const snapshot = withRead(db, (): ContextSnapshot => {
    const taskRow = db.prepare("SELECT * FROM tasks WHERE id = ? AND project_id = ?").get(
      request.payload.taskId,
      request.projectId,
    ) as unknown as TaskRow | undefined;
    if (!taskRow) throw OpError.notFound("task not found");
    const task = toTask(db, taskRow);

    const depRows = db
      .prepare(
        "SELECT t.* FROM task_dependencies d JOIN tasks t ON t.id = d.depends_on_task_id WHERE d.task_id = ? LIMIT ?",
      )
      .all(taskRow.id, SELECTION_CAP) as unknown as TaskRow[];
    const dependencies: Task[] = depRows.map((row) => toTask(db, row));
    const scopeIds = [taskRow.id, ...depRows.map((row) => row.id)];

    // Handoffs for the task and its direct dependencies, newest first.
    const handoffScope = placeholders(scopeIds.length);
    const handoffTotal = (
      db
        .prepare(`SELECT COUNT(*) AS n FROM handoffs WHERE task_id IN (${handoffScope})`)
        .get(...scopeIds) as { n: number }
    ).n;
    const handoffRows = db
      .prepare(
        `SELECT * FROM handoffs WHERE task_id IN (${handoffScope}) ORDER BY created_at DESC, id ASC LIMIT ?`,
      )
      .all(...scopeIds, SELECTION_CAP) as unknown as HandoffRow[];
    const handoffs: Array<WorkHandoff | ReviewHandoff> = handoffRows.map((row) =>
      mode === "review" ? toReviewHandoff(toHandoff(row)) : toHandoff(row),
    );

    // Questions for the current task only. Review mode omits every question
    // body from the snapshot and reports the policy count instead.
    const questionTotal = (
      db.prepare("SELECT COUNT(*) AS n FROM questions WHERE task_id = ?").get(taskRow.id) as {
        n: number;
      }
    ).n;
    let questions: Question[] = [];
    let omittedQuestions = 0;
    let policyQuestions = 0;
    if (mode === "review") {
      policyQuestions = questionTotal;
    } else {
      const questionRows = db
        .prepare(
          `SELECT q.*, a.question_id AS answer_question_id, a.id AS answer_id, a.actor_id AS answer_actor_id, a.body AS answer_body, a.created_at AS answer_created_at
           FROM questions q LEFT JOIN answers a ON a.question_id = q.id
           WHERE q.task_id = ?
           ORDER BY CASE WHEN a.question_id IS NULL THEN 0 ELSE 1 END, q.created_at DESC, q.id ASC
           LIMIT ?`,
        )
        .all(taskRow.id, SELECTION_CAP) as unknown as QuestionJoinRow[];
      questions = questionRows.map(joinRowToQuestion);
      omittedQuestions = Math.max(0, questionTotal - questions.length);
    }

    // Active project-wide decisions plus active decisions whose paths exactly
    // match a reported file path on a selected handoff. Newest first.
    const filePaths = new Set<string>();
    for (const handoff of handoffs) {
      const full = handoff as WorkHandoff;
      if (!full.evidence || !Array.isArray(full.evidence.files)) continue;
      for (const file of full.evidence.files) filePaths.add(file.path);
    }
    const wideTotal = (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM decisions WHERE project_id = ? AND superseded_by_id IS NULL AND paths_json = '[]'",
        )
        .get(request.projectId) as { n: number }
    ).n;
    const wideRows = db
      .prepare(
        "SELECT * FROM decisions WHERE project_id = ? AND superseded_by_id IS NULL AND paths_json = '[]' ORDER BY created_at DESC, id ASC LIMIT ?",
      )
      .all(request.projectId, SELECTION_CAP) as unknown as DecisionRow[];
    let pathTotal = 0;
    let pathRows: DecisionRow[] = [];
    if (filePaths.size > 0) {
      const paths = [...filePaths];
      const list = placeholders(paths.length);
      pathTotal = (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM decisions d WHERE d.project_id = ? AND d.superseded_by_id IS NULL AND d.paths_json != '[]' AND EXISTS (SELECT 1 FROM json_each(d.paths_json) j WHERE j.value IN (${list}))`,
          )
          .get(request.projectId, ...paths) as { n: number }
      ).n;
      pathRows = db
        .prepare(
          `SELECT d.* FROM decisions d WHERE d.project_id = ? AND d.superseded_by_id IS NULL AND d.paths_json != '[]' AND EXISTS (SELECT 1 FROM json_each(d.paths_json) j WHERE j.value IN (${list})) ORDER BY d.created_at DESC, d.id ASC LIMIT ?`,
        )
        .all(request.projectId, ...paths, SELECTION_CAP) as unknown as DecisionRow[];
    }
    const merged: DecisionRow[] = [...wideRows, ...pathRows].sort((a, b) =>
      a.created_at !== b.created_at ? b.created_at - a.created_at : a.id < b.id ? -1 : 1,
    );
    const selectedDecisions = merged.slice(0, SELECTION_CAP);
    const decisions: Decision[] = selectedDecisions.map(toDecision);

    return {
      project: toProject(project),
      task,
      dependencies,
      handoffs,
      questions,
      decisions,
      currentGit,
      omitted: {
        handoffs: Math.max(0, handoffTotal - handoffs.length),
        questions: omittedQuestions,
        decisions: Math.max(0, wideTotal + pathTotal - decisions.length),
        policy:
          mode === "review"
            ? { handoffNarratives: true, questions: policyQuestions }
            : { handoffNarratives: false, questions: 0 },
      },
      mode,
    };
  });

  return { snapshot };
}
