// Exported request/response/data types and parser for the v1 contract.
// Domain schemas live under schemas/ and are re-exported here; the M0
// contract hash covers this file plus every file under schemas/.

export {
  AgentIdSchema,
  AfterSchema,
  AbsolutePathSchema,
  ClaimTokenSchema,
  HeadSchema,
  LIMITS,
  LimitSchema,
  SEARCH_DEFAULT_LIMIT,
  RelativePathSchema,
  SCHEMA_VERSION,
  TaskStatusSchema,
  UuidSchema,
  RequestIdSchema,
  requiredText,
  uniqueArray,
} from "./schemas/common.js";
export { AgentRegisterPayloadSchema, ProjectRegisterPayloadSchema } from "./schemas/registration.js";
export type {
  AgentRegisterPayload,
  ProjectRegisterPayload,
} from "./schemas/registration.js";
export {
  TaskClaimPayloadSchema,
  TaskCreatePayloadSchema,
  TaskGetPayloadSchema,
  TaskIdOnlyPayloadSchema,
  TaskLeasePayloadSchema,
  TaskListPayloadSchema,
} from "./schemas/tasks.js";
export type {
  TaskClaimPayload,
  TaskCreatePayload,
  TaskGetPayload,
  TaskIdOnlyPayload,
  TaskLeasePayload,
  TaskListPayload,
} from "./schemas/tasks.js";
export { EvidenceInputSchema, HandoffSubmitPayloadSchema } from "./schemas/handoffs.js";
export type { EvidenceInput, HandoffSubmitPayload } from "./schemas/handoffs.js";
export {
  InboxListPayloadSchema,
  QuestionAnswerPayloadSchema,
  QuestionAskPayloadSchema,
} from "./schemas/questions.js";
export type {
  InboxListPayload,
  QuestionAnswerPayload,
  QuestionAskPayload,
} from "./schemas/questions.js";
export { DecisionRecordPayloadSchema } from "./schemas/decisions.js";
export type { DecisionRecordPayload } from "./schemas/decisions.js";
export { ContextGetPayloadSchema } from "./schemas/context.js";
export type { ContextGetPayload } from "./schemas/context.js";
export {
  NoteAddPayloadSchema,
  NoteGetPayloadSchema,
  NoteStatusSchema,
  SearchQueryPayloadSchema,
} from "./schemas/notes.js";
export type {
  NoteAddPayload,
  NoteGetPayload,
  NoteStatus,
  SearchQueryPayload,
} from "./schemas/notes.js";
export { OPERATIONS, RequestSchema, parseRequest, validationDetails } from "./schemas/request.js";
export type { Operation, Request, ValidationIssue } from "./schemas/request.js";

// Error codes and their CLI exit codes.
export const ERROR_CODES = [
  "VALIDATION",
  "NOT_FOUND",
  "CONFLICT",
  "STALE_CLAIM",
  "BUSY",
  "IO",
  "INTERNAL",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const EXIT_CODES: Record<ErrorCode, number> = {
  VALIDATION: 2,
  NOT_FOUND: 3,
  CONFLICT: 4,
  STALE_CLAIM: 5,
  BUSY: 6,
  IO: 7,
  INTERNAL: 1,
};

// Thrown by openCore when the state directory cannot be opened (IO) or its
// startup lock cannot be acquired within the timeout (BUSY). Carries the same
// code/message fields the CLI maps to exit codes. execute never throws for
// expected failures; it returns the error envelope instead.
export class CoreOpenError extends Error {
  readonly code: "BUSY" | "IO";
  constructor(code: "BUSY" | "IO", message: string) {
    super(message);
    this.name = "CoreOpenError";
    this.code = code;
  }
}

export type TaskStatus = "open" | "running" | "blocked" | "completed" | "cancelled";

// Times are stored as integer milliseconds and returned as UTC ISO strings.
export interface Project {
  id: string;
  name: string;
  root: string;
  gitCommonDir: string;
  createdAt: string;
}

export interface Agent {
  id: string;
  displayName: string;
  createdAt: string;
}

// Never includes claimToken in task, context, or list output.
export interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: TaskStatus;
  dependsOn: string[];
  ownerId: string | null;
  attempt: number;
  leaseUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

export type FileChange = "added" | "modified" | "deleted";
export type CheckOutcome = "passed" | "failed" | "not_run";

export interface EvidenceFile {
  path: string;
  change: FileChange;
}

export interface EvidenceCheck {
  command: string;
  outcome: CheckOutcome;
  summary: string;
}

// Reported evidence, stored verbatim as the agent supplied it.
export interface StoredEvidence {
  checkoutRoot: string;
  head: string;
  dirty: boolean;
  files: EvidenceFile[];
  checks: EvidenceCheck[];
}

// Core-collected read-only Git observation attached to every handoff.
export interface GitObservation {
  checkoutRoot: string;
  head: string;
  dirty: boolean;
  collectedAt: string;
}

export type HandoffOutcome = "completed" | "blocked";

// Stored handoff: the input minus claimToken, plus identity, attempt, and
// the core's own observation. Never exposes the claimToken.
export interface Handoff {
  id: string;
  projectId: string;
  taskId: string;
  actorId: string;
  attempt: number;
  outcome: HandoffOutcome;
  summary: string;
  evidence: StoredEvidence;
  unresolved: string[];
  nextSteps: string[];
  blockingQuestionIds: string[];
  observed: GitObservation;
  evidenceSource: "agent_reported";
  createdAt: string;
}

export interface Answer {
  id: string;
  actorId: string;
  body: string;
  createdAt: string;
}

export interface Question {
  id: string;
  projectId: string;
  taskId: string;
  fromAgentId: string;
  toAgentId: string;
  body: string;
  createdAt: string;
  answer: Answer | null;
}

export interface Decision {
  id: string;
  projectId: string;
  actorId: string;
  body: string;
  paths: string[];
  supersedesId: string | null;
  createdAt: string;
}

export type NoteSource = "note" | "handoff" | "task" | "decision";
export type SearchHitStatus = "proposed" | "verified" | TaskStatus | "active" | "superseded";

// source=note uses proposed|verified. source=handoff uses the stored outcome.
// verified is the author's assertion, not a Loreforge proof.
export interface NoteRecord {
  id: string;
  projectId: string;
  source: NoteSource;
  title: string;
  finding: string;
  reason: string;
  evidenceRefs: string[];
  paths: string[];
  authorId: string | null;
  createdAt: string;
  observedCommit: string | null;
  status: SearchHitStatus;
  taskId: string | null;
  supersedesId: string | null;
  supersededById: string | null;
  current: boolean;
  evidenceDirty?: boolean | null;
}

export interface SearchRevision {
  supersedesId: string | null;
  supersededById: string | null;
  createdAt: string;
  current: boolean;
}

export interface SearchHit {
  id: string;
  source: NoteSource;
  title: string;
  excerpt: string;
  status: SearchHitStatus;
  evidenceRefs: string[];
  paths: string[];
  authorId: string | null;
  taskId: string | null;
  current: boolean;
  observedCommit?: string | null;
  evidenceDirty?: boolean | null;
  freshness?: "unknown" | "current_commit" | "different_commit" | "uncommitted";
  revision: SearchRevision;
}

export interface InboxEvent {
  id: number;
  projectId: string;
  recipientId: string;
  kind: "question" | "answer";
  questionId: string;
  taskId: string;
  body: string;
  createdAt: string;
}

// Work mode carries full handoffs. Review mode strips implementation prose
// (summary, unresolved, nextSteps) while retaining evidence, observed data,
// outcome metadata, and blocking question IDs.
export type WorkHandoff = Handoff;
export type ReviewHandoff = Omit<Handoff, "summary" | "unresolved" | "nextSteps">;

export interface CurrentGit {
  head: string | null;
  dirty: boolean | null;
  collectedAt: string;
  error: string | null;
}

export interface OmittedCounts {
  handoffs: number;
  questions: number;
  decisions: number;
  policy: {
    handoffNarratives: boolean;
    questions: number;
  };
}

export type ContextMode = "work" | "review";

export interface ContextSnapshot {
  project: Project;
  task: Task;
  dependencies: Task[];
  handoffs: Array<WorkHandoff | ReviewHandoff>;
  questions: Question[];
  decisions: Decision[];
  currentGit: CurrentGit;
  omitted: OmittedCounts;
  mode: ContextMode;
}

// Success payloads, one per operation in contract-table order.
export interface ProjectRegisterData {
  project: Project;
}
export interface AgentRegisterData {
  agent: Agent;
}
export interface TaskCreateData {
  task: Task;
}
export interface TaskGetData {
  task: Task;
}
export interface TaskListData {
  tasks: Task[];
  omittedCount: number;
  nextCursor?: string | null;
  availability?: Record<string, { claimable: boolean; expired: boolean; blockedBy: string[] }>;
}
export interface TaskClaimData {
  task: Task;
  claimToken: string;
}
export interface TaskRenewData {
  task: Task;
}
export interface TaskReleaseData {
  task: Task;
}
export interface TaskReopenData {
  task: Task;
}
export interface TaskCancelData {
  task: Task;
}
export interface HandoffSubmitData {
  task: Task;
  handoff: Handoff;
}
export interface QuestionAskData {
  question: Question;
}
export interface QuestionAnswerData {
  question: Question;
}
export interface InboxListData {
  events: InboxEvent[];
  nextCursor: number;
  hasMore: boolean;
}
export interface DecisionRecordData {
  decision: Decision;
}
export interface ContextGetData {
  snapshot: ContextSnapshot;
}
export interface NoteAddData {
  note: NoteRecord;
}
export interface NoteGetData {
  note: NoteRecord;
}
export interface SearchQueryData {
  hits: SearchHit[];
  omittedCount: number;
}

export interface Review {
  id: string; projectId: string; handoffId: string; taskId: string; attempt: number;
  actorId: string; observedCommit: string; outcome: "approved" | "changes_requested";
  body: string; createdAt: string;
}
export interface ExtensionData {
  projects?: Project[]; agents?: Agent[]; decisions?: Decision[];
  review?: Review; reviews?: Review[]; history?: NoteRecord[];
  nextCursor?: string | null; nextAfter?: string | null;
  index?: { healthy: boolean; documents: number; expected: number; rebuilt?: boolean };
}

export type ResponseData =
  | ExtensionData
  | ProjectRegisterData
  | AgentRegisterData
  | TaskCreateData
  | TaskGetData
  | TaskListData
  | TaskClaimData
  | TaskRenewData
  | TaskReleaseData
  | TaskReopenData
  | TaskCancelData
  | HandoffSubmitData
  | QuestionAskData
  | QuestionAnswerData
  | InboxListData
  | DecisionRecordData
  | ContextGetData
  | NoteAddData
  | NoteGetData
  | SearchQueryData;

export interface ResponseError {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export type Response =
  | { schemaVersion: 1; ok: true; data: ResponseData }
  | { schemaVersion: 1; ok: false; error: ResponseError };

// Runtime guard used by future execute tests: narrows unknown values to the
// error branch without importing zod at the call site.
export function isErrorResponse(response: Response): response is Extract<Response, { ok: false }> {
  return response.ok === false;
}

export const ResponseSchemaVersion = 1 as const;
