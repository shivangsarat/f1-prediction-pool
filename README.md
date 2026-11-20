# GRIDLOCK — F1 Prediction Pool

An unofficial, private Formula 1 prediction championship, implemented from **F1 Prediction Pool — System & Rules Design Document v1.0** (archived in [`docs/design-spec.pdf`](docs/design-spec.pdf)).

**Stack:** React 19 + TypeScript/Vite UI; Node.js 22 native HTTP API and TypeScript; SQLite in Write-Ahead Logging mode; Docker Compose; OpenF1 ingestion with mandatory commissioner verification.

## Quick start (local development)

Requires **Node.js >=22.13** (v22.16+ recommended), npm, and an internet connection to install the React/Vite packages.

```bash
cp .env.example .env
# Edit .env: set ADMIN_EMAIL and a strong ADMIN_BOOTSTRAP_KEY.
# Generate optional backup key: openssl rand -hex 32
npm install
npm run dev:api          # terminal A -> http://localhost:8080
npm run dev:web          # terminal B -> http://localhost:5173
```

Open `http://localhost:5173`; create a commissioner account using the email and bootstrap key from `.env`. The Vite dev server proxies `/api` to port 8080. **Load environment variables from `.env` into the API process** before running `npm run dev:api`: the API reads OS environment variables, not dotenv files. For example:

```bash
set -a; . ./.env; set +a
npm run dev:api
```

The participant UI allows registration with any other email (12+ character password). Sessions are persisted as SHA-256 hashes of 256-bit bearer tokens in the DB; tokens expire after 7 days. The UI keeps its token in `sessionStorage` (per tab).

## One-container deployment (VPS or intermittent local computer)

```bash
cp .env.example .env
# Fill in the secrets and encryption key in .env
mkdir -p data backups
# Docker bind mounts must be writable by the container user (uid 1000).
sudo chown -R 1000:1000 data backups
docker compose up -d --build
```

The service binds to `127.0.0.1:8080` on the host. Put **Cloudflare Tunnel**, Caddy/HTTPS, or your chosen reverse proxy in front of it. Don't expose the port directly without TLS. One backend process is sufficient for a small private league; the SQLite database and OpenF1 throttle are process-local for correctness.

**Shutdown-safe:** data resides in `./data` outside the container, using SQLite WAL. Pick deadlines are evaluated against UTC timestamps on *every request*, independent of timers or cron jobs; if the host is offline at qualifying start, a late pick is rejected when it returns. A graceful SIGTERM performs a consistent backup before a WAL checkpoint and shutdown. Published scores also trigger an automatic backup.

**Offsite backup:** set `BACKUP_ENCRYPTION_KEY` (32 bytes as 64 hex chars) and configure `BACKUP_RCLONE_REMOTE`, with `rclone` installed on the machine/container and a configured destination (S3/Google Drive supported by rclone). Backups are gzipped and encrypted using AES-256-GCM before upload. If upload is not configured, backups are local only; **local-only backups do not protect against disk failure**. See [Recovery operations](docs/OPERATIONS.md).

**Note:** The provided Docker image doesn't ship `rclone`. To enable offsite upload in Docker, build an image that installs rclone and mounts its configured credentials securely, or run a host-side rclone task on the encrypted `./backups` directory. Don't call local-only backups offsite-safe.

## Season onboarding (commissioner)

1. Register with `ADMIN_EMAIL` and `ADMIN_BOOTSTRAP_KEY` in the signup form.
2. **Commissioner → Season setup:** create the season, choose `two-form` (default) or `one-form` Sprint mode, fee, currency, and tier cutoffs. Set a one-week August salvage window and pre-season UTC lock.
3. **Roster:** use an OpenF1 session key to import drivers/constructors, or paste the JSON roster manually. Roster replacement is blocked after any submissions.
4. **Calendar:** preview/import OpenF1 season schedule or create rounds manually. Each deadline must have an explicit UTC offset, and first round lock must be on/after preseason lock.
5. **Prize Pool / Commissioner → Buy-ins:** manually record settled buy-ins with idempotency keys. This app **does not charge payment methods or transmit money**.
6. Participants register, choose a season, submit their predictions, and follow standings.
7. Once the race classification is available, Commissioner → Race control → Sync OpenF1 or enter JSON. Confirm FIA Pole Award, fastest classified lap, first NC/Retired (ties), green-flag lap count, Sprint top team/grid-delta ties and final classification; **Preview Scores**; then Publish.
8. After the season's last officially scored race, Commissioner → Champions publishes WDC/WCC results (+25 each).

## Rules implemented

| Rule | Behaviour |
| --- | --- |
| Exact podium P1–P3 | +10 **total** (no bonus stacking) |
| Exact P4–P10 | +5 |
| Off by 1 / off by 2 | +3 / +1, even for P10 → P11/P12 |
| Wrong podium slot but still top three | +3 extra on top of proximity (up to 6) |
| Standard props | Pole +5; official fastest classified lap +5; first official NC/Retired +10 (Lap-1 ties) |
| Sprint props | Sprint winner +5; highest-scoring team +3 (ties); most Sprint places gained +3 (ties) |
| Sprint forms | Default Sprint and GP forms at separate locks, optional unified form at Sprint Qualifying lock; configuration freezes at first Round 1 lock |
| WDC/WCC | +25 each; August salvage edits −15 per changed category, applied after window closes |
| Missed submissions | 0 for missed form; GP remains eligible if Sprint form missed in two-form mode |
| Race cancellation | 0 for full cancellations or fewer than 2 green-flag laps |
| Result freeze | Official final race classification or 24 hours after chequered flag; published scores are immutable |
| Pool tiers | 2–3 winner-takes-all; 4–5 top-two 75/25; 6–10 third-entry refund plus 75/25 remainder; 11+ 65/25/10 |
| Partial buy-in | Caps individual payout to proportion paid; difference redistributed to fully-paid prize recipients, if available |
| Season ranking | Total points → exact podiums → exact Top 10s → cumulative props → best weekend → equal split |

Tests assert all of the document's worked payout rows and the 85/96 theoretical maxima.

## Architecture

```text
              Browser (React + TypeScript)
                        │ HTTPS
                  Reverse proxy
                        │
                 Node.js API :8080
         ┌──────────────┼──────────────┐
       Auth         Rules engine      OpenF1 adapter
         │              │                 │
         └────── SQLite WAL ──────────────┘
                    persistent volume
                        │
           encrypted optional rclone backup
```

Monorepo layout:

- `apps/web`: participant/admin portal
- `apps/api`: auth, SQLite persistence, HTTP endpoints, reconciliation, OpenF1 adapter, backups
- `packages/core`: pure rules/scoring and adaptive payout functions
- `docs`: archived specification, operational runbook, API notes
- `scripts`: offline backup restoration
- `.github/workflows`: automated tests and frontend build

## Validation

```bash
npm test           # core rules + SQLite/HTTP integration tests (no dependencies to install)
npm run build      # requires npm install (React/Vite dependencies)
```

**Development status:** scoring, authenticated API, participant/admin UI source, SQLite integration, and tests are implemented. The native API and tests have been run. The React/Vite build has **not** been executed in the sandbox (the sandbox lacks npm registry access), so the frontend build must be validated after `npm install` or by the included GitHub Action. Production readiness additionally requires HTTPS/reverse-proxy hardening, configured offsite backups and user acceptance testing with a real race calendar. Managed PostgreSQL deployments are not part of this initial SQLite implementation.

## Important cautions

- The document's payouts describe an informal pool; confirm local rules and payment/legal requirements before involving real entry fees.
- The OpenF1 API is **independent of FIA and Formula 1**. Its output is used only to populate a provisional admin draft. Official classifications require commissioner verification. See [OpenF1 documentation](https://openf1.org/docs/).
- Race-day OpenF1 datasets may be delayed or rate limited. The platform serializes requests around 2.1 seconds apart within a single API process; don't start multiple separate API instances with the same database without a shared throttle.
- Race cancellation, appeals, manual fallback, and financial transfers require responsible commissioner review and audit notes.
- Conflicting edge case: proportional payout caps can cause a lower rank to *receive more* than a prorated higher rank; the design's monotonicity guarantee and hard prorating cap cannot both hold in every case. This implementation enforces contribution caps and cash solvency over absolute payout monotonicity. If every eligible recipient is prorated, some funds may remain undistributed and are clearly reported, rather than exceeding the caps.

Unofficial educational fan project, not affiliated with Formula 1, FIA, or FOM.
