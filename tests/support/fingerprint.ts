import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";

// Deterministic source fingerprint from PLAN.md: SHA-256 over the JSON array
// of [relativePath, sha256(fileBytes)] sorted by path. Covers src/, tests/,
// scripts/, templates/, examples/ plus the root manifests; excludes reports,
// dist, node_modules, databases, and frozen plans. Hashes file bytes exactly,
// uses `/` relative paths, emits UTF-8 JSON without extra spaces. Unexpected
// symlinks fail instead of hashing data outside the workspace.

const COVERED_DIRS = ["src", "tests", "scripts", "templates", "examples"];
const COVERED_ROOT_FILES = new Set([
  "package.json",
  "package-lock.json",
  ".gitignore",
  "README.md",
  "docs/usage.md",
  "docs/integrations.md",
]);

function isCoveredRootFile(rel: string): boolean {
  if (COVERED_ROOT_FILES.has(rel)) return true;
  return rel === "tsconfig.json" || (rel.startsWith("tsconfig.") && rel.endsWith(".json"));
}

function toPosix(rel: string): string {
  return rel.split(sep).join("/");
}

export interface Fingerprint {
  entries: Array<[string, string]>;
  json: string;
  hash: string;
}

function sha256Hex(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isRegularFile(full: string): boolean {
  try {
    const st = lstatSync(full);
    return st.isFile() && !st.isSymbolicLink();
  } catch {
    return false;
  }
}

function collectFiles(root: string, dirRel: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(join(root, dirRel));
  } catch {
    return;
  }
  for (const entry of entries.sort()) {
    const rel = dirRel === "" ? entry : `${dirRel}/${entry}`;
    const full = join(root, rel);
    let st;
    try {
      st = lstatSync(full);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) {
      throw new Error(`fingerprint refused symlink: ${rel}`);
    }
    if (st.isDirectory()) collectFiles(root, rel, out);
    else if (st.isFile()) out.push(rel);
  }
}

// Fingerprint an explicit set of workspace-relative paths.
export function fingerprintFiles(root: string, relPaths: string[]): Fingerprint {
  const entries: Array<[string, string]> = relPaths.map((rel) => {
    const full = join(root, rel);
    let st;
    try {
      st = lstatSync(full);
    } catch {
      throw new Error(`fingerprint expected a regular file: ${rel}`);
    }
    if (st.isSymbolicLink()) {
      throw new Error(`fingerprint refused symlink: ${rel}`);
    }
    if (!st.isFile()) {
      throw new Error(`fingerprint expected a regular file: ${rel}`);
    }
    return [toPosix(rel), sha256Hex(readFileSync(full))];
  });
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const json = JSON.stringify(entries);
  return { entries, json, hash: sha256Hex(json) };
}

// Fingerprint the full covered product tree.
export function workspaceFingerprint(root: string): Fingerprint {
  const rels: string[] = [];
  for (const dir of COVERED_DIRS) collectFiles(root, dir, rels);
  let rootEntries: string[];
  try {
    rootEntries = readdirSync(root);
  } catch {
    rootEntries = [];
  }
  for (const entry of rootEntries) {
    if (isCoveredRootFile(entry) && isRegularFile(join(root, entry))) rels.push(entry);
  }
  for (const doc of ["docs/usage.md", "docs/integrations.md"]) {
    if (isRegularFile(join(root, doc))) rels.push(doc);
  }
  return fingerprintFiles(root, rels);
}

// Contract hash: same algorithm limited to the frozen M0 surface,
// src/core/contracts.ts plus every file under src/core/schemas/.
export function contractHash(root: string): string {
  const rels: string[] = [];
  collectFiles(root, "src/core/schemas", rels);
  rels.push("src/core/contracts.ts");
  return fingerprintFiles(root, rels).hash;
}
