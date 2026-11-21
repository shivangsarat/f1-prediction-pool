#!/usr/bin/env bash
# Deploy GRIDLOCK/main on the OCI host. No database, backup, or secret files are deleted.
set -Eeuo pipefail

readonly REPOSITORY_DIR='/opt/f1/f1-prediction-pool'
readonly DEPLOY_SCRIPT="$REPOSITORY_DIR/scripts/production/deploy-gridlock.sh"

# The existing guarded deployer owns branch, secrets, persistence, and health checks.
if [[ ! -f "$DEPLOY_SCRIPT" ]]; then
  printf 'DEPLOY BLOCKED: %s is missing. First pull main once on the VM, then rerun ./deploy.sh.\n' "$DEPLOY_SCRIPT" >&2
  exit 1
fi

exec bash "$DEPLOY_SCRIPT"
