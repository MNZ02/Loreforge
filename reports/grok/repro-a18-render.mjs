#!/usr/bin/env node
// Temporary Grok reproduction: A18 requires every direct dependency ID/status
// to remain at the 4000-char budget. 20 legal 200-char titles overflow the
// essential header, and the hard slice drops later dependency IDs.
import { renderContext } from "../../src/context/render.ts";

function task(id, title, status = "completed") {
  return {
    id,
    projectId: "11111111-1111-4111-8111-111111111111",
    title,
    description: "d",
    status,
    dependsOn: [],
    ownerId: null,
    attempt: 1,
    leaseUntil: null,
    createdAt: "2026-09-05T01:00:00.000Z",
    updatedAt: "2026-09-05T01:00:00.000Z",
  };
}

const deps = [];
for (let i = 0; i < 20; i += 1) {
  const n = String(i).padStart(2, "0");
  deps.push(
    task(
      `22222222-2222-4222-8222-2222222200${n}`,
      `Dep ${n} ${"T".repeat(190)}`,
    ),
  );
}

const snapshot = {
  project: {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Budget Project",
    root: "/tmp/budget-project",
    gitCommonDir: "/tmp/budget-project/.git",
    createdAt: "2026-09-05T00:00:00.000Z",
  },
  task: task("33333333-3333-4333-8333-333333333333", "Active task with twenty dependencies", "running"),
  dependencies: deps,
  handoffs: [],
  questions: [],
  decisions: [],
  currentGit: {
    head: "0123456789abcdef0123456789abcdef01234567",
    dirty: false,
    collectedAt: "2026-09-05T02:00:00.000Z",
    error: null,
  },
  omitted: {
    handoffs: 0,
    questions: 0,
    decisions: 0,
    policy: { handoffNarratives: false, questions: 0 },
  },
  mode: "work",
};

const rendered = renderContext(snapshot, 4000);
console.log("LENGTH", rendered.length);
const missing = [];
for (const dep of deps) {
  if (!rendered.includes(dep.id)) missing.push(dep.id);
}
console.log("DEP_COUNT", deps.length);
console.log("MISSING_COUNT", missing.length);
console.log("MISSING_IDS", missing.join(","));
console.log("HAS_NOTICE", rendered.includes("NOTICE: Output truncated"));
process.exit(missing.length > 0 || rendered.length > 4000 ? 1 : 0);
