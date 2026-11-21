# Tournament-scoped system architecture

```mermaid
flowchart LR
  Browser[React tournament lobby & workspace] --> Nginx[Nginx frontend :8080]
  Nginx --> API[Node API :3001]
  API --> Security[Session, CSRF, role checks]
  Security --> DB[(SQLite WAL persistent volume)]
  API --> Scoring[Scoring & payout engine]
  API --> OpenF1[OpenF1 draft importer]
  DB --> Backup[AES-256-GCM snapshots]
  Backup --> Offsite[Optional offsite rclone]
```

## Tenant boundaries

```text
user ──< tournament_members >── tournament
                                  │
                              seasons (year unique WITHIN tournament)
                                  │
                       ┌──────────┴─────────┐
                    weekends             championship picks
                       │
             ┌─────────┴─────────┐
        submissions           results & score snapshots

tournament season ───────── ledger (immutable cash entries)
```

All row queries using a season or weekend ID first verify tournament membership in the backend. Commissioner writes additionally require `tournament_members.role = 'commissioner'`. The shared standings and payout engines select only members of the relevant tournament. Data does not pass through a client-controlled `tournamentId` without server verification.

## Separate runtime ownership

The React app is an independently built and served static SPA with reusable page components. It never imports backend source. Node API owns its own scoring functions and durable database. For low-cost deployment, nginx and Node are independent processes/containers connected via internal network; the SQLite writer remains single-process.

A future managed PostgreSQL migration can preserve the API and frontend separation. A multi-instance backend would additionally require distributed OpenF1 rate limiting, coordinated backups and transaction retry handling.

## v2.0 finance boundaries and immutability

The operator-only `platform_finance` singleton and `seasons` financial columns are separate data owners. `financeStore.ts` snapshots operator and creator basis-point rates into the season when its first qualifying lock passes; changes to global policy never mutate historical rake. The pure `finance.ts` engine computes both rake shares and the active payout ladder from **net collected buy-ins**, not ledger cash on hand. `server.ts` enforces beneficiary identity, authorizations, idempotency, and payout ceilings; each ledger write is atomic.

Catalogue metadata and invitations use `tournamentTerms()` to compute the **current** financial contract; emails are only a historical notification and are never substituted for this server-derived join-time disclosure. Public pools accept catalogue and invitation entries; invite-only pools require a valid invitation token or accepted named-user invitation. See [v2 financial contract](FINANCIAL_RULES_V2.md).
