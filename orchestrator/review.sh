#!/usr/bin/env bash
# review.sh — cross-vendor PR review, subscription-only, sealed sandboxes.
# The vendor that did NOT write the PR reviews it. The agent writes its review
# to review-output.md; this script posts it (all GitHub writes stay host-side).
#
# Usage: ./review.sh owner/repo PR_NUMBER
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[[ -f "$ROOT/orchestrator/policy.env" ]] && . "$ROOT/orchestrator/policy.env"
repo="$1"; pr="$2"

if [[ -n "${ANTHROPIC_API_KEY:-}" || -n "${OPENAI_API_KEY:-}" ]]; then
  echo "ERROR: API key env vars set — unset to stay on subscription billing." >&2
  exit 1
fi

author_vendor="$(gh pr view "$pr" --repo "$repo" --json body \
                   --jq '.body' | grep -oE 'Implemented-by: (claude|codex)' | awk '{print $2}' || true)"
reviewer="claude"
[[ "$author_vendor" == "claude" ]] && reviewer="codex"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
gh repo clone "$repo" "$tmp"
cd "$tmp"
gh pr checkout "$pr" --repo "$repo"

# Give the agent the diff context it needs without network access
base="$(gh pr view "$pr" --repo "$repo" --json baseRefName --jq .baseRefName)"
gh pr view "$pr" --repo "$repo" --json title,body --jq '"# " + .title + "\n\n" + .body' > .pr-context.md

prompt="Review the pull request checked out on the current branch.
The PR description is in .pr-context.md; the diff vs origin/$base is your subject
(use 'git diff origin/$base...HEAD').
Write your review to ./review-output.md per your instructions. Do not post
anything — you have no network access; the orchestrator posts for you."

echo "[review] $repo#$pr written by ${author_vendor:-unknown} → reviewed by $reviewer"
mkdir -p .claude
printf '{"effortLevel": "%s"}\n' "${AGENT_CLAUDE_EFFORT:-medium}" > .claude/settings.json
case "$reviewer" in
  claude)
    claude -p "$prompt" \
      --model "${AGENT_CLAUDE_MODEL:-sonnet}" \
      --append-system-prompt "$(cat "$ROOT/agents/reviewer.md")" \
      --permission-mode acceptEdits \
      --allowedTools "Bash(git:*)" \
      --max-turns "${AGENT_REVIEW_MAX_TURNS:-40}" > /dev/null
    ;;
  codex)
    codex exec --sandbox workspace-write </dev/null \
      -c model_reasoning_effort="${AGENT_CODEX_EFFORT:-medium}" \
      "$(printf '%s\n\n---\nYour operating instructions:\n%s' \
           "$prompt" "$(cat "$ROOT/agents/reviewer.md")")" > /dev/null
    ;;
esac

if [[ ! -s review-output.md ]]; then
  echo "ERROR: $reviewer produced no review-output.md for $repo#$pr" >&2
  exit 1
fi

{
  cat review-output.md
  printf '\n\n---\nReviewed-by: %s\n' "$reviewer"
} | gh pr review "$pr" --repo "$repo" --comment --body-file -
echo "[review] posted $reviewer review on $repo#$pr"
