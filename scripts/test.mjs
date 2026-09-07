// Test group runner. Discovers `.test.ts` files recursively under tests/ and
// invokes `node --import tsx --test` with explicit filenames.
// Groups: core = tests/core + tests/storage; client = tests/cli + tests/context;
// acceptance = tests/acceptance; all = every group. An empty group is an error:
// absence of tests must never look like a pass.
import { readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const TESTS_DIR = join(ROOT, "tests");

const GROUPS = {
  core: ["core", "storage"],
  client: ["cli", "context"],
  acceptance: ["acceptance"],
};

function collect(dirPath, out) {
  let entries;
  try {
    entries = readdirSync(dirPath);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dirPath, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) collect(full, out);
    else if (entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

function filesFor(group) {
  if (group === "all") {
    return Object.values(GROUPS)
      .flat()
      .flatMap((d) => collect(join(TESTS_DIR, d), []))
      .sort();
  }
  const dirs = GROUPS[group];
  if (!dirs) {
    console.error(`unknown test group: ${group} (expected core|client|acceptance|all)`);
    process.exit(2);
  }
  return dirs.flatMap((d) => collect(join(TESTS_DIR, d), [])).sort();
}

const group = process.argv[2] ?? "all";
const files = filesFor(group);
if (files.length === 0) {
  console.error(`test group '${group}' has no .test.ts files; failing instead of passing silently`);
  process.exit(1);
}
console.log(`running ${files.length} test file(s) [${group}]:`);
for (const f of files) console.log(`  ${relative(ROOT, f)}`);
const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files], {
  stdio: "inherit",
  cwd: ROOT,
});
process.exit(result.status ?? 1);
