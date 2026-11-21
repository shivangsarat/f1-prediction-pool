# GRIDLOCK v2.1 — Mid-season tournaments and cross-pool balancing

Implementation reference: the two uploaded **v2.1 specifications** in `docs/specs/`. Applies on top of the v2.0 finance/payout rules. Do not apply a mid-season launch to an existing tournament's historical season; create a separate tournament and season instead.

## Creation and discovery

- A creator may select **Full Season** (starts real F1 Round 1) or **Mid-Season**, with a real F1 `openingRound`, calendar `year`, and `expectedRaces`. The frontend can request `GET /api/calendar/remaining?year=...`; the backend serves a globally cached, future-only OpenF1 preview. If OpenF1 is down, the commissioner must set the opening round and expected race count manually, and can import/enter future dates later.
- New pools have independent tournament IDs, member lists, season rules, scores, champion picks, and ledger rows. New entrants do **not** transfer their buy-ins or predictions out of a previously locked tournament.
- Public pools can be joined from the catalogue **and** through invitations. Private pools are only joinable by invitation. The public catalogue offers all/full/mid filters and displays `Mid-Season · Starts R# · N Races` disclosures. An unconfigured season shows **terms pending**.
- `allowPublicMidseason` is an operator-only switch. When disabled, new public mid-season creation is denied; new invite-only friend pools may still be created. Existing public tournaments are grandfathered. `maxActiveOwnedPools` defaults to 3 per non-operator and counts active pools only; archived pools do not count. Global operators bypass this ownership limit.

## Opening qualifying lock

- Mid-season records retain **real F1 round numbers** instead of remapping the starting round to 1. `MIN(round)` from the tournament's own scheduled weekends determines its actual opening UTC lock, using Sprint Qualifying for Sprint weekends and standard Qualifying otherwise.
- Sprint mode, entry fee, payout engine, two-layer rake, Poker ITM/floor/steepness, championship enablement and August salvage settings freeze at this opening lock. Timestamp comparisons are evaluated on every request, independent of cron or machine availability.
- The mid-season calendar import excludes `round < openingRound` and sessions whose earliest qualifying lock is **not later than the tournament creation timestamp**. Both `upcomingOnly:true` and `startFromRound` are supported; on mid-season pools the future-only filter is mandatory. Commissioners may manually add upcoming weekends; neither route can insert a finished real-world race into a new mid-season season.
- Paid mid-season buy-ins require a complete persisted upcoming calendar: at least three rounds, `MIN(round) === openingRound`, and a race count matching the announced expected count. A different scope must be explicitly corrected before launch; a commissioner cannot retroactively modify a locked tournament.

## Championship and salvage options

| Launch | Races remaining | WDC/WCC | August salvage |
| --- | ---: | --- | --- |
| Full Season, starts R1 | typically 20–24 | On by default, +25 per correct winner | On by default, −15 per changed category |
| Mid-season, starts before August | 10–19 | Off by default; optionally scaled per category | Optional when championship predictions are enabled AND at least four scheduled rounds finish before August |
| Late mini-cup | 3–9 | Off by default (pure race-by-race) | Off; summer window passed |
| Final 1–2 races | 1–2 | Off | Off; **zero entry fee only** |

For eligible mid-season pools with `R` scheduled rounds, calculate `bonus = round(25 × R / 24)` and `salvagePenalty = round(15 × R / 24)` using integer point arithmetic. Example: `R = 12` gives **+13 points** per correct WDC/WCC choice and **−8 points** per changed category after the salvage window. Changing the WDC/WCC choice is still governed by the same immutable pick-history rules. Disabled championship pools cannot submit WDC/WCC selections; disabled salvage pools have no August editing period. In disabled-championship mode, commissioners publish final tournament standings without naming WDC/WCC winners once the last scheduled race classification is published.

## Distribution and finance invariants

- Mid-season tournaments use the **same** season-selected Adaptive 3-Tier or Casino Poker payout engine as full-season pools, with the same exact-cent Hamilton reconciliation, 15% combined rake cap, and proration rules.
- `Gross Pot = buyins + refunds + adjustments` from **only that season**. Previous payouts do not reduce the gross-pot baseline. There is no shared wallet or balance transfer between pools.
- Once the opening qualifying deadline passes, refunds and negative ledger adjustments are rejected, even if no distributions have yet been made. A new tournament never triggers a refund of the original pool's locked buy-ins.
- For 1–2 remaining races, `baseEntryCents = 0` is supported as a free/fun tournament: no buy-ins, financial adjustments, rake, or payouts may be recorded. Payout projection is a transparent all-zero ledger.
- Poker auto-steepness uses the existing `scheduledRaces` modifier, which applies the flatter `R ≤ 8` curve automatically to mid-season mini-cups.

## Platform-level resource protection

- `openf1_cache` in SQLite stores OpenF1 meetings, calendar sessions, rosters and session classifications by a canonical endpoint + year/meeting/session parameters, with bounded TTLs. Concurrent identical requests share a single upstream promise, and later requests reuse persisted data. Imported draft results **still require FIA/manual review**; cache entries are not official classifications.
- `email_outbox.priority` places locked-pick reminders, published results and final standings above invitation traffic. The encrypted outbox stays durable across restarts, is idempotent by event key, and is delivered only when a provider is configured. Prioritization does not guarantee immediate delivery on a free-mail tier or when the host is off.
- Global operator controls include the public-mid-season toggle and owned-pool limit. The global operator's authority does not bypass pick deadlines or financial deficit protection.

## API contract (v2.1 additions)

- `POST /api/tournaments`: optional `openingRound`, `expectedRaces`, `year` launch metadata.
- `GET /api/catalogue?q=...&scope=all|full|mid`: public-only scoped discovery.
- `GET /api/calendar/remaining?year=YYYY`: authenticated, rate-limited, cached future-round preview.
- `POST /api/admin/seasons`: optional `openingRound`, `expectedRaces`, `championshipEnabled`, `salvageEnabled`; nullable `preseasonLock`, `salvageStart`, `salvageEnd` when disabled. Existing full-season payloads remain valid.
- `PATCH /api/admin/seasons/:id`: optional opening/financial/championship configuration **only before its own opening qualifying lock**.
- `GET /api/season-scope?seasonId=...`: membership-authorized scope metadata, scaled point amounts and actual imported rounds.
- `POST /api/admin/openf1/import-calendar`: accepts `upcomingOnly`, `startFromRound`, and real-world `events[].round`; past sessions are skipped for mid-season pools.
- `PATCH /api/operator/finance`: `allowPublicMidseason` and `maxActiveOwnedPools` in addition to previous operator financial controls.

## Migration and recovery

Run a consistent encrypted backup before upgrading. The idempotent v2.1 SQLite migration rebuilds only the season table's non-null August timestamp constraints and preserves all previous rows, IDs, foreign keys, scoring data and ledger history. Preexisting seasons default to `opening_round=1`, `championship_enabled=1`, and `salvage_enabled=1`; no historical payouts are recalculated. Operator policy adds a default-on public mid-season toggle and a default active-owned-pool cap of three. Mail outbox rows gain durable priority. Verify `PRAGMA foreign_key_check`, standings and ledger, then make another backup.

## Known boundaries

The application does not take custody of money or send payments. `expectedRaces` is a commissioner-announced configuration; actual events must be present and match before paid buy-ins. Calendar data and driver rosters sourced from OpenF1 may be provisional. The opening season lock freezes configuration; a commissioner should inspect the preview and verify every real-world date before accepting entries. Legal/regulatory requirements for paid prize pools vary by jurisdiction and must be checked independently.
