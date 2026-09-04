#!/usr/bin/env bash
# gh wrapper: fetch a fresh GitHub token before every gh invocation so the CLI can always
# authenticate — even in long-lived sessions (launch token expires after ~1h) or when
# GITHUB_TOKEN was scoped to a different repo at launch time.
#
# Token source mirrors git-credential-oyren.sh:
#   1. Orchestrator callback (POST $ORCHESTRATOR_URL/sandbox/git-token) — always fresh, works
#      past the launch token's 1-hour expiry. Scoped to the repo in $PWD (via repoFullName) when
#      resolvable, so it works for repos other than the session's primary/launch repo; falls back
#      to the orchestrator's own default scoping when $PWD isn't inside a git repo.
#   2. Per-repo launch tokens from $REPO_CLONE_TOKENS (comma-separated, parallel to
#      $REPO_FULL_NAMES) — covers multi-repo sessions when the orchestrator is unavailable.
#   3. Fallback: the launch-time $GITHUB_TOKEN env var.
#
# Installed as /usr/local/bin/gh (ahead of /usr/bin/gh in PATH), so every `gh` call in the
# container — by the agent, by the user in the terminal — transparently uses a valid token.
# The real gh binary is exec'd as /usr/bin/gh to avoid infinite recursion.

set -u

# 0. A caller-exported GH_TOKEN is an explicit credential choice — the launch env never sets
#    GH_TOKEN (only GITHUB_TOKEN), so its presence means the caller put it there deliberately
#    (a personal PAT, the git-credential recipe, a test). Minting here would silently overwrite
#    it; pass through to the real gh untouched instead.
if [ -n "${GH_TOKEN:-}" ]; then
  exec "${GH_WRAPPER_REAL_GH:-/usr/bin/gh}" "$@"
fi

token=""

# Detect the repo from the git remote of $PWD — same "owner/repo" used by `gh` to route API calls.
# Resolved once up front so step 1 can scope its mint to it, same as step 2's REPO_FULL_NAMES match.
_remote_url="$(/usr/bin/git remote get-url origin 2>/dev/null || true)"
_repo_name="$(printf '%s' "$_remote_url" | sed -n 's|.*github\.com[:/]\(.*\)\.git$|\1|p; s|.*github\.com[:/]\(.*\)$|\1|p')"

# 1. Fresh token from the orchestrator. Retried for the same reason as git-credential-oyren.sh:
#    past the first hour the fallback token is expired, so a single transient failure here surfaces
#    as an unexplained 403 rather than as the connectivity problem it actually is.
if [ -n "${ORCHESTRATOR_URL:-}" ] && [ -n "${OYREN_SESSION_SLUG:-}" ] && [ -n "${CONTROL_TOKEN:-}" ]; then
  body="{\"appSlug\":\"${OYREN_SESSION_SLUG}\",\"controlToken\":\"${CONTROL_TOKEN}\""
  [ -n "$_repo_name" ] && body="${body},\"repoFullName\":\"${_repo_name}\""
  body="${body}}"
  for _attempt in 1 2 3; do
    resp="$(curl -fsS --max-time 10 -X POST "${ORCHESTRATOR_URL}/sandbox/git-token" \
      -H 'content-type: application/json' \
      --data-raw "$body" 2>/dev/null || true)"
    token="$(printf '%s' "$resp" | sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
    [ -n "$token" ] && break
    [ "$_attempt" -lt 3 ] && sleep 2
  done
fi

# 2. Per-repo token from REPO_CLONE_TOKENS, keyed by the repo the current directory belongs to.
if [ -z "$token" ] && [ -n "${REPO_CLONE_TOKENS:-}" ] && [ -n "${REPO_FULL_NAMES:-}" ] && [ -n "$_repo_name" ]; then
  IFS=',' read -ra _names <<< "$REPO_FULL_NAMES"
  IFS=',' read -ra _tokens <<< "$REPO_CLONE_TOKENS"
  for _i in "${!_names[@]}"; do
    if [ "${_names[$_i]}" = "$_repo_name" ] && [ -n "${_tokens[$_i]:-}" ]; then
      token="${_tokens[$_i]}"
      break
    fi
  done
fi

# 3. Fall back to the launch-time env token.
[ -z "$token" ] && token="${GITHUB_TOKEN:-}"

# Export both names gh recognises (GH_TOKEN takes priority over GITHUB_TOKEN in gh's lookup).
if [ -n "$token" ]; then
  export GH_TOKEN="$token"
  export GITHUB_TOKEN="$token"
fi

# GH_WRAPPER_REAL_GH lets tests point this at a stub instead of the real binary; unset in production.
exec "${GH_WRAPPER_REAL_GH:-/usr/bin/gh}" "$@"
