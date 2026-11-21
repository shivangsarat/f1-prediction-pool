# Production Release Checklist

## Before change

- [ ] Associate change with a GitHub issue/PR and approved production maintenance window.
- [ ] Confirm `main` (GRIDLOCK) commit and independent telemetry `weekend-tyre-sets` state; never confuse repositories.
- [ ] All GitHub CI jobs pass (backend lint/tests; frontend lint/tests/build).
- [ ] Check `git status --short` on VM; no unexplained tracked modifications.
- [ ] Confirm `readlink -f .env` points to the expected **host-externalized** file. Do not print contents.
- [ ] Verify `FRONTEND_PORT=8081`, `PUBLIC_ORIGIN` exact HTTPS, and Caddy upstream; use secure inventory for domains.
- [ ] Validate root rclone cron, latest local encrypted snapshot **and** offsite object timestamp.
- [ ] Back up critical DB before any migration; confirm key recovery and compatible rollback code/snapshot.
- [ ] Check `/` disk free, Docker/Compose service health and OCI budget alert.
- [ ] Inform tournament users if expected downtime overlaps qualifying lock or scoring publication.

## Deploy

- [ ] Run `./scripts/production/doctor.sh` on the VM.
- [ ] Use `./scripts/production/deploy-gridlock.sh`, or run opt-in manual GitHub Actions workflow after environment review.
- [ ] Verify local `/api/health` via **GET**; then external HTTPS via Caddy.
- [ ] Confirm only `127.0.0.1:8081` is exposed for GRIDLOCK; Node 3001 is not publicly bound.
- [ ] Check Node backend restart log for migrations, schema errors or unhandled rejections.
- [ ] Do **not** run destructive Git cleanup, `docker compose down -v`, database file delete or unreviewed `git reset --hard`.

## Post-deploy feature smoke

- [ ] Login/logout and HTTP-only cookie operate; no Cross-Origin 403 for legitimate HTTPS.
- [ ] Lobby and public catalogue work; private tournaments remain invisible without invitation.
- [ ] Tournament access is scoped for ordinary users; global operator access works (without publishing personal info).
- [ ] Roster and upcoming calendar display; OpenF1 failures degrade cleanly.
- [ ] Prediction session locks and Sprint form mode reflect persisted UTC schedule.
- [ ] Published standings/ledger views are readable without changing immutable data.
- [ ] Email capability/outbox is healthy if enabled; no mass resends.
- [ ] Post-publication backup exists, is encrypted and copied offsite after the next sync window.

## Rollback / incident handoff

- [ ] Log deployed commit, UTC timestamp, symptoms and actions **without credentials**.
- [ ] Check whether SQLite schema migrated; use matching backup/commit if rollback is necessary.
- [ ] Notify users if a deadline, race result, or financial audit needs manual intervention.
