# Loreforge v0.1 — Provider Integrations

This document records the integration status across AI CLI coding environments.
In v0.1, Loreforge integrates via generic exported CLI instructions (`lore instructions show`) rather than native provider plugins, API keys, or prompt-interception daemons.

## Provider Integration Matrix

| Provider & CLI | Model Reported / Effort | Generic Snippet Support | Native Hook Status | Local CLI Execution | Evidence & Verification Notes |
|---|---|---|---|---|---|
| **Google Antigravity (AGY)** | Gemini 3.8 Flash (High) | Supported (`instructions show`) | Unverified / Deferred (no custom hooks modified) | Exercised (local CLI subprocess commands) | [Acceptance Tests](file:///Users/mnz/dev/loreforge/tests/acceptance/checklist.md) & [Flash Progress](file:///Users/mnz/dev/loreforge/reports/flash/progress.json) |
| **Meta Muse** | Muse Spark 1.3 (xhigh requested) | Supported (`instructions show`) | Unverified / Deferred (no custom hooks modified) | Exercised concurrently in shared directory | [Muse Baseline](file:///Users/mnz/dev/loreforge/reports/muse/baseline.json) & [Muse Progress](file:///Users/mnz/dev/loreforge/reports/muse/progress.json) |
| **Other AI CLIs (Codex, Claude, etc.)** | Unspecified / User-supplied | Supported (POSIX-standard CLI stdin/stdout) | Unverified (not tested in v0.1) | Pending (unverified) | Generic shell invocation callable from any POSIX shell environment |

## Integration Architecture & Boundaries

1. **Generic Instructions Over Native Hooks**:
   Native startup hooks (such as `.cursorrules`, `.windsurfrules`, custom prompt files, or shell profile hooks) are deferred in v0.1. Exporting generic instructions allows users to paste or embed the protocol instructions without risking unexpected mutations to project or user-wide configuration.

2. **Truthful Verification**:
   - Provider availability or subscription models are not claimed or evaluated.
   - Provider models are recorded as reported by the active session; unverified session modes are explicitly labeled as unverified.
   - Live two-provider exercise (S1) is evaluated separately from software unit/acceptance tests.

3. **Safe Path Quoting**:
   The `lore instructions show` command emits concrete paths safely escaped for standard POSIX shells, ensuring paths with spaces or special symbols do not cause injection.
