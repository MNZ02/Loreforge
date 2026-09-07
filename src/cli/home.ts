import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { databaseExists, resolveDbPath } from "../storage/db.js";

export { DB_FILENAME, LEGACY_DB_FILENAME } from "../storage/db.js";

/**
 * Resolves the state home directory with precedence:
 * 1. Explicit --home
 * 2. LOREFORGE_HOME, then LORE_HOME
 * 3. AGENT_COMPANY_HOME (pre-rename)
 * 4. ~/.loreforge/context-v1, or ~/.agent-company/context-v1 if that already exists
 */
export function resolveHomeDir(
  explicitHome?: string,
  env: Record<string, string | undefined> = process.env
): string {
  if (explicitHome && explicitHome.trim().length > 0) {
    return resolve(explicitHome.trim());
  }

  for (const key of ["LOREFORGE_HOME", "LORE_HOME", "AGENT_COMPANY_HOME"]) {
    const value = env[key];
    if (value && value.trim().length > 0) {
      return resolve(value.trim());
    }
  }

  const nextDefault = resolve(join(homedir(), ".loreforge", "context-v1"));
  const legacyDefault = resolve(join(homedir(), ".agent-company", "context-v1"));
  if (!existsSync(nextDefault) && existsSync(legacyDefault)) {
    return legacyDefault;
  }
  return nextDefault;
}

export function getDbPath(homeDir: string): string {
  return resolveDbPath(homeDir);
}

export function doesStateExist(homeDir: string): boolean {
  return databaseExists(homeDir);
}
