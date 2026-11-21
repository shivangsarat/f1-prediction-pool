# Deployment v2.3 · Decisions, Differences and Follow-Ups

## From the supplied deployment PDFs (21 November 2026)

| Area | v2.3 source describes | Repository state / safe action |
| --- | --- | --- |
| Compute | OCI Always Free ARM64, Ubuntu 24.04 LTS, VM.Standard.A1.Flex 2 OCPU / 12 GB RAM, 50 GB boot | Documented as **source-as-built**; actual live tenant remains unverified from repo |
| Networking | Reserved IPv4 and DuckDNS A records; OCI security list + host iptables; Caddy auto HTTPS | Sanitized placeholders in Caddy template; no live address or OCID committed |
| GRIDLOCK | pool `main`, frontend loopback 8081, Nginx `/api` to Node 3001, SQLite WAL | Existing Compose already had isolation and read-only containers; default FRONTEND_PORT aligned to 8081 |
| F1 Telemetry | separate `weekend-tyre-sets`, loopback 8080, WebSocket through Caddy | Branch and representative code files verified; telemetry repo **not** modified |
| Gmail | Google OAuth2 `gmail.send`, external consent configured **In production** | Existing backend supports Gmail API and encrypted mail queue; only docs/config, no credentials |
| Local snapshots | AES-256-GCM on graceful SIGTERM and result publish | Existing `backups.ts` verified; UID 1000/0600 caveats documented |
| Offsite backup | Root rclone cron nightly at 04:00 UTC, private OCI S3-compatible bucket | Ops instructions refined: prefer `rclone copy` to retain historical snapshots; verify cron live |
| Secrets | Canonical `/etc/f1-env/*.env` with repo-local symlinks, possible GitHub Actions secrets | Documented one-time migration; optional manual deploy workflow requires only SSH secrets, **not** replicated `PROD_ENV` |
| Rollout fixes | iptables REJECT ordering, GET vs HEAD health, OAuth Testing expiry, host Node 18, 0600 rclone access, OCI key printed | All added to incident playbooks with targeted checks |

## Security adjustments relative to the source examples

1. **No raw PDFs in public Git:** The supplied PDFs contain real hosting/IP/account details. The published guide intentionally masks them; the originals remain user uploads, not tracked repository files.
2. **No automatic secret overwrite:** The v2.3 delta suggests pushing the full `.env` through a GitHub `PROD_ENV` secret over SSH. This implementation instead leaves `/etc/f1-env` solely on the host and uses a manual production workflow with an authorized deploy key. Avoids duplicating all OAuth/AES keys in the CI system.
3. **No production deployment on push:** CI checks continue on `main`. New deployment workflow is manual-only until an authorized operator creates protected `production` environment and validates SSH fingerprints and local host state.
4. **No unverified keys in docs:** Actual reserved IP, OCI customer secret, operator Gmail and private domain inventory are deliberately not exposed. Public v2.3 docs use placeholders.
5. **Offsite durability improvement:** `rclone copy` rather than `sync` to avoid deleting remote recovery points when local backup retention changes.
6. **Backup caution:** `BACKUP_RCLONE_REMOTE` is optional in source, but the current Node backend Dockerfile does **not** install `rclone`. Host root cron therefore remains the verified *documented* offsite mechanism, and must be checked on the VM.
7. **Restore permission fix:** The supplied guide downloads via root then runs the restore process as UID 1000. New recovery steps explicitly correct downloaded snapshot ownership before restoring.
8. **No rollback guessing:** Schema migrations may be forward-only; a failed app deployment does not authorize a `git reset` against a newer SQLite database.

## Implementation boundary

The v2.3 PDFs describe the **deployment** of GRIDLOCK and F1 Telemetry. This change does not amend rules, payout calculations, live telemetry source, host firewall, DNS settings, Gmail authorization, active OCI services, or production secrets. Those require explicit authorized changes in the VM / respective provider consoles. The release only updates GRIDLOCK repository documentation, safe example configs, and opt-in operations tooling.

## Future operator-verification items

- [ ] Confirm the VM currently uses the documented branch and Caddy service/config.
- [ ] Confirm `/etc/f1-env/` migration is complete before invoking guarded deploy script.
- [ ] Confirm the root backup cron uses an appropriate remote path/retention and has successfully copied encrypted snapshots.
- [ ] Confirm OCI budget alerts, reserved IP attachment, ingress firewall order and disk logging limits.
- [ ] Confirm Gmail OAuth token remains valid, outbox can drain, and refresh token storage is private.
- [ ] Run isolated recovery test and record actual RPO/RTO.
