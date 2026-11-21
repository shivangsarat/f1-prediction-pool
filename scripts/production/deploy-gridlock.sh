#!/usr/bin/env bash
# Guarded manual deployment of only GRIDLOCK/main. Never touch telemetry or clear persisted state.
set -Eeuo pipefail

readonly REPO_DIR="/opt/f1/f1-prediction-pool"
readonly EXPECTED_ENV="/etc/f1-env/f1-prediction-pool.env"
readonly BRANCH="main"

# /** Print a deployment error to stderr and abort without destructive cleanup. */
fail() { printf 'DEPLOY BLOCKED: %s\n' "$1" >&2; exit 1; }

# /** Check local filesystem/Compose safeguards without echoing environment contents. */
preflight() {
  [[ -d "$REPO_DIR/.git" ]] || fail 'Expected checkout missing.'
  cd "$REPO_DIR"
  command -v docker >/dev/null || fail 'Docker is not installed.'
  command -v curl >/dev/null || fail 'curl is not installed.'
  [[ "$(git branch --show-current)" == "$BRANCH" ]] || fail 'Checkout is not on main.'
  [[ -z "$(git status --porcelain --untracked-files=no)" ]] || fail 'Tracked working tree is dirty; inspect with git status/diff.'
  [[ -L .env ]] || fail '.env must be an externalized symlink; see docs/production/DEPLOYMENT.md.'
  [[ "$(readlink -f .env)" == "$EXPECTED_ENV" ]] || fail '.env points outside approved external secret path.'
  [[ -s .env ]] || fail 'Externalized environment is missing or empty.'
  grep -qx 'FRONTEND_PORT=8081' .env || fail 'FRONTEND_PORT must be explicitly set to 8081 for co-hosted deployment.'
  grep -q '^PUBLIC_ORIGIN=https://' .env || fail 'Production PUBLIC_ORIGIN must be HTTPS.'
  for directory in data backups; do
    [[ -d "$directory" ]] || fail "$directory bind-mount directory is missing."
    [[ "$(stat -c '%u' "$directory")" == '1000' ]] || fail "$directory is not owned by backend UID 1000."
  done
  docker compose config -q || fail 'Docker Compose validation failed.'
}

# /** Fast-forward only along the reviewed main history, preventing accidental branch rewrites. */
fast_forward_main() {
  local previous
  previous="$(git rev-parse --short HEAD)"
  git fetch --quiet origin "$BRANCH"
  git merge-base --is-ancestor HEAD "origin/$BRANCH" || fail 'Local main diverges; manual review required.'
  git pull --ff-only origin "$BRANCH"
  printf 'GRIDLOCK release: %s -> %s\n' "$previous" "$(git rev-parse --short HEAD)"
}

# /** Rebuild both pool services while retaining bind-mounted SQLite, backups, and external secrets. */
restart_pool() {
  docker compose config -q || fail 'Updated Compose configuration invalid.'
  docker compose up -d --build
  docker compose ps
}

# /** Use the documented GET endpoint to validate the reverse-proxied API after replacement. */
verify_local_health() {
  curl --fail --silent --show-error --retry 8 --retry-connrefused --retry-delay 2 --max-time 8 \
    http://127.0.0.1:8081/api/health > /dev/null || fail 'Local API health failed; inspect container logs.'
  printf 'GRIDLOCK local GET /api/health OK. Confirm public HTTPS, email and roster separately.\n'
}

preflight
fast_forward_main
restart_pool
verify_local_health
