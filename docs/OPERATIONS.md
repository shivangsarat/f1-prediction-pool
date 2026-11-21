# GRIDLOCK operations, migration and recovery

## Port and deployment model

Gridlock is now **two independent services**, not a single Node backend serving a frontend bundle:

- `frontend`: built React SPA in unprivileged nginx, listening on container port 8080, reverse-proxying `/api` internally.
- `backend`: API-only Node.js 22 process on private container port 3001, with durable SQLite files in `/app/data`.

The existing live F1 dashboard can keep host port **8080** while Gridlock uses **8081** (`FRONTEND_PORT=8081`). For development, Gridlock Vite runs on 5173 and proxies to backend 3001. When the live F1 dashboard is not bound to 8080, Gridlock can use 8080 with `FRONTEND_PORT=8080`. A single host cannot expose both on 8080 without separate interfaces or name-based reverse proxying; prefer separate Cloudflare hostname routes.

## Safely upgrading a v1 database

1. Stop the existing single-container deployment and **create/verify a full consistent backup** of `pool.sqlite` including outstanding WAL writes.
2. Preserve existing `.env` secrets and original admin email/bootstrap settings. Make a copy of `./data` and `./backups` outside the deployment directory.
3. Configure the new `.env` with `FRONTEND_PORT`, a random 64-hex-character `BACKUP_ENCRYPTION_KEY` and public HTTPS `PUBLIC_ORIGIN`.
4. Deploy with `docker compose up -d --build`. The backend inspects the SQLite schema on start; it migrates the old globally unique `year` season to new `UNIQUE(tournament_id, year)` and creates a **Legacy F1 Pool**. Users join that pool according to their previous accounts; the prior operator remains the commissioner. Subsequent starts do not re-run migration.
5. Log in, open Legacy F1 Pool, verify driver rosters, race results, scores, membership, and ledger. Check a second simultaneous tournament with the same season year.
6. If anything fails, stop the new containers and restore the original backed-up DB before returning to v1.

The migration recreates the `seasons` table inside a SQLite transaction with foreign keys paused during the swap and verified afterwards. Never run an older v1 application against a migrated v2 database.

## Authentication and access

Create a user through the browser. A creator is automatically **commissioner of their tournament only**; they do not need a global operator key. Copy the one-time invite code upon creation, or rotate it from the tournament's commissioner panel to invite additional people. Rotation immediately invalidates all previous invitation codes. All API writes check tournament membership independently of the UI.

Browser auth uses HttpOnly, SameSite Strict cookies. In production the cookie is Secure, and `PUBLIC_ORIGIN` should match the external HTTPS origin exactly. Configure the TLS proxy to preserve the original Host header. A cross-origin iframe or third-party frontend cannot use the cookie-based API. Log out to revoke persisted session tokens.

## Session deadline and outage handling

Qualifying locks are never managed by in-memory timers: the API compares its current UTC to the persisted deadline **on each read and mutation**. Scheduled local sleep or proxy downtime never extends a deadline. During outage, users can send pre-lock timestamped picks through a commissioner-agreed group-chat fallback, which the commissioner records with evidence and an audit trail. After published results, fallback entries are refused.

## OpenF1 reconciliation and official scoring

OpenF1 `session_result`, `laps`, `drivers` and `starting_grid` may be delayed or provisional. On startup, `AUTO_SYNC_ON_STARTUP=true` stages at most two recent missing classifications (5 hours to 30 days ago), never publishing them. The commissioner must verify FIA Pole Award rather than Sunday grid P1, fastest classified lap, first official NC/Retired including Lap-1 ties, green-flag laps, Sprint pit lane P20 baseline, ties, and classification. The server refuses to publish without a current scoring preview digest. Official published results are immutable under the original 24-hour/final-classification rules.

## Ledger and financial reconciliation

Entries are recorded manually after external payments settle. Integer cents and idempotency keys prevent accidental duplicate recording, and a balance cannot go negative. Refunds cannot exceed the member's paid-in balance; payouts identify a tournament member. The application does not perform real transfers. All transaction records are audit logged. The shared ledger omits private idempotency and operator IDs, but descriptions are visible to tournament members; **do not include account numbers or other secrets**.

## Encrypted SQLite backups

`./data` and `./backups` are host-mounted persistent directories. Do not copy a live `.sqlite` file without using SQLite's online backup API, because the WAL file may have uncheckpointed writes. On SIGTERM the API performs a consistent backup and then checkpoints WAL, allowing safe shutdown.

Production requires a valid `BACKUP_ENCRYPTION_KEY` (generate with `openssl rand -hex 32`). Encryption uses the frame:

```text
F1BK\x01 (5 bytes) | AES-GCM IV (12 bytes) | GCM auth tag (16 bytes) | encrypted gzip(SQLite)
```

For offsite storage set `BACKUP_RCLONE_REMOTE`, install rclone **on the server/host** and configure its credentials; the Docker image doesn't include rclone. A local-only encrypted snapshot does not protect against disk loss. A failed offsite upload returns a warning and does not undo a published scoring result.

Restore to a **new** database path using the original key (never overwrite an active DB):

```bash
BACKUP_ENCRYPTION_KEY=<original-hex-key> node scripts/restore-backup.mjs \
  backups/pool-....sqlite.gz.enc restored/pool.sqlite
```

Stop the server, move old SQLite and `-wal/-shm` files aside, copy the restored DB into `./data/pool.sqlite` and ensure UID 1000 can write. Check tournament membership, audit trail, classification locks, scores and balances after restart.

## Health check and CI

```bash
# Docker/nginx user-facing port (with FRONTEND_PORT=8081):
curl http://127.0.0.1:8081/api/health
# Local development (backend directly):
curl http://127.0.0.1:3001/api/health

npm test
npm run lint
npm run build
```

Before production launch, verify separate frontend/backend jobs in GitHub Actions, inspect the browser console for CSP violations, test session cookies over HTTPS, run a full restore rehearsal and check that both the live F1 dashboard and Gridlock remain accessible on their configured hostnames/ports.

## V0.3 — Operator permissions, public catalogue and official mail

**Database migration:** On startup the backend adds `tournaments.visibility` (default `invite_only`), `tournaments.status` (default `active`), a unique case-insensitive username per account, `users.email_verified_at`, notification opt-in, user-targeted invitations and the encrypted email outbox. Existing users receive collision-resistant generated usernames based on their display name and user ID; original user IDs, passwords, sessions, tournament memberships, picks and ledgers remain unchanged. Take and verify an encrypted backup before upgrading.

**Global Gmail operator:** Set `ADMIN_EMAIL` to the intended account and a random `ADMIN_BOOTSTRAP_KEY` before registering that email for the first time. The account receives global `admin` role only when the key matches. If that Gmail account already exists as a participant, run `scripts/promote-operator.mjs` **on a trusted host** after setting `ADMIN_EMAIL`, `ADMIN_BOOTSTRAP_KEY` and `DB_PATH`; supply the exact key as the CLI argument, e.g. `node scripts/promote-operator.mjs "$ADMIN_BOOTSTRAP_KEY"`. Restrict shell history and permissions when doing this; prefer executing in a private maintenance shell. Do not use direct SQL edits or let other users self-promote. Global operator changes are audited as `tournament.amend` and other commissioner action types.

**Public/private discovery:** A public tournament appears only while status is `active`; archived tournaments remain available to members and the operator for record review but refuse new members. An invite-only tournament is never listed in the public catalogue. Private invite links can be rotated on the tournament management page, revoking all earlier links. Username invitations require recipient acceptance and have a per-commissioner daily rate limit.

**Email setup:** Email is off by default and is never needed to accept picks or publish results. Configure an optional Gmail API OAuth2 account or a free transactional provider as documented in [EMAIL.md](EMAIL.md). With mail enabled, `APP_PUBLIC_URL` must point at the HTTPS frontend hostname and at-rest email encryption must have a 64-hex-character secret. Protect `GMAIL_REFRESH_TOKEN`, `GMAIL_CLIENT_SECRET`, `BREVO_API_KEY` or `RESEND_API_KEY` in backend secrets only. Email confirmation links expire after 24 hours and can be requested at most three times per 24 hours per account. Participants can opt out of event mail.

**Delayed/failed emails:** The backend periodically reconciles recently locked weekend forms from stored UTC times (including Sprint Qualifying before GP Qualifying), then attempts queued mail with delivery leases and exponential retry. Use global operator lobby → **Platform email delivery** → **Reconcile notification queue** to trigger catch-up manually. If the provider reaches its free daily quota, jobs remain queued for later attempts. Do not use this mechanism as the sole evidence of a payment or pick: the database and audit trail remain authoritative. Provider acceptance may be recorded after a network interruption, so email delivery is at-least-once rather than exactly-once.

**Production change control:** Run backend Node tests and frontend Vitest, ESLint and TypeScript/Vite build in CI. Verify HTTPS `PUBLIC_ORIGIN` matches `APP_PUBLIC_URL`; test registration → confirmation → joining link → tournament settings → blind pick → lock reveal → published standings → final payout notice with a synthetic staging tournament. Inspect the operator audit log and ledger for anomalous adjustments before going live. An external security penetration test is still recommended.


## Mid-season v2.1 deployment checklist

Before upgrading a persistent database, take an encrypted backup with WAL-consistent snapshotting and test recovery. The migration makes the original fixed August windows nullable and creates additional season scope, operator governance, OpenF1 cache and email priority columns; it retains all existing scores and ledger records. Inspect the public/invite-only visibility and the operator's `allowPublicMidseason` + `maxActiveOwnedPools` controls. Configure each mid-season tournament with the actual future F1 round and remaining-race count; import upcoming rounds only. Verify the first qualifying lock and use the zero-entry option when fewer than three races remain. Neither new tournaments nor operator changes may refund already locked pools. See [mid-season runbook](MIDSEASON_V2_1.md).
