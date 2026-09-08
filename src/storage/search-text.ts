// Shared tokenizing, path overlap, and excerpt helpers for SQLite FTS5
// search. Keep separators in sync with the v2 handoff backfill in schema.ts.

export const SEARCH_CANDIDATE_CAP = 500;
export const SEARCH_EXCERPT_MAX = 240;
export const SEARCH_DEFAULT_LIMIT = 5;
export const SEARCH_MIN_TOKEN = 2;

export function normalizeRelativePath(value: string): string {
  return value.trim().split("/").filter(part => part !== "" && part !== ".").join("/");
}

const SEPARATOR = /[^\p{L}\p{N}]+/gu;

export function tokenizeForSearch(text: string): string {
  return text.replace(SEPARATOR, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

export function queryTokens(query: string): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const raw of tokenizeForSearch(query).split(" ")) {
    if (raw.length < SEARCH_MIN_TOKEN) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    tokens.push(raw);
  }
  return tokens;
}

// AND of quoted tokens so user punctuation cannot inject FTS operators.
export function toFtsMatch(query: string): string | null {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return null;
  return tokens.map((token) => `"${token.replace(/"/g, "")}"`).join(" AND ");
}

export function pathsOverlap(stored: string[], queryPaths: string[]): boolean {
  if (queryPaths.length === 0) return true;
  for (const storedPath of stored.map(normalizeRelativePath)) {
    for (const queryPath of queryPaths.map(normalizeRelativePath)) {
      if (storedPath === queryPath) return true;
      if (storedPath.startsWith(`${queryPath}/`)) return true;
      if (queryPath.startsWith(`${storedPath}/`)) return true;
    }
  }
  return false;
}

export function countPathOverlaps(stored: string[], queryPaths: string[]): number {
  if (queryPaths.length === 0) return 0;
  let count = 0;
  for (const storedPath of stored.map(normalizeRelativePath)) {
    for (const queryPath of queryPaths.map(normalizeRelativePath)) {
      if (
        storedPath === queryPath ||
        storedPath.startsWith(`${queryPath}/`) ||
        queryPath.startsWith(`${storedPath}/`)
      ) {
        count += 1;
        break;
      }
    }
  }
  return count;
}

export function countTitleTokenHits(title: string, tokens: string[]): number {
  const hay = new Set(tokenizeForSearch(title).split(" "));
  let count = 0;
  for (const token of tokens) {
    if (hay.has(token)) count += 1;
  }
  return count;
}

export function makeExcerpt(text: string, tokens: string[], max = SEARCH_EXCERPT_MAX): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length === 0) return "";
  let start = 0;
  const lower = compact.toLowerCase();
  for (const token of tokens) {
    const at = lower.indexOf(token);
    if (at >= 0) {
      start = Math.max(0, at - Math.floor(max / 4));
      break;
    }
  }
  const prefix = start > 0 ? "…" : "";
  const available = Math.max(0, max - prefix.length);
  const suffix = start + available < compact.length ? "…" : "";
  return (prefix + compact.slice(start, start + Math.max(0, available - suffix.length)) + suffix).slice(0, max);
}
