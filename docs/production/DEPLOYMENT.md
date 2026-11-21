# Branch-Safe Deployment · OCI / Docker Compose / Caddy

## Production configuration contract

| Setting | Source-derived as-built design | Repository verification |
| --- | --- | --- |
| Pool source | `/opt/f1/f1-prediction-pool` on branch `main` | CI and branch verified in GitHub |
| Telemetry source | `/opt/f1/f1_telemetry` on branch `weekend-tyre-sets` | Branch and code layout verified in GitHub |
| Pool app listener | `127.0.0.1:8081` | Pool Compose maps frontend container `8080`; default has been aligned to `8081` |
| Telemetry app listener | `127.0.0.1:8080` | v2.3 as-built document; verify telemetry Compose on VM |
| API | Private backend container `3001` | GRIDLOCK Compose uses `expose:` only, no host-port publishing |
| Caddy | `/etc/caddy/Caddyfile` (systemd service) | Host-only configuration, **not** an application container |
| SQLite | `./data/pool.sqlite`, WAL; UID `1000` | Pool Compose uses writable bind mount while backend root filesystem is read-only |
| Snapshots | `./backups/*.sqlite.gz.enc` | `backend/src/backups.ts` encrypts using AES-256-GCM |
| Environment | `/etc/f1-env/f1-prediction-pool.env` | Planned host migration, **not** proof migration already completed |

## First-time host bootstrap checklist (operator-run only)

1. Confirm the authorized OCI ARM VM, correct region and public interface. Validate Always Free eligibility and set an OCI Budget alert. Host OS is specified as Ubuntu 24.04 LTS, Docker Engine + Compose v2.
2. In OCI network security list, permit TCP **80/443**, optionally UDP **443** for HTTP/3. In the host `iptables` INPUT chain, those allow rules must appear **above** the default Oracle Ubuntu REJECT rule; persist changes with `netfilter-persistent`. Keep SSH limited to a known management source and never expose 3001, 8080, 8081 to the internet.
3. Point authorized DuckDNS hostnames to the VM reserved IPv4. Keep address in the private infrastructure inventory, not committed documentation. Verify DNS propagation before requesting certificates.
4. Configure Caddy using [`deploy/Caddyfile.example`](../../deploy/Caddyfile.example), replacing placeholders on the host only. Validate with `sudo caddy validate --config /etc/caddy/Caddyfile`, then `sudo systemctl reload caddy`.
5. Configure Docker log rotation (see [`deploy/docker-daemon.example.json`](../../deploy/docker-daemon.example.json)): maximum `10m` per file, retain `3`. Use a maintenance window to restart Docker if daemon settings change.
6. If using host-level offsite replication, install root cron from a reviewed copy of [`rclone-backup.cron.example`](../../deploy/rclone-backup.cron.example). Replace its placeholders privately; check last-run health.
7. Clone GRIDLOCK at `/opt/f1/f1-prediction-pool` and telemetry at `/opt/f1/f1_telemetry`. Pin the correct branches. **Do not clone the telemetry branch into the pool directory.**
8. Provision `data/` and `backups/` directories for UID/GID `1000:1000`, without changing their contents if already populated. Provision secrets outside Git as below.
9. Run `docker compose config -q`, build/start each stack, then validate local and public health over HTTPS. Test invitation/auth, a read-only tournament view, Gmail capability, and recent backup metadata.

### Migrate existing GRIDLOCK `.env` to a secure host path

Run once in the GRIDLOCK checkout, as the authorized VM account. Do **not** paste the `.env` content or run with `set -x`:

```bash
cd /opt/f1/f1-prediction-pool
sudo install -d -o "$(id -un)" -g "$(id -gn)" -m 700 /etc/f1-env
# Inspect/backup sensitive file through your password manager first.
install -m 600 .env /etc/f1-env/f1-prediction-pool.env
# Verify the new file is nonempty before removing the old *repo-local* copy:
test -s /etc/f1-env/f1-prediction-pool.env
rm -- .env
ln -s /etc/f1-env/f1-prediction-pool.env .env
test -s .env && readlink -f .env
```

Repeat for telemetry with `/etc/f1-env/f1_telemetry.env` and its own checkout. Keep the canonical paths owner-readable only; restrict directory traversal (0700) and file mode (0600). Docker Compose reads the symlink. In case of failed migration, restore from the protected original—not from Git.

**Recommended production `.env` keys (values private):** `FRONTEND_PORT=8081`, `PUBLIC_ORIGIN=https://<POOL_FQDN>`, `APP_PUBLIC_URL=https://<POOL_FQDN>`, `BACKUP_ENCRYPTION_KEY`, `MAIL_ENCRYPTION_KEY`, `MAIL_PROVIDER=gmail`, `MAIL_FROM=<OPERATOR_EMAIL>`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`. Set OCI and Google credentials only in private host secrets. **Do not configure `BACKUP_RCLONE_REMOTE` inside the current backend image:** `rclone` is not installed there; host root cron is the established offsite path.

### Deploy GRIDLOCK manually (recommended first)

```bash
cd /opt/f1/f1-prediction-pool
./scripts/production/doctor.sh
./scripts/production/deploy-gridlock.sh
curl --fail --silent --show-error http://127.0.0.1:8081/api/health
```

The script checks the repo branch, externalized `.env` symlink, unchanged tracked working tree, host bind-mount paths and Compose validity; it fetches/fast-forwards `main`, builds the two pool services and performs a GET health check. It does **not** modify telemetry, overwrite `.env` or erase SQLite data. New DB migrations can be **forward-only**; do not auto-rollback to older code if a schema migrated.

### Deploy telemetry (separate repository)

```bash
cd /opt/f1/f1_telemetry
git status --short
git fetch origin weekend-tyre-sets
git switch weekend-tyre-sets
git pull --ff-only origin weekend-tyre-sets
docker compose config -q
docker compose up -d --build
curl -I http://127.0.0.1:8080/
```

Only do this after verifying the telemetry code and Compose settings. This repo does **not** own telemetry's release pipeline; GRIDLOCK's deployment script intentionally leaves telemetry untouched.

## Optional GitHub Actions deployment

[`deploy-production.yml`](../../.github/workflows/deploy-production.yml) runs **only via manual `workflow_dispatch`** and only from branch `main`. It reruns the application verification jobs before SSH. To activate it:

- Create a GitHub **environment** named `production`, with required reviewers and restricted deployment branches.
- Create repo secrets: `PROD_SSH_HOST`, `PROD_SSH_USER`, `PROD_SSH_PRIVATE_KEY`, `PROD_SSH_KNOWN_HOSTS`. Only place the VM's address and private key in these GitHub Secrets (never README or logs). Restrict the SSH key to a dedicated deploy principal when feasible.
- Populate the known-hosts secret from a **verified** server host-key fingerprint obtained out of band. Do not use `StrictHostKeyChecking=no` or blindly trust `ssh-keyscan` run inside the deployment job.
- Keep `.env` **only** on the server under `/etc/f1-env`. This workflow never copies production env contents through GitHub and never touches the telemetry branch.
- Review the workflow before enabling approvals; test the same procedure manually once. If keys and environment are missing, manual workflow invocation will fail safely.

## Reverse proxy and origin correctness

A matching example is [`Caddyfile.example`](../../deploy/Caddyfile.example); its hostnames are placeholders. Caddy routes `POOL_FQDN` to `127.0.0.1:8081` and `DASH_FQDN` to `127.0.0.1:8080`. The pool's Nginx keeps the browser's Host and Origin visible to the Node API; ensure `PUBLIC_ORIGIN` matches the exact HTTPS pool origin. Do not globally disable CSRF to fix a cross-origin 403.

## Rollback constraints

- **Application-only failure with no schema change:** pin a reviewed earlier commit, rebuild, smoke-test and document incident ID.
- **Database migrated:** restore a consistent encrypted database snapshot *together with compatible application code*, using [Backup & Recovery](BACKUP_RECOVERY.md). Never run old backend schema assumptions against migrated tables.
- **Never:** use `docker compose down -v`, `git clean -fdx`, or delete `./data`, `./backups` and `/etc/f1-env` as a deployment step.


## Root-level single command and GitHub Actions

Use `cd /opt/f1/f1-prediction-pool && bash ./deploy.sh` to update the prediction-pool application. The root script delegates to `scripts/production/deploy-gridlock.sh`, which performs a guarded fast-forward of `main`, a Docker Compose rebuild, and an API GET smoke test. The dashboard has a **different** root deploy script in `/opt/f1/f1_telemetry`, pinned to `weekend-tyre-sets`. Do not deploy both unless both require updates.

The existing GitHub Actions **Manual production deploy (GRIDLOCK only)** workflow provides the same process with pre-deployment checks and a protected `production` environment. Add its `PROD_SSH_HOST`, `PROD_SSH_USER`, `PROD_SSH_PRIVATE_KEY`, and `PROD_SSH_KNOWN_HOSTS` secrets in GitHub Settings. These values are never copied into source or commit history. A run initiated through GitHub requires SSH access to the authorized VM; the workflow does not create or manage the VM.

**First install:** if `deploy.sh` or its nested script is not yet present on the VM, perform one reviewed `git pull --ff-only origin main` from the expected checkout. Thereafter the single root command works. Updating frontend files does not invalidate a browser's already-open page until it reloads. Normal browser refresh fetches the updated Vite assets; do not use `docker compose down -v` or `git clean -fdx` to force an update.

**Safety:** deployments are manual-only and serialized within each repository's Actions workflow. They are not cross-repository transactions. During a rollout, the prediction frontend/API may be momentarily unavailable. Check Caddy and the production HTTPS page after the local health check; automatic rollback is deliberately disabled for SQLite schema migrations.
