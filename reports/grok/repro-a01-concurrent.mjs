#!/usr/bin/env node
// Temporary Grok reproduction: A01 concurrent first open. Loops the same
// two-process openCore + agent.register race that failed once under npm run check.
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCoreChild } from "../../tests/support/proc.ts";

const ITER = Number(process.env.A01_ITERS ?? 12);
let fails = 0;
for (let i = 1; i <= ITER; i += 1) {
  const home = mkdtempSync(join(tmpdir(), "grok-a01-"));
  const gate = join(home, "gate");
  try {
    const pendingA = runCoreChild(
      home,
      { schemaVersion: 1, operation: "agent.register", requestId: `a-${i}`, payload: { id: "proc-a", displayName: "Proc A" } },
      { gate },
    );
    const pendingB = runCoreChild(
      home,
      { schemaVersion: 1, operation: "agent.register", requestId: `b-${i}`, payload: { id: "proc-b", displayName: "Proc B" } },
      { gate },
    );
    await new Promise((r) => setTimeout(r, 1500));
    writeFileSync(gate, "go\n");
    const [a, b] = await Promise.all([pendingA, pendingB]);
    const aOk = a.exitCode === 0 && a.response?.ok === true;
    const bOk = b.exitCode === 0 && b.response?.ok === true;
    if (!aOk || !bOk) {
      fails += 1;
      console.log("FAIL", i, JSON.stringify({ a: a.response, b: b.response, aExit: a.exitCode, bExit: b.exitCode, aErr: a.stderr, bErr: b.stderr }).slice(0, 800));
    } else {
      console.log("PASS", i);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}
console.log("SUMMARY", { ITER, fails });
process.exit(fails === 0 ? 0 : 1);
