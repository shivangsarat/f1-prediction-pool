#!/usr/bin/env bash
# Read-only production preflight: never read or print .env contents, tokens or credentials.
set -Eeuo pipefail

readonly REPO_DIR="${GRIDLOCK_REPO_DIR:-/opt/f1/f1-prediction-pool}"


# /** Show nonsecret status while preserving exit errors for actual missing prerequisites. */
report() { printf '\n== %s ==\n' "$1"; }
# /** Report whether a required externalized secrets path is configured, not its contents. */
check_env() {
  local location
  if [[ ! -L .env ]]; then
    printf 'WARNING: .env is not a symlink; external secret migration not confirmed.\n'
    return 0
  fi
  location="$(readlink -f .env)"
  if [[ "$location" == /etc/f1-env/f1-prediction-pool.env ]]; then
    printf 'OK: .env points to the expected external host path.\n'
  else
    printf 'WARNING: .env points to a nonstandard location; verify privately.\n'
  fi
  if [[ -s .env ]]; then printf 'OK: environment file exists and is nonempty.\n'; else printf 'ERROR: linked env file missing or empty.\n'; fi
}

if [[ ! -d "$REPO_DIR" ]]; then printf 'ERROR: checkout not found at expected path.\n' >&2; exit 1; fi
cd "$REPO_DIR"
report 'Git status'
printf 'Current branch: '; git branch --show-current || true
printf 'Commit: '; git rev-parse --short HEAD || true
printf 'Tracked edits:\n'; git status --short --untracked-files=no || true
report 'Secret-file path only (not contents)'
check_env
report 'Persistent directories (no file contents)'
for target in data backups; do
  if [[ -d "$target" ]]; then
    stat -c '%n owner=%u:%g mode=%a' "$target"
  else
    printf 'WARNING: %s directory missing\n' "$target"
  fi
done
report 'Container health'
if command -v docker >/dev/null 2>&1; then
  docker compose ps || true
else
  printf 'ERROR: docker is not available\n'
fi
report 'Caddy service'
if command -v systemctl >/dev/null 2>&1; then
  systemctl is-active caddy || true
fi
report 'Local GRIDLOCK GET health'
if command -v curl >/dev/null 2>&1; then
  curl --fail --silent --show-error --max-time 5 http://127.0.0.1:8081/api/health || true
  printf '\n'
fi
report 'Disk headroom'
df -h / || true
printf '\nPreflight complete. No environment values, database rows or credentials were read.\n'
