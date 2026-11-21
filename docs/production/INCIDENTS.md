# Incident Response & Troubleshooting Playbooks

## Severity & escalation

| Severity | Examples | First action |
| --- | --- | --- |
| **SEV-1** | Ledger corruption, unauthorized data disclosure, confirmed credential theft, irreversible scoring publication error | Suspend risky mutations, preserve evidence, restrict access, notify operator; do not manually edit SQLite |
| **SEV-2** | Both public hostnames down, pool 502, database writer fails to start, qualifying deadline nearing during outage | Check Caddy/OCI, containers and disk; provide pre-lock timestamped fallback procedures |
| **SEV-3** | OpenF1 rate limits, stale roster, email backlog, telemetry WebSocket failures | Degrade safely; cache/retry, commissioner/manual override or operator queue reconciliation |
| **SEV-4** | Cosmetic UI, documentation or nonurgent admin report | Create issue; follow normal CI/deployment |

**Incident log fields:** UTC start/end, affected service, customer-visible symptom, deployment SHA, outcome/status, checks run, operator decisions, recovery point, evidence references, and next preventive action. Keep personal data/credentials **out** of the GitHub issue; use private protected storage if detailed logs are required.

## Read-only triage first

```bash
cd /opt/f1/f1-prediction-pool
./scripts/production/doctor.sh
sudo systemctl status caddy --no-pager
sudo journalctl -u caddy -n 50 --no-pager
docker compose ps
docker compose logs --tail 100 backend
ss -ltn
df -h /
curl -i http://127.0.0.1:8081/api/health
# Use verified public pool host (GET, not HEAD):
curl -i "https://<POOL_FQDN>/api/health"
```

### 1 · Public site fails / SSL ACME validation error

**Symptom:** connection timeout, certificate request fails or immediate ACME validation error.

**Check:** DNS A-record (authorized console); OCI VCN security list for inbound 80/TCP and 443/TCP; host firewall rules **before** the Oracle default REJECT line. Verify Caddy active and its config valid.

```bash
sudo iptables -L INPUT -n --line-numbers
sudo systemctl status caddy --no-pager
sudo journalctl -u caddy -n 80 --no-pager
sudo caddy validate --config /etc/caddy/Caddyfile
```

Do not blindly flush the firewall or delete REJECT rules. Schedule changes and keep SSH access available.

### 2 · Caddy gives 502 Bad Gateway

**Interpretation:** TLS/DNS likely work; the upstream app port is unavailable.

```bash
curl -i http://127.0.0.1:8081/api/health
docker compose ps
docker compose logs --tail 100 frontend backend
ss -ltn | grep -E ':(8080|8081)\b'
```

If backend is restarting, check the next section. If `8081` isn't bound, ensure `FRONTEND_PORT=8081`, inspect Compose and restart the pool frontend. If the telemetry endpoint is affected, inspect **its separate** Compose project/port 8080.

### 3 · Backend repeatedly restarts / SQLite EACCES / SQLITE_CANTOPEN

```bash
cd /opt/f1/f1-prediction-pool
docker compose logs --tail 100 backend
stat -c '%u:%g %a %n' data backups
ls -ld data backups
```

The backend container runs as UID 1000 with a read-only root filesystem; **data and backups** must be writable through bind mounts. On a verified host path only, correct ownership if needed:

```bash
sudo chown -R 1000:1000 /opt/f1/f1-prediction-pool/data /opt/f1/f1-prediction-pool/backups
docker compose up -d --force-recreate backend
```

Confirm `BACKUP_ENCRYPTION_KEY` is a 64-character hex value **without printing it**. Do not recursively change permissions on `/etc/f1-env` or remove WAL files while writer runs.

### 4 · `/api/health` reports 401/404 using `curl -I`

`curl -I` sends a HEAD request; GRIDLOCK health route uses GET. Use `curl -i` or `curl -fsS` (GET). If GET returns a non-2xx response, then inspect route/proxy code.

### 5 · Login rejected / `Cross-origin request blocked` / 403

Check browser DevTools Network response, then match `PUBLIC_ORIGIN=https://<POOL_FQDN>` and `APP_PUBLIC_URL` in the private VM environment. Check Caddy → Nginx forwarding of Host and X-Forwarded-Proto, browser URL protocol HTTPS, and cookie `Secure`/SameSite. Only a narrow localhost Vite exception is available in development mode; do not disable origin checks in production.

### 6 · Prediction form blocked / roster unavailable / lock disputes

Find exact tournament, round, form (`gp`, `sprint`, `unified`) and **UTC qualifying lock** from the persisted schedule. Validate user membership, same-season driver roster and the current server clock. If fewer than 10 drivers appear, inspect OpenF1 roster-sync status and the participant Retry option; check `backend/src/rosterSync.ts` and OpenF1 API logs. Do not import a past year's roster. Post-lock ballots remain immutable; commissioner emergency entry requires independently timestamped pre-lock evidence, which is audited.

### 7 · OpenF1 429 / slow dashboard / stale telemetry

GRIDLOCK's global SQLite OpenF1 cache deduplicates tournament requests, with persisted TTLs. Inspect `backend/src/openf1.ts` and `rosterSync.ts`. For live telemetry, inspect `backend/src/providers/{FreeFastF1Provider,OpenF1PaidProvider}.ts` and the upstream provider's rate limits. Avoid increasing the number of backend replicas or opening duplicate polling loops; use the existing broadcast hub.

### 8 · Telemetry WebSocket disconnects

Inspect browser Network → WS. Public URL **must** use `wss://<DASH_FQDN>`, not unsecured `ws://` from HTTPS. Validate Caddy routing to 127.0.0.1:8080 and telemetry container logs. Review `backend/src/websocket/BroadcastSyncHub.ts` and upstream-provider health. A dashboard broadcast delay is unrelated to GRIDLOCK's race pick deadlines.

### 9 · Gmail email queue grows / no official notices

Check GRIDLOCK Operator → Platform email delivery panel and `/api/email/capabilities`; do not expose queue contents. Inspect backend error classification: 400/401 can indicate invalid/revoked refresh token or OAuth app Testing status; 403 may indicate Gmail API disabled, wrong scope or sender mismatch; 429 indicates quota. Google Auth Platform Audience should match the **In production** configuration in v2.3. When fixed, use operator-only mail sync; the database outbox retries and messages may be duplicated if the provider accepted but acknowledgment was lost.

### 10 · Backups stale / rclone permission denied

Encrypted local snapshots are mode `0600` owned by UID 1000, while SSH login may be UID 1001. Run rclone with root authorization and an explicit private config path; inspect root crontab. Use `rclone copy` (preserves historical remote files) rather than `sync` unless deletion policy is formally approved. Do not paste `rclone config show`—it may expose credentials.

### 11 · `node:sqlite` missing on host

Ubuntu's system `node` may be Node 18 and does not support this app's built-in SQLite. Use the project's Node 22 Docker image for maintenance scripts, or explicitly pin a supported Node 22 runtime. See [Recovery](BACKUP_RECOVERY.md); do not upgrade system Node in the middle of an incident without a plan.

### 12 · `git pull` refuses due to local changes

Run `git status --short` then `git diff` **without printing secrets**. Stop; determine if the tracked changes are intentional. The safe deploy script refuses dirty tracked trees and non-fast-forward changes. Do not use `git reset --hard` or `git clean -fdx` as incident fixes.

### 13 · Financial payout / standing discrepancy

Inspect the season/race scope, publication digest and historical audit trail. Confirm `Gross Pot = buy-ins + refunds + adjustments` for the correct season, then operator + creator rake (≤15% combined), payout model and Hamilton cents rounding. **Do not SQL UPDATE** the ledger, published scores, or participant payments. Use auditable application correction procedures; escalate anything requiring historical rewrite.

## Stop-the-line security response

If any secret was printed in a screenshot, shell trace, CI log or support artifact, treat it as exposed: stop sharing evidence, rotate the affected credential through its owning provider (OCI customer secret, Gmail OAuth refresh credential, GitHub SSH key), update `/etc/f1-env` and rclone configs, verify normal service, and document rotation without copying the old/new values.
