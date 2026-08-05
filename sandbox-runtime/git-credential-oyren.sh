#!/usr/bin/env bash
# git credential helper for the oyren sandbox: hand git a GitHub token for github.com pushes/pulls WITHOUT
# the token ever being written into .git/config or any on-disk store. Wired as `credential.helper oyren`
# (git runs this as `git-credential-oyren get`, request on stdin). Only answers `get` for github.com over
# https; every other input is a silent no-op (exit 0) so git falls back to its normal flow. NEVER echo the
# token anywhere but the reply.
#
# Token source, in order:
#  1. The orchestrator (`$ORCHESTRATOR_URL/sandbox/git-token`, authed by $CONTROL_TOKEN + $OYREN_SESSION_SLUG)
#     — mints a FRESH 1h repo-scoped token on demand, so push survives past the launch token's expiry on
#     long (up to 24h) sessions. Requires the orchestrator to know its own URL (ORCHESTRATOR_URL) and the
#     repo to be attached at `write`.
#  2. Per-repo launch tokens from $REPO_CLONE_TOKENS (comma-separated, parallel to $REPO_FULL_NAMES) —
#     covers multi-repo sessions where the orchestrator callback is unavailable and $GITHUB_TOKEN is scoped
#     to only the primary repo.
#  3. Fallback: the launch-time $GITHUB_TOKEN from the env (valid ~1h) — used when the callback isn't
#     configured (public/legacy launch) or is unreachable.
set -u

[ "${1:-}" = "get" ] || exit 0

proto=""
host=""
path=""
# git feeds the request as `key=value` lines terminated by a blank line. `path` is present because the
# image sets credential.useHttpPath — it carries the "owner/repo(.git)" of the repo git is authenticating.
while IFS='=' read -r key value; do
  case "$key" in
    protocol) proto="$value" ;;
    host) host="$value" ;;
    path) path="$value" ;;
    "") break ;;
  esac
done

[ "$proto" = "https" ] && [ "$host" = "github.com" ] || exit 0

# "owner/repo.git" (or "owner/repo") → "owner/repo": the repo whose token the orchestrator must mint, so
# a multi-repo session pushes to each of its repos (which may span installations), not just the primary.
repo_full_name="${path%.git}"

token=""
# 1. Fresh token from the orchestrator (preferred — never stale). Include the repo name so the mint is
#    scoped to THIS repo; the orchestrator falls back to the session's primary when it's absent.
if [ -n "${ORCHESTRATOR_URL:-}" ] && [ -n "${OYREN_SESSION_SLUG:-}" ] && [ -n "${CONTROL_TOKEN:-}" ]; then
  body="{\"appSlug\":\"${OYREN_SESSION_SLUG}\",\"controlToken\":\"${CONTROL_TOKEN}\""
  [ -n "$repo_full_name" ] && body="${body},\"repoFullName\":\"${repo_full_name}\""
  body="${body}}"
  # Retried, because falling through is silently destructive: past the first hour the fallback token
  # is EXPIRED, so one blip here turns into a bare 403 from GitHub with nothing pointing at the real
  # cause. Two quick extra attempts cost a couple of seconds on a git op that was going to fail
  # anyway, and cover the restart/redeploy window that makes the orchestrator briefly unreachable.
  for _attempt in 1 2 3; do
    resp="$(curl -fsS --max-time 10 -X POST "${ORCHESTRATOR_URL}/sandbox/git-token" \
      -H 'content-type: application/json' \
      --data-raw "$body" 2>/dev/null || true)"
    token="$(printf '%s' "$resp" | sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
    [ -n "$token" ] && break
    [ "$_attempt" -lt 3 ] && sleep 2
  done
fi

# 2. Match a per-repo token from REPO_CLONE_TOKENS (parallel list to REPO_FULL_NAMES, comma-separated).
#    This covers multi-repo sessions where the orchestrator callback is unavailable and GITHUB_TOKEN is
#    scoped to only the primary repo. Each token is a repo-scoped installation token minted at launch.
if [ -z "$token" ] && [ -n "${REPO_CLONE_TOKENS:-}" ] && [ -n "${REPO_FULL_NAMES:-}" ] && [ -n "$repo_full_name" ]; then
  IFS=',' read -ra _names <<< "$REPO_FULL_NAMES"
  IFS=',' read -ra _tokens <<< "$REPO_CLONE_TOKENS"
  for _i in "${!_names[@]}"; do
    if [ "${_names[$_i]}" = "$repo_full_name" ] && [ -n "${_tokens[$_i]:-}" ]; then
      token="${_tokens[$_i]}"
      break
    fi
  done
fi

# 3. Fall back to the launch-time env token (valid ~1h, primary repo only).
[ -z "$token" ] && token="${GITHUB_TOKEN:-}"
[ -z "$token" ] && exit 0

printf 'username=x-access-token\n'
printf 'password=%s\n' "$token"
