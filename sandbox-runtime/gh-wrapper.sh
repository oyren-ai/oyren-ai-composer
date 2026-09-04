#!/usr/bin/env bash
# gh wrapper: fetch a fresh GitHub token before every gh invocation so the CLI can always
# authenticate — even in long-lived sessions (launch token expires after ~1h) or when
# GITHUB_TOKEN was scoped to a different repo at launch time.
#
# Token source mirrors git-credential-oyren.sh:
#   0. A caller-exported GH_TOKEN is respected outright — no minting, nothing overwritten.
#   1. Orchestrator callback (POST $ORCHESTRATOR_URL/sandbox/git-token) — always fresh, works
#      past the launch token's 1-hour expiry. Scoped (via repoFullName) to the repo the call
#      targets — --repo/-R flag, then GH_REPO, then the repo in $PWD — so it works for every
#      repo attached to the session, not just the primary; falls back to the orchestrator's own
#      default scoping when no target resolves.
#   2. Per-repo launch tokens from $REPO_CLONE_TOKENS (comma-separated, parallel to
#      $REPO_FULL_NAMES), matched against the same resolved target — covers multi-repo sessions
#      when the orchestrator is unavailable.
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

# Resolve the repo this gh invocation actually targets, mirroring gh's own precedence:
#   --repo/-R flag  >  GH_REPO env  >  the origin remote of $PWD.
# The result scopes both the orchestrator mint (step 1) and the REPO_CLONE_TOKENS match (step 2),
# so `gh pr create -R oyren-ai/other-repo` works from anywhere, not just from inside that clone.

# gh accepts the repo as OWNER/REPO, HOST/OWNER/REPO, or a full https/ssh URL; reduce all of those
# to "owner/repo", or to "" for anything not on github.com — a github.com mint can't cover another
# host, so an unresolvable target just means the orchestrator applies its own default scoping.
_normalize_repo() {
  local r="${1%/}"
  case "$r" in
    *github.com:*) r="${r##*github.com:}" ;;
    *github.com/*) r="${r##*github.com/}" ;;
    *://*|*@*) r="" ;;  # URL/remote on some other host
  esac
  r="${r%.git}"
  case "$r" in
    */*/*|*:*) r="" ;;  # leftover HOST/OWNER/REPO on a non-github host, or path junk
  esac
  case "$r" in
    */*) printf '%s' "$r" ;;
  esac
}

# Scan argv for --repo/-R (all the spellings gh accepts: `--repo v`, `--repo=v`, `-R v`, `-Rv`);
# last occurrence wins, matching gh's own flag parsing, and a bare `--` ends the scan.
_args=("$@")
_flag_repo=""
for ((_i = 0; _i < ${#_args[@]}; _i++)); do
  case "${_args[$_i]}" in
    --) break ;;
    -R|--repo) _flag_repo="${_args[$((_i + 1))]:-}"; _i=$((_i + 1)) ;;
    --repo=*) _flag_repo="${_args[$_i]#--repo=}" ;;
    -R?*) _flag_repo="${_args[$_i]#-R}" ;;
  esac
done

# First source that is PRESENT wins — an explicit flag/env target that normalizes to "" (e.g. an
# enterprise host) must not fall through to the cwd repo, which would scope the mint to the wrong repo.
if [ -n "$_flag_repo" ]; then
  _repo_name="$(_normalize_repo "$_flag_repo")"
elif [ -n "${GH_REPO:-}" ]; then
  _repo_name="$(_normalize_repo "$GH_REPO")"
else
  _repo_name="$(_normalize_repo "$(/usr/bin/git remote get-url origin 2>/dev/null || true)")"
fi

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

# 2. Per-repo token from REPO_CLONE_TOKENS, keyed by the same resolved target repo.
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
