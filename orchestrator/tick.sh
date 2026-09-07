#!/usr/bin/env bash
# tick.sh — the company's heartbeat. Run from cron every ~15 min. One pass:
#   1. reap stale agent:wip claims (crashed agents)
#   2. dispatch queued issues (coordinator.sh)
#   3. route every open agent PR through the state machine:
#        unreviewed / new commits since review  → review.sh   (cross-vendor)
#        latest verdict LGTM*                   → auto-merge (if gates pass)
#        latest verdict Changes needed          → fix.sh, capped, then escalate
#        latest verdict Wrong approach          → escalate to human
# Dumb on purpose: gh + git + jq only. Model tokens are spent only inside
# agents when there is actual work.
set -uo pipefail   # no -e: one repo failing must not kill the whole tick

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[[ -f "$ROOT/orchestrator/policy.env" ]] && . "$ROOT/orchestrator/policy.env"
STATE="$HOME/.agent-company"
LOCK="$STATE/tick.lock"
STALE_HOURS="${AGENT_STALE_HOURS:-3}"
AUTO_MERGE="${AUTO_MERGE:-0}"
MAX_FIX_ROUNDS="${AGENT_MAX_FIX_ROUNDS:-1}"
SENSITIVE="${SENSITIVE_PATHS:-^\.github/|^deploy/|Dockerfile|docker-compose|\.env|migrations?/|auth|billing|payment}"
mkdir -p "$STATE"

if ! mkdir "$LOCK" 2>/dev/null; then
  echo "[$(date '+%F %T')] tick already running — skipping"
  exit 0
fi
trap 'rmdir "$LOCK"' EXIT

log() { echo "[$(date '+%F %T')] $*"; }
log "tick start"

escalate() {  # $1=repo $2=pr $3=reason — hand a PR to the human, once
  local repo="$1" pr="$2" reason="$3"
  gh label create "agent:needs-human" --repo "$repo" \
    --description "autonomy loop escalated this" --color d73a4a 2>/dev/null || true
  if [[ "$(gh pr view "$pr" --repo "$repo" --json labels \
            --jq '[.labels[].name] | index("agent:needs-human")')" == "null" ]]; then
    gh pr edit "$pr" --repo "$repo" --add-label "agent:needs-human"
    gh pr comment "$pr" --repo "$repo" --body "Escalated to human: $reason"
    log "ESCALATED $repo#$pr — $reason"
  fi
}

# ---- 1. reap stale claims ----------------------------------------------------
now_epoch=$(date +%s)
while IFS= read -r repo; do
  [[ -z "$repo" || "$repo" == \#* ]] && continue
  while IFS=$'\t' read -r issue updated; do
    updated_epoch=$(date -j -f "%Y-%m-%dT%H:%M:%SZ" "$updated" +%s 2>/dev/null || echo "$now_epoch")
    age_h=$(( (now_epoch - updated_epoch) / 3600 ))
    has_pr="$(gh pr list --repo "$repo" --head "agent/issue-$issue" --state open --json number --jq 'length')"
    if (( age_h >= STALE_HOURS )) && [[ "$has_pr" == "0" ]]; then
      log "reaping stale claim $repo#$issue (idle ${age_h}h, no PR)"
      gh issue edit "$issue" --repo "$repo" --remove-label "agent:wip"
    fi
  done < <(gh issue list --repo "$repo" --label "agent:wip" --state open \
             --json number,updatedAt --jq '.[] | "\(.number)\t\(.updatedAt)"')
done < "$ROOT/orchestrator/repos.txt"

# ---- 2. dispatch ---------------------------------------------------------------
"$ROOT/orchestrator/coordinator.sh" || log "coordinator pass had errors"

# ---- 3. route open agent PRs ---------------------------------------------------
while IFS= read -r repo; do
  [[ -z "$repo" || "$repo" == \#* ]] && continue
  while IFS= read -r pr; do
    pj="$(gh pr view "$pr" --repo "$repo" --json body,labels,reviews,commits,statusCheckRollup,files)"

    # Skip non-agent PRs and anything already escalated
    [[ "$(jq -r '.body | contains("Implemented-by:")' <<<"$pj")" != "true" ]] && continue
    [[ "$(jq -r '[.labels[].name] | index("agent:needs-human")' <<<"$pj")" != "null" ]] && continue

    reviews_n="$(jq -r '[.reviews[] | select(.body | contains("Reviewed-by:"))] | length' <<<"$pj")"
    last_review_at="$(jq -r '[.reviews[] | select(.body | contains("Reviewed-by:"))] | last | .submittedAt // empty' <<<"$pj")"
    last_commit_at="$(jq -r '[.commits[].committedDate] | max' <<<"$pj")"
    verdict="$(jq -r '[.reviews[] | select(.body | contains("Reviewed-by:"))] | last | .body // "" | split("\n")[0]' <<<"$pj")"

    # (a) needs a (re-)review?
    if [[ "$reviews_n" == "0" || ( -n "$last_review_at" && "$last_commit_at" > "$last_review_at" ) ]]; then
      log "reviewing $repo#$pr"
      "$ROOT/orchestrator/review.sh" "$repo" "$pr" || log "review of $repo#$pr failed"
      continue
    fi

    # (b) route on the standing verdict
    case "$verdict" in
      *"Wrong approach"*)
        escalate "$repo" "$pr" "reviewer verdict: Wrong approach" ;;
      *"Changes needed"*)
        if (( reviews_n > MAX_FIX_ROUNDS )); then
          escalate "$repo" "$pr" "still 'Changes needed' after $MAX_FIX_ROUNDS fix round(s)"
        else
          log "fix round for $repo#$pr"
          "$ROOT/orchestrator/fix.sh" "$repo" "$pr" || escalate "$repo" "$pr" "fix round failed"
        fi ;;
      *LGTM*)
        if [[ "$AUTO_MERGE" != "1" ]]; then
          log "$repo#$pr is LGTM — waiting for human merge (AUTO_MERGE=0)"
          continue
        fi
        touched_sensitive="$(jq -r --arg re "$SENSITIVE" '[.files[].path | select(test($re))] | length' <<<"$pj")"
        if [[ "$touched_sensitive" != "0" ]]; then
          escalate "$repo" "$pr" "LGTM but touches sensitive paths"
          continue
        fi
        not_green="$(jq -r '[.statusCheckRollup[]? | select(((.conclusion // .state) | ascii_upcase) as $s | ($s == "SUCCESS" or $s == "NEUTRAL" or $s == "SKIPPED") | not)] | length' <<<"$pj")"
        if [[ "$not_green" != "0" ]]; then
          log "$repo#$pr LGTM but checks pending/failing — retry next tick"
          continue
        fi
        log "AUTO-MERGING $repo#$pr"
        gh pr merge "$pr" --repo "$repo" --squash --delete-branch \
          || escalate "$repo" "$pr" "auto-merge command failed" ;;
      *)
        escalate "$repo" "$pr" "unparseable review verdict: '$verdict'" ;;
    esac
  done < <(gh pr list --repo "$repo" --state open --json number,headRefName \
             --jq '.[] | select(.headRefName | startswith("agent/")) | .number')
done < "$ROOT/orchestrator/repos.txt"

log "tick complete"
