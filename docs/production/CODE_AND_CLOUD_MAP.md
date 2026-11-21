# Code & Cloud Navigation Map

## Repository map: GRIDLOCK (`f1-prediction-pool/main`)

| Need to find or debug | Source | Read next / tests |
| --- | --- | --- |
| HTTP routes and race/season workflow | [`backend/src/server.ts`](../../backend/src/server.ts) | [`docs/API.md`](../API.md), `backend/src/server.test.ts`, `backend/src/flows.test.ts` |
| Session hashing, password verification, login throttles | `backend/src/auth.ts` | `auth.test.ts`, `http.test.ts`, secure cookie settings |
| CSRF, request headers, JSON errors | `backend/src/http.ts` | `http.test.ts`, `PUBLIC_ORIGIN`, Caddy → Nginx headers |
| Member/commissioner/operator role restrictions | `backend/src/tournaments.ts` | `tournaments.test.ts`, `discovery.test.ts` |
| SQLite WAL schema, migrations, paths | `backend/src/db.ts` | `db.test.ts`, `./data/pool.sqlite` |
| F1 scoring and lock logic | `backend/src/rules.ts` / `backend/src/midseason.ts` | `rules.test.ts`, `midseason.test.ts` |
| Prize model, rake and ledger invariants | `backend/src/finance.ts`, `backend/src/financeStore.ts` | `finance*.test.ts`, `financial-api.test.ts` |
| OpenF1 session ingestion/cache | `backend/src/openf1.ts` | `openf1.test.ts`; official results still need review |
| Auto driver / constructor roster | `backend/src/rosterSync.ts` | `rosterSync.test.ts`, `frontend/src/components/RosterAvailability.tsx` |
| Gmail API and encrypted notification queue | `backend/src/email.ts` | `email.test.ts`, `docs/EMAIL.md` |
| Consistent encrypted snapshot creation | `backend/src/backups.ts` | `backups.test.ts`, `scripts/restore-backup.mjs` |
| Tournament lobby, catalogue, invitations | `frontend/src/pages/TournamentLobby.tsx`, `TournamentCatalogue.tsx`, `frontend/src/components/InvitationsPanel.tsx` | Matching `*.test.tsx` |
| Tournament workspace and navigation | `frontend/src/pages/TournamentWorkspace.tsx` | `frontend/src/App.tsx` |
| Race ballot editor / lock presentation | `frontend/src/pages/PicksPage.tsx`, `PredictionEditor.tsx` | API `/api/weekends/*/picks` |
| Commissioner season/race/scoring UI | `frontend/src/pages/AdminPage.tsx` | Backend commissioner routes, `docs/MIDSEASON_V2_1.md` |
| Prize disclosures and operator finance | `frontend/src/components/FinancialTerms.tsx`, `OperatorFinancePanel.tsx` | `docs/FINANCIAL_RULES_V2.md` |
| Nginx SPA and `/api` routing | `frontend/docker/nginx.conf` | Browser Network tab, Caddy host routing |
| Docker runtime topology | [`docker-compose.yml`](../../docker-compose.yml), `backend/Dockerfile`, `frontend/Dockerfile` | Container `docker compose config` |
| Build/test checks | `.github/workflows/ci.yml`, package scripts | GitHub Actions job logs |

**Important current limitation:** `Save Draft` + auto-finalization-at-lock remains a separately requested feature; do not claim it exists until implemented/tested. The current confirmed repository supports repeated pre-lock submitted revisions.

## Separate telemetry repository (`f1_telemetry/weekend-tyre-sets`)

| Area | Verified path in telemetry repository |
| --- | --- |
| API, static frontend and WebSocket server | `backend/src/server.ts` |
| Shared real-time broadcast synchronization | `backend/src/websocket/BroadcastSyncHub.ts` |
| Free telemetry provider | `backend/src/providers/FreeFastF1Provider.ts` |
| Paid provider integration | `backend/src/providers/OpenF1PaidProvider.ts` |
| Tyre allocation logic | `backend/src/calculations/weekendTyres.ts` |
| Tyre panel | `frontend/src/Components/WeekendTyres.tsx` |
| Broadcast controls | `frontend/src/Components/BroadcastSyncControl.tsx` |
| Build/deploy | root `Dockerfile`, root `docker-compose.yml` |

The telemetry code is in a **different repository** and is not modified by these GRIDLOCK documentation updates.

## Cloud → component map

| Layer | Where to navigate / inspect | Fault signatures |
| --- | --- | --- |
| OCI instance | OCI Console → Compute → Instances → selected ARM VM (authorized region) | VM stopped, OCPU/memory/disk issues |
| Public routing | VCN → subnet → security list; host `sudo iptables -L INPUT -n --line-numbers` | Connection timeouts, TLS challenge failing |
| DNS | DuckDNS hostname A records | Wrong public address, NXDOMAIN |
| TLS and reverse proxy | `/etc/caddy/Caddyfile`; `systemctl status caddy`; `journalctl -u caddy` | ACME errors, 502, bad upstream routing |
| Docker stacks | `/opt/f1/f1-prediction-pool`, `/opt/f1/f1_telemetry` | Container restarting, wrong branch or image |
| Application secrets | `/etc/f1-env/` restricted files; per-repo `.env` symlink | Missing OAuth key, invalid AES key, wrong origin |
| Durable state | Pool repo `data/`, `backups/` bind mounts (UID 1000) | SQLITE_CANTOPEN, EACCES, no backup |
| Remote backup | OCI Storage → private bucket; `rclone` root cron with private config | Stale/missing snapshots or permission denied |
| Email | Google Cloud → APIs & Services, Google Auth Platform; GRIDLOCK operator mail panel | 400/401 token, 403 API disabled/scope, queue growing |
| CI & deploy | GitHub → Actions, Environments, Secrets and variables | Failed tests, bad SSH fingerprint, unreviewed deployment |

## How to trace a production request

1. In browser DevTools → Network, identify failing `/api/...` endpoint, response status, and UTC timestamp. **Redact auth cookies and response PII.**
2. Look up the endpoint in [`docs/API.md`](../API.md); search `backend/src/server.ts` for the route and the function called.
3. If **401/403**, inspect `auth.ts` / `http.ts`; if **404** for a tenant-scoped record, check whether intentional concealment of another tournament applies.
4. If **409**, check qualifying lock, published results, immutable season settings, or idempotency/ledger business guards before treating it as infrastructure failure.
5. If **5xx**, view backend container logs, SQLite directory access, OpenF1 upstream failures, and error timestamps. Do not patch the database directly.
6. Check the corresponding frontend component and API client (`frontend/src/api.ts`) only after identifying whether backend rejected the request or browser could not send it.
