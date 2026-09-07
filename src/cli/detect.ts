import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { InitRole } from "./args.js";

export interface DetectedCli {
  id: string;
  displayName: string;
  defaultRole: InitRole;
  binary: string | null;
  configDir: string | null;
  signedIn: boolean;
  evidence: string[];
}

export interface DetectOptions {
  path: string;
  home: string;
  pathDelimiter?: string;
  pathext?: string;
}

interface CatalogEntry {
  id: string;
  displayName: string;
  binaries: string[];
  configDir: string;
  authFiles: string[];
}

const CATALOG: readonly CatalogEntry[] = [
  { id: "grok", displayName: "Grok", binaries: ["grok"], configDir: ".grok", authFiles: ["auth.json"] },
  { id: "claude", displayName: "Claude Code", binaries: ["claude"], configDir: ".claude", authFiles: [".credentials.json", "credentials.json"] },
  { id: "codex", displayName: "Codex", binaries: ["codex"], configDir: ".codex", authFiles: ["auth.json"] },
  { id: "cursor", displayName: "Cursor", binaries: ["cursor", "cursor-agent"], configDir: ".cursor", authFiles: [] },
  { id: "agy", displayName: "Antigravity", binaries: ["agy"], configDir: ".agy", authFiles: [] },
  { id: "muse", displayName: "Muse", binaries: ["muse"], configDir: ".muse", authFiles: [] },
  { id: "gemini", displayName: "Gemini CLI", binaries: ["gemini"], configDir: ".gemini", authFiles: [] },
];

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Resolve a binary on PATH. Never executes it. */
export function findBinary(
  name: string,
  pathEnv: string,
  pathDelimiter = ":",
  pathext = "",
): string | null {
  const extensions = pathext
    ? pathext.split(";").map((e) => e.trim()).filter(Boolean)
    : [""];
  if (!extensions.includes("")) extensions.unshift("");
  for (const dir of pathEnv.split(pathDelimiter)) {
    if (!dir) continue;
    for (const ext of extensions) {
      const candidate = join(dir, `${name}${ext}`);
      if (existsSync(candidate) && !isDir(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * Detect local coding CLIs from PATH and home config dirs.
 * Does not read credential file contents or call vendor APIs.
 * `signedIn` means an auth file exists, not that a paid plan was verified.
 */
export function detectCodingClis(options: DetectOptions): DetectedCli[] {
  const delim = options.pathDelimiter ?? (options.path.includes(";") && !options.path.includes(":") ? ";" : ":");
  const found: DetectedCli[] = [];
  for (const entry of CATALOG) {
    const evidence: string[] = [];
    let binary: string | null = null;
    for (const name of entry.binaries) {
      binary = findBinary(name, options.path, delim, options.pathext);
      if (binary) {
        evidence.push(`binary:${name}`);
        break;
      }
    }
    const configDir = join(options.home, entry.configDir);
    const hasConfigDir = isDir(configDir);
    if (hasConfigDir) evidence.push(`dir:${entry.configDir}`);
    let signedIn = false;
    for (const rel of entry.authFiles) {
      const authPath = join(configDir, rel);
      if (isFile(authPath)) {
        signedIn = true;
        evidence.push("auth-file:present");
        break;
      }
    }
    if (evidence.length === 0) continue;
    found.push({
      id: entry.id,
      displayName: entry.displayName,
      defaultRole: "both",
      binary,
      configDir: hasConfigDir ? configDir : null,
      signedIn,
      evidence,
    });
  }
  return found;
}

export function detectedToAgents(detected: DetectedCli[]): Array<{ id: string; role: InitRole }> {
  return detected.map((d) => ({ id: d.id, role: d.defaultRole }));
}
