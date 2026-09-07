#!/usr/bin/env bash
# digest.sh — daily plain-bash status report. No LLM tokens: just gh queries.
# Writes ~/.agent-company/digest-YYYY-MM-DD.md (and prints it).
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STATE="$HOME/.agent-company"
mkdir -p "$STATE"
OUT="$STATE/digest-$(date +%F).md"

{
  echo "# agent-company digest — $(date '+%F %H:%M')"
  while IFS= read -r repo; do
    [[ -z "$repo" || "$repo" == \#* ]] && continue
    echo
    echo "## $repo"
    echo "### PRs awaiting YOUR review/merge"
    gh pr list --repo "$repo" --state open --json number,title,headRefName \
      --jq '.[] | select(.headRefName | startswith("agent/")) | "- #\(.number) \(.title)"'
    echo "### Queued (agent:dev)"
    gh issue list --repo "$repo" --label "agent:dev" --state open \
      --json number,title,labels \
      --jq '.[] | select([.labels[].name] | index("agent:wip") | not) | "- #\(.number) \(.title)"'
    echo "### In progress (agent:wip)"
    gh issue list --repo "$repo" --label "agent:wip" --state open \
      --json number,title --jq '.[] | "- #\(.number) \(.title)"'
    echo "### Merged in the last 24h"
    gh pr list --repo "$repo" --state merged --search "head:agent/ merged:>=$(date -v-1d +%F)" \
      --json number,title --jq '.[] | "- #\(.number) \(.title)"' 2>/dev/null
  done < "$ROOT/orchestrator/repos.txt"
  echo
  echo "_Claude Agent SDK credit burn: see claude.ai → Settings → Usage_"
} | tee "$OUT"
