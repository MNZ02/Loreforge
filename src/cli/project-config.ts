import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { discoverProject } from "../evidence/git.js";
import { CliValidationError, type InitAgentSpec } from "./args.js";

export interface ProjectBinding {
  version: 1; projectId: string; home: string; gitCommonDir: string;
  agents: InitAgentSpec[]; rosterDecisionId?: string;
}

export function bindingPath(root = process.cwd()): string {
  return join(discoverProject(root).gitCommonDir, "loreforge.json");
}

export function readProjectBinding(root = process.cwd()): ProjectBinding | undefined {
  let identity;
  try { identity = discoverProject(root); } catch { return undefined; }
  const file = join(identity.gitCommonDir, "loreforge.json");
  if (!existsSync(file)) return undefined;
  try {
    const value = JSON.parse(readFileSync(file, "utf8")) as ProjectBinding;
    if (value.version !== 1 || !/^[0-9a-f-]{36}$/i.test(value.projectId) || !value.home?.startsWith("/") || value.gitCommonDir !== identity.gitCommonDir || !Array.isArray(value.agents)) throw new Error();
    return value;
  } catch { throw new CliValidationError("Invalid repository Loreforge configuration; run lore init with an explicit --home to repair it"); }
}

export function writeProjectBinding(root: string, value: ProjectBinding): string {
  const file = bindingPath(root);
  const temp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  renameSync(temp, file);
  return file;
}
