# GRIDLOCK — F1 Prediction Pool

A multi-tournament Formula 1 prediction platform based on the finalized [GRIDLOCK v2.0 master specification](docs/specs/GRIDLOCK-master-v2.0.pdf) and [payout/rake delta](docs/specs/GRIDLOCK-finance-delta-v2.0.pdf). See the [finance implementation guide](docs/FINANCIAL_RULES_V2.md) for formulae, reconciliation, and source-table discrepancies. Participants can **create a public or invite-only tournament, invite users by username or joining link, browse public competitions, and enter that tournament's own prediction workspace**. Parallel pools can share players without sharing their picks, scores, roles or financial ledgers.

This is an unofficial F1 fan project. It **does not accept card payments, process transfers, or hold funds**; commissioners manually record transactions settled elsewhere.

## Separated frontend and backend

```text
f1-prediction-pool/
├── frontend/                  # Standalone React/TypeScript client
│   ├── src/pages/             # Catalogue, Lobby, TournamentWorkspace, Picks, Rules, Admin...
│   ├── src/components/        # Typed, reusable invitations, management and notification UI
│   ├── src/shared/            # Reusable typed UI components
│   ├── src/*.test.ts          # Client API tests
│   ├── docker/nginx.conf      # Production static SPA + reverse proxy
│   ├── Dockerfile
│   └── package.json           # Independent install, build, lint, tests
├── backend/                   # Standalone Node.js 22 native HTTP API
│   ├── src/auth.ts            # Scrypt, HttpOnly sessions, rate limiting
│   ├── src/tournaments.ts     # Public/private catalogue, membership, operator and commissioner authorization
│   ├── src/email.ts           # Gmail/Brevo/Resend, encrypted outbox and deadline mail
│   ├── src/db.ts              # Durable SQLite WAL + legacy migration
│   ├── src/http.ts            # Request validation, CSRF, response hardening
│   ├── src/server.ts          # HTTP routing and race operations
│   ├── src/rules.ts           # Full official scoring and payout engine
│   ├── src/openf1.ts          # Provisional race-data import
│   ├── src/backups.ts         # Encrypted snapshot machinery
│   ├── src/*.test.ts          # Per-module + end-to-end API tests
│   ├── Dockerfile
│   └── package.json
├── docs/                      # API, security audit, operations and specification
├── scripts/                   # Offline restore utility
├── docker-compose.yml        # Two independent service containers
└── package.json              # Convenience scripts; NOT an npm workspace
```

There are **no cross-package runtime dependencies**. Each app has its own package manifest and can be developed, tested and deployed independently. `backend/src/rules.ts` is part of the backend rather than a shared workspace package.

## Port configuration

| Process | Default port | Explanation |
| --- | ---: | --- |
| Existing live F1 dashboard | **8080** | Leave the existing application unchanged |
| Gridlock frontend (development) | **5173** | Vite proxies `/api` to port 3001 |
| Gridlock frontend (production container) | **8080** internally | Set `FRONTEND_PORT` to choose a host port |
| Gridlock backend API | **3001** | Not directly exposed by Compose |
| Gridlock frontend when both apps run in production | **8081** on the host | Avoids collision with the live dashboard on 8080 |

**You cannot bind two services to the same host IP and port simultaneously.** In production, either use separate host ports (existing dashboard 8080 / Gridlock 8081), or publish two distinct hostnames from a reverse proxy/Cloudflare Tunnel. With the existing dashboard running, use Gridlock development on port 5173. Frontend `vite preview` uses 8080 and therefore also conflicts on the same interface unless moved.

## Local development

Requires Node.js **22.16+**, npm, and internet access to install React/Vite and test dependencies.

**macOS Node version mismatch:** If the backend reports `bad option: --experimental-strip-types` / `bad option: --watch`, or Vite reports missing `node:fs/promises` exports, your shell is running an outdated Node binary. The project pins **22.16.0** in `.nvmrc` and `.node-version` to match CI. From the repository root:

```bash
node -v && which node
nvm install     # reads .nvmrc; install nvm first if this command is unavailable
nvm use
npm run check:node
npm install --prefix backend
npm install --prefix frontend
npm run dev:backend      # terminal 1
npm run dev:frontend     # terminal 2
```

Run `nvm use` in each new terminal (or configure nvm's default version). A second Node installation installed via Homebrew or a system package manager can take priority in `PATH`; use `which -a node` and reopen your terminal if you still see an older version. The new `predev` checks reject incompatible Node versions with actionable instructions before the applications start.

```bash
cp .env.example .env
# Leave PUBLIC_ORIGIN empty for local Vite development.
# Set a random ADMIN_BOOTSTRAP_KEY only if an operator account is needed.
# Configure a real backup key before production deployment.

npm install --prefix frontend
npm install --prefix backend

# Terminal 1: standalone backend API (port 3001)
set -a; . ./.env; set +a
npm run dev --prefix backend

# Terminal 2: standalone Vite frontend (port 5173)
npm run dev --prefix frontend
```

**Local login reports `Cross-origin request blocked` (HTTP 403)?** Pull the latest code and restart both development servers. The backend `npm run dev` script sets `NODE_ENV=development` and accepts only the Vite loopback origins at `http://localhost:5173` and `http://127.0.0.1:5173` when the API proxy forwards requests to port 3001. This narrowly scoped exception is **disabled in production**; do not disable CSRF validation or enable wildcard CORS. For normal local use, keep `PUBLIC_ORIGIN=` empty in `.env`; configure the exact HTTPS origin for production. Browser-extension `background.js` errors are independent of HTTP 403 responses from the API.

Open `http://localhost:5173`, register an account (password at least 12 characters) and choose a unique username. Create a tournament and choose **public** (visible in the separate public catalogue) or **invite-only** (hidden). The creator becomes commissioner automatically. Share the one-time invitation URL, or invite an existing user by searching their username. **Public pools can also be joined through these invitations as well as directly from the catalogue. Private pools can be joined ONLY through invitations.** A recipient must explicitly accept a username invitation. Returning players can join multiple tournaments without creating a new account.

A secret link such as `https://gridlock.example/?invite=<token>` preserves its destination across registration/sign-in: existing signed-in users join and open the competition; guests see registration first, with an existing-account sign-in option, then join/open the specific tournament. Guests can also browse active public competitions, and after signing up are redirected to the chosen public pool.

Choose a tournament from the lobby to open its **Race HQ, predictions, round leaderboard, season standings, championship picks, rules, prize ledger and commissioner functions**. Each screen makes tournament-authorized API requests, even if someone forges a season ID or edits a URL manually.

Commissioners can edit their own tournament’s name, public/private visibility and archive state; invite existing usernames; create seasons; select the Adaptive 3-Tier or Poker payout engine; configure creator rake only when permitted by the operator; set ITM, floor and steepness before Round 1; set locks/payout cutoffs; configure rosters/calendars; stage OpenF1 results; preview/publish scores; and record settled financial ledger entries. **The global operator (`users.role=admin`) can see and administer every tournament, regardless of membership, and can also perform database-wide maintenance.** Normal users see only tournaments they own or joined. All financial operations retain their audit trail and ledger invariants.

## Production deployment

```bash
cp .env.example .env
# Generate secrets; enter the same values in .env:
openssl rand -hex 32   # BACKUP_ENCRYPTION_KEY (mandatory in production)
openssl rand -hex 32   # ADMIN_BOOTSTRAP_KEY if using a global operator
# Edit FRONTEND_PORT=8081 when the F1 live dashboard uses 8080.
# Set PUBLIC_ORIGIN=https://your-gridlock-hostname.example for HTTPS deployment.
mkdir -p data backups
sudo chown -R 1000:1000 data backups

docker compose up -d --build
```

The frontend listens on `127.0.0.1:${FRONTEND_PORT:-8080}` (default 8080; `.env.example` sets **8081** to avoid conflicting with the live dashboard). Nginx sends `/api/*` to the private `backend:3001` container. Protect the public hostname with **HTTPS / Cloudflare Tunnel**; do not directly expose the backend API. In production, cookies have `Secure; HttpOnly; SameSite=Strict`, and the backend requires an encrypted backup key.

The SQLite files (`pool.sqlite`, `-wal`, `-shm`) live in the mounted `./data` directory; snapshots are saved in `./backups`. Shutdown and published races trigger SQLite-consistent encrypted snapshots. Optional offsite transfer requires an installed and configured rclone destination; this image does **not** bundle rclone.

Read [operations and recovery](docs/OPERATIONS.md) before migrating an existing pool or going live.

## Multi-tournament design

- Users are registered once with a unique, case-insensitive username. Their individual memberships/commissioner privileges are **per tournament**. The global operator is explicitly exempt from membership restrictions, without silently adding a membership record.
- Each tournament can configure its own seasons, including the same calendar year as another tournament.
- Weekends, submissions, scoring, championship picks, entrant payments, payout projections and audits belong to an authorized tournament through its season.
- Private join links use cryptographically random invitation codes, stored only as hashes and invalidated on rotation. Existing-user invitations are pending until the invited account accepts. Public tournaments are in a separate active catalogue and allow both click-to-join and invitation joins. Invite-only tournaments can only be joined through a valid username or secret-link invitation.
- HTTP routes never trust the tournament selected in the browser: the API checks membership for the actual season/weekend being requested. Only the global operator can bypass tournament membership authorization; the operator still cannot override immutable submissions, official result publication freezes, or negative-cash ledger safeguards.
- A preexisting v1 database is migrated into a dedicated **Legacy F1 Pool** tournament. Existing users remain members and previous seasons, submissions and ledger records are retained. **Back up the DB before upgrading.**

## Global operator and official email

Set `ADMIN_EMAIL` to the intended operator's Gmail address (for example `operator@gmail.com`) and configure a long, random `ADMIN_BOOTSTRAP_KEY`. The configured email can register as a privileged operator only when presenting that secret. To promote an **already registered** operator Gmail account from a trusted server shell, use `scripts/promote-operator.mjs` with the exact bootstrap secret and a local database backup; never expose that CLI key in frontend code.

Email is **optional and disabled by default**. If enabled, the backend can send official transaction-like emails for verified/opted-in users: invitations, creation/join confirmations, submission receipts, post-lock no-submission and public-reveal alerts, results/current standings and final prize-share allocations. The queue is persistent, encrypted and replay-safe; send failures cannot change picks, deadlines, results or cash balances.

Configure `MAIL_PROVIDER=gmail` for the admin’s actual Gmail account using Gmail API OAuth2 credentials, or choose `brevo` or `resend` for their free transactional tiers (they normally require a verified sender/domain). Set `APP_PUBLIC_URL` and `MAIL_ENCRYPTION_KEY`/`BACKUP_ENCRYPTION_KEY`; do not commit OAuth tokens. Follow **[provider setup, free quotas and email operations](docs/EMAIL.md)**. Gmail personal accounts are subject to sending limits and Google OAuth/consent requirements; this is not an unlimited free bulk-mail service.

Operator mail-status and manual reconciliation are available from the lobby when signed into a global operator account. Session-lock notification messages are reconciled automatically on startup and periodically, including when the machine was powered off during the deadline; the server UTC lock itself never depends on this process.

## Rules

The signed-off v1.0 scoring mathematics remain unchanged: podium exact +10, midfield exact +5, off-by-one +3, off-by-two +1, additional podium presence +3, 85/96 possible weekly points, Sprint two-form/unified mode, season championship +25 bonuses, August salvage -15 change penalty, and adaptive payout tiers from 2 to 11+ paid participants. The rules are visible inside each tournament and use that tournament's selected season settings.

OpenF1 imports only **draft** classifications; a commissioner must verify FIA results, run a scoring preview and explicitly publish. The real-money ledger is bookkeeping only. Scheduled lock checks are evaluated on every request against server UTC timestamps, not background timers. Check [API details](docs/API.md) and the [original specification](docs/design-spec.pdf) for exact edge cases.

## Tests, lint and formatting

```bash
npm test                             # Both projects
npm run lint                         # ESLint, separate per project
npm run format                       # Prettier, separate per project
npm run format:check                 # Verify formatting
npm run build                        # Frontend TypeScript + production bundle
npm test --prefix backend            # Node test runner (pure rules + module tests + HTTP integration)
npm test --prefix frontend           # Vitest DOM/component tests
```

Named functions and components have `/** ... */` descriptions, and shared UI elements are extracted into reusable modules. The GitHub Actions workflow installs and tests the frontend/backend independently and validates the frontend build.

**Local validation:** The backend Node test suite is runnable without installing third-party packages, and currently passes locally. The frontend build and Vitest/ESLint runs require npm dependencies and must be checked via GitHub Actions or a normal development machine; they could not be executed in the isolated implementation environment.

## Security and limitations

Review [security audit and residual risks](docs/SECURITY.md) before adding real participants or recorded money. Principal protections include salted scrypt password hashes, 256-bit random persisted sessions, HttpOnly/SameSite cookies, same-origin CSRF checks, persisted abuse throttles, tournament authorization on every scope, atomic and idempotent ledger writes, excluded private ledger keys, and encrypted snapshots in production.

**Not yet a payment platform:** It does not collect, transmit, verify or distribute actual money. Commissioners must reconcile every external payment and comply with local law before using entry fees. Financial record correctness depends on trusted commissioners and source reconciliation.

## Version 2.0 finance and transparency

New seasons default to the original **Adaptive 3-Tier** payouts and **zero active house rake**. The operator may enable a default 5% hosting fee; if the global permission allows it, a commissioner may additionally set a creator fee. Combined active fees **must never exceed 15%** and remain frozen after Round 1 lock. Commissioners can instead choose **Casino Poker** with a selectable full-entry floor (ON) or a loss-reduction option (OFF), ITM 15–50%, and automatic or manual steepness. The catalogue, invitations, Rules page and Ledger disclose the live payout model and house fees. See [full v2 finance documentation](docs/FINANCIAL_RULES_V2.md) and the [two uploaded v2 source PDFs](docs/specs/).


## Version 2.1 — Mid-season tournaments and cross-pool fairness

The commissioner can configure a new tournament to start from a real F1 round after Round 1, using a future-only OpenF1 calendar preview, optional scaled WDC/WCC predictions and conditional August salvage. Short 1–2-race cups must be free; a zero-entry season records no real-money prizes or rake. Existing tournaments retain their scores and post-lock buy-ins independently of any new competition. Public tournaments support discovery and invitation, while private ones remain invitation-only. The operator controls public mid-season creation and active tournament ownership caps; OpenF1 data and outgoing email priority are shared across pools to protect free provider quotas.

**Read [full v2.1 implementation, setup, migration and security notes](docs/MIDSEASON_V2_1.md)** and the attached [v2.1 master specification](docs/specs/GRIDLOCK-master-v2.1.pdf) / [mid-season feature delta](docs/specs/GRIDLOCK-midseason-delta-v2.1.pdf). The original v2.0 documents remain preserved for history.
