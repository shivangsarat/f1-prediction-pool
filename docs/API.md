# HTTP API sketch

All mutating JSON endpoints require `Content-Type: application/json`. With the exception of register/login/health, all endpoints require `Authorization: Bearer <session token>`. Commissioner routes require an admin account.

## Authentication and season setup

- `POST /api/auth/register`: `{email,name,password,bootstrapKey?}`
- `POST /api/auth/login`: `{email,password}`
- `POST /api/auth/logout` / `GET /api/auth/me`
- `GET /api/seasons`, `GET /api/seasons/:id`
- `POST /api/admin/seasons`: `{year,name,sprintMode,currency,baseEntryCents,smallMax?,mediumMax?,preseasonLock,salvageStart,salvageEnd}`
- `PATCH /api/admin/seasons/:id`: `{sprintMode?,baseEntryCents?,smallMax?,mediumMax?}` (before Round 1 lock)
- `POST /api/admin/roster`: `{seasonId,drivers:[{id,name,code,teamId,teamName}]}`
- `POST /api/admin/openf1/import-roster`: `{seasonId,sessionKey}`
- `POST /api/admin/openf1/calendar`: `{year}` (preview only)
- `POST /api/admin/openf1/import-calendar`: `{seasonId,events:[...]}`
- `POST /api/admin/weekends`: `{seasonId,round,name,isSprint,qualifyingAt,sprintQualifyingAt?,raceAt,chequeredAt?,openf1Keys?}`
- `PATCH /api/admin/weekends/:id/schedule`: `{qualifyingAt?,sprintQualifyingAt?,raceAt?,note?}` (only before earliest lock)

All timestamps must be ISO 8601 with explicit `Z` or a timezone offset. Stored locks are UTC.

## Picks, leaderboards and payout data

- `GET /api/weekends?seasonId=...` (public race metadata for authenticated players)
- `GET /api/weekends/:id` (my submissions, published result, my points)
- `GET /api/weekends/:id/leaderboard` (published weekly points, deterministic season-wide tie-breakers)
- `GET /api/weekends/:id/picks` (my latest revisions always; others **only after each form's lock**)
- `PUT /api/weekends/:id/picks/{gp|sprint|unified}` (append-only revision strictly before lock)
- `GET /api/roster?seasonId=...`, `GET /api/standings?seasonId=...`, `GET /api/ledger?seasonId=...`
- `GET /api/championship-picks?seasonId=...`
- `PUT /api/championship-picks`: `{seasonId,category:'wdc'|'wcc',choice}`

Example GP ballot:

```json
{"top10":["1","4","16","63","55","44","81","14","27","30"],"props":{"pole":"1","fastestLap":"4","firstDnf":"30"}}
```

Two-form Sprint ballot: `{"props":{"winner":"1","teamMostPoints":"red-bull-racing","mostGained":"44"}}`. One-form mode combines GP ballot fields with `"sprint":{...sprint-props}`.

## Results and commissioner actions

- `GET /api/admin/weekends/:id/result` (draft)
- `POST /api/admin/weekends/:id/sync` (ingest OpenF1 draft, not publish)
- `PUT /api/admin/weekends/:id/result`: `{result,finalClassification:boolean,source:'manual'|'openf1'|'json-import',note?}`
- `POST /api/admin/weekends/:id/preview` (persists review fingerprint, no scoring mutation)
- `POST /api/admin/weekends/:id/publish` (atomic scoreboard snapshot and backup; requires preview and final-classification condition)
- `POST /api/admin/weekends/:id/fallback`: `{userId,form,pick,evidenceTimestamp,evidenceNote}` (historical pre-lock evidence, audited)
- `POST /api/admin/champions`: `{seasonId,wdc,wcc}` (once, after all scheduled races published)
- `POST /api/admin/ledger`: `{seasonId,userId?,type:'buyin'|'adjustment'|'refund'|'payout',amountCents,description,idempotencyKey}`
- `POST /api/admin/backup`, `GET /api/admin/audit`

Result schema:

```json
{
 "finishers":[{"driverId":"1","position":1,"status":"CLASSIFIED"},{"driverId":"30","position":null,"status":"NC"}],
 "poleId":"1",
 "fastestLapId":"1",
 "firstDnfIds":["30"],
 "greenFlagLaps":52,
 "cancelled":false,
 "sprint":{"winnerId":"1","topTeams":["mclaren"],"topGainers":["44","30"]}
}
```

`result.sprint` is required for Sprint weekends; leave it out for standard Grand Prix weekends. For a voided race, `cancelled:true` or `greenFlagLaps:<2` enforces zero scores. `firstDnfIds` accepts multiple official NC/Retired drivers for tied Lap-1 incidents. Classified finishing positions may extend beyond P10 (P11/P12 proximity scores). DNS / DSQ / NC and Retired drivers are excluded from proximity placements. Event source fidelity is the commissioner's responsibility.
