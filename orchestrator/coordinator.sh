#!/usr/bin/env bash
# coordinator.sh — one dispatch pass: poll issues labeled `agent:dev`, claim,
# run a developer agent, then push + open the PR host-side.
#
# Agents run sealed (no push/post from inside). They leave commits plus
# .pr-body.md (or .agent-blocked.md); this script does all GitHub writes.
# Subscription-only: claude -p (Claude Pro credit) + codex exec (ChatGPT pool).
# Normally invoked by tick.sh; safe to run by hand.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[[ -f "$ROOT/orchestrator/policy.env" ]] && . "$ROOT/orchestrator/policy.env"
WORKDIR="${AGENT_WORKDIR:-$HOME/.agent-company/work}"
MAX_PARALLEL="${AGENT_MAX_PARALLEL:-2}"
BACKENDS=(claude codex)          # round-robin; drop one here if its pool is dry
mkdir -p "$WORKDIR"

# Guard the house rule: subscription auth only.
if [[ -n "${ANTHROPIC_API_KEY:-}" || -n "${OPENAI_API_KEY:-}" ]]; then
  echo "ERROR: API key env vars set — this would bypass subscription billing. Unset and rerun." >&2
  exit 1
fi

run_developer() {  # $1=backend $2=repo $3=issue $4=branch $5=task_dir
  local backend="$1" repo="$2" issue="$3" branch="$4" task_dir="$5"
  local issue_body prompt
  issue_body="$(gh issue view "$issue" --repo "$repo" --json title,body \
                  --jq '"# " + .title + "\n\n" + .body')"
  prompt="You are working on GitHub issue #$issue of $repo.

$issue_body

Implement this issue on the current branch ($branch). Follow the process in
your instructions: implement, test, commit, then write .pr-body.md.
Do not push or open a PR — the orchestrator handles that."

  cd "$task_dir"
  # Pin effort for headless runs — project settings override the founder's
  # interactive default (e.g. max) so agent tokens stay budgeted.
  mkdir -p .claude
  printf '{"effortLevel": "%s"}\n' "${AGENT_CLAUDE_EFFORT:-medium}" > .claude/settings.json
  case "$backend" in
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
             "$prompt" "$(cat "$ROOT/agents/developer.md")")" \
        > .agent-result.log
      ;;
  esac
}

publish() {  # $1=backend $2=repo $3=issue $4=branch $5=task_dir — all GitHub writes happen here
  local backend="$1" repo="$2" issue="$3" branch="$4" task_dir="$5"
  cd "$task_dir"
  local base commits
  base="$(gh repo view "$repo" --json defaultBranchName --jq .defaultBranchName)"
  commits="$(git rev-list --count "origin/$base..HEAD")"

  if [[ -f .agent-blocked.md ]]; then
    gh issue comment "$issue" --repo "$repo" \
      --body "$(printf 'Agent (%s) is blocked:\n\n%s' "$backend" "$(cat .agent-blocked.md)")"
    gh issue edit "$issue" --repo "$repo" --remove-label "agent:wip"
    return 0
  fi
  if [[ ! -f .pr-body.md || "$commits" -eq 0 ]]; then
    echo "[$(date +%H:%M:%S)] $backend produced no publishable result for $repo#$issue — releasing claim"
    gh issue edit "$issue" --repo "$repo" --remove-label "agent:wip"
    return 1
  fi

  git push -u origin "$branch"
  local title body_file pr_url
  title="$(head -1 .pr-body.md)"
  body_file="$(mktemp)"
  { tail -n +3 .pr-body.md; printf '\n\nImplemented-by: %s\n' "$backend"; } > "$body_file"
  pr_url="$(gh pr create --repo "$repo" --head "$branch" --title "$title" --body-file "$body_file")"
  rm -f "$body_file"
  gh issue comment "$issue" --repo "$repo" --body "Implemented by $backend → $pr_url"
  echo "[$(date +%H:%M:%S)] $backend opened $pr_url for $repo#$issue"
}

backend_idx=0
running=0

while IFS= read -r repo; do
  [[ -z "$repo" || "$repo" == \#* ]] && continue

  # Process substitution (not a pipe) so this loop runs in the main shell:
  # background jobs stay visible to the final `wait`, and counters persist.
  while read -r issue; do
    (( running >= MAX_PARALLEL )) && break

    backend="${BACKENDS[$(( backend_idx % ${#BACKENDS[@]} ))]}"
    backend_idx=$(( backend_idx + 1 ))

    echo "[$(date +%H:%M:%S)] claiming $repo#$issue → $backend"
    gh issue edit "$issue" --repo "$repo" --add-label "agent:wip"

    task_dir="$WORKDIR/${repo//\//_}_$issue"
    rm -rf "$task_dir"
    gh repo clone "$repo" "$task_dir"
    branch="agent/issue-$issue"
    git -C "$task_dir" checkout -b "$branch"

    (
      if run_developer "$backend" "$repo" "$issue" "$branch" "$task_dir"; then
        publish "$backend" "$repo" "$issue" "$branch" "$task_dir" || true
      else
        # Real failure OR exhausted subscription pool. Release the claim so a
        # later tick (or the other backend) retries. Never hot-retry — pools
        # refill on a billing cycle, not on a loop iteration.
        echo "[$(date +%H:%M:%S)] $backend run failed on $repo#$issue — releasing claim"
        gh issue edit "$issue" --repo "$repo" --remove-label "agent:wip"
      fi
    ) &
    running=$(( running + 1 ))
  done < <(gh issue list --repo "$repo" --label "agent:dev" --state open \
             --json number,labels \
             --jq '.[] | select([.labels[].name] | index("agent:wip") | not) | .number')
done < "$ROOT/orchestrator/repos.txt"

wait
echo "[$(date +%H:%M:%S)] coordinator pass complete"
