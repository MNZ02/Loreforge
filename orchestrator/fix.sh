#!/usr/bin/env bash
# fix.sh — one capped fix round: the vendor that wrote a PR addresses the
# latest "Changes needed" review. Agent commits locally (sealed); this script
# pushes. Re-review happens on the next tick automatically (new commit is
# newer than the last review).
#
# Usage: ./fix.sh owner/repo PR_NUMBER
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[[ -f "$ROOT/orchestrator/policy.env" ]] && . "$ROOT/orchestrator/policy.env"
repo="$1"; pr="$2"

if [[ -n "${ANTHROPIC_API_KEY:-}" || -n "${OPENAI_API_KEY:-}" ]]; then
  echo "ERROR: API key env vars set — unset to stay on subscription billing." >&2
  exit 1
fi

fixer="$(gh pr view "$pr" --repo "$repo" --json body \
           --jq '.body' | grep -oE 'Implemented-by: (claude|codex)' | awk '{print $2}' || echo claude)"

tmp="$(mktemp -d)"
cleanup() {
  if [[ "${fix_ok:-0}" == "1" ]]; then rm -rf "$tmp"
  else
    keep="$HOME/.agent-company/failed/$(date +%s)-${repo//\//_}-pr$pr"
    mkdir -p "$(dirname "$keep")" && mv "$tmp" "$keep" && echo "[fix] artifacts kept at $keep" >&2
  fi
}
trap cleanup EXIT
gh repo clone "$repo" "$tmp"
cd "$tmp"
gh pr checkout "$pr" --repo "$repo"

# Latest cross-review feedback → file the agent can read offline
gh pr view "$pr" --repo "$repo" --json reviews \
  --jq '[.reviews[] | select(.body | contains("Reviewed-by:"))] | last | .body' \
  > .review-feedback.md

prompt="A reviewer requested changes on the PR checked out on this branch.
Their feedback is in .review-feedback.md. Address every finding with the
smallest correct change, run the relevant checks, and commit. Do not push —
the orchestrator handles that. If a finding is wrong or can't be addressed,
write your reasoning to .fix-notes.md instead of guessing."

echo "[fix] $repo#$pr → $fixer"
mkdir -p .claude
printf '{"effortLevel": "%s"}\n' "${AGENT_CLAUDE_EFFORT:-medium}" > .claude/settings.json

case "$fixer" in
  claude)
    claude -p "$prompt" \
      --model "${AGENT_CLAUDE_MODEL:-sonnet}" \
      --append-system-prompt "$(cat "$ROOT/agents/developer.md")" \
      --permission-mode acceptEdits \
      --allowedTools "Bash(git:*)" "Bash(bun:*)" "Bash(bunx:*)" "Bash(node:*)" "Bash(npm:*)" "Bash(npx:*)" "Bash(turbo:*)" \
      --max-turns "${AGENT_DEV_MAX_TURNS:-80}" \
      --output-format json > .agent-result.json
    ;;
  codex)
    codex exec --sandbox workspace-write </dev/null \
      -c model_reasoning_effort="${AGENT_CODEX_EFFORT:-medium}" \
      "$(printf '%s\n\n---\nYour operating instructions:\n%s' \
           "$prompt" "$(cat "$ROOT/agents/developer.md")")" > .agent-result.log
    ;;
esac

if [[ -n "$(git log '@{upstream}..HEAD' --oneline 2>/dev/null)" ]]; then
  fix_ok=1
  git push
  note=""
  [[ -f .fix-notes.md ]] && note="$(printf '\n\n%s' "$(cat .fix-notes.md)")"
  gh pr comment "$pr" --repo "$repo" \
    --body "$(printf 'Fix round pushed by %s — re-review queued.%s' "$fixer" "$note")"
  echo "[fix] pushed fix round on $repo#$pr"
elif [[ -f .fix-notes.md ]]; then
  fix_ok=1
  gh pr comment "$pr" --repo "$repo" \
    --body "$(printf '%s disputes the review findings:\n\n%s' "$fixer" "$(cat .fix-notes.md)")"
  echo "[fix] no commits — dispute posted on $repo#$pr"
else
  echo "[fix] $fixer produced neither commits nor notes on $repo#$pr" >&2
  [[ -f .agent-result.json ]] && python3 -c "import json;d=json.load(open('.agent-result.json'));print('[fix] agent final message:', (d.get('result') or '')[:600])" 2>/dev/null >&2
  exit 1
fi
