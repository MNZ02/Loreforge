/**
 * Integrations module for Loreforge v0.1.
 * Provides generic instruction snippet exports and provider metadata.
 */

export { generateInstructions, quoteShell } from "../cli/instructions.js";

export interface ProviderIntegrationInfo {
  provider: string;
  modelReported: string;
  genericSnippetSupported: boolean;
  nativeHooksStatus: "deferred" | "unverified" | "verified";
  localCliExecution: "exercised" | "pending" | "unverified";
  notes: string;
}

export const PROVIDER_INTEGRATIONS: readonly ProviderIntegrationInfo[] = [
  {
    provider: "Google Antigravity (AGY)",
    modelReported: "Gemini 3.8 Flash (High)",
    genericSnippetSupported: true,
    nativeHooksStatus: "deferred",
    localCliExecution: "exercised",
    notes: "Local CLI execution verified via Node subprocess and development scripts."
  },
  {
    provider: "Meta Muse",
    modelReported: "Muse Spark 1.3 (xhigh requested)",
    genericSnippetSupported: true,
    nativeHooksStatus: "deferred",
    localCliExecution: "exercised",
    notes: "Core storage and schemas implemented concurrently."
  },
  {
    provider: "Other AI CLIs (Codex, Claude, etc.)",
    modelReported: "Unspecified / User-supplied",
    genericSnippetSupported: true,
    nativeHooksStatus: "unverified",
    localCliExecution: "pending",
    notes: "Callable from any standard POSIX shell using the lore CLI."
  }
];
