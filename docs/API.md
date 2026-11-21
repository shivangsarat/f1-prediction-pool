# Gridlock HTTP API (v2) — tournament-scoped

All API responses are JSON. Browser sessions are conveyed using a `f1pool_session` **HttpOnly, SameSite Strict cookie**. In production the cookie is also `Secure`; JavaScript never reads the session secret. Use `credentials:'same-origin'`. JSON writes require `Content-Type: application/json` and the browser's same-origin `Origin` header; server rejects foreign origins. CLI clients can use separately authorized Bearer tokens, although normal login/register responses do **not** disclose tokens to JavaScript.

Unauthorized tournament/season/weekend lookups return **404**, not the existence or details of another pool. Commissioner actions require the calling user's membership role of `commissioner` **in that tournament**. The global operator role does not override membership.

## Authentication

| Method | Endpoint | Body / return |
| --- | --- | --- |
| POST | `/api/auth/register` | `{email,name,password,bootstrapKey?}` → `{user,expiresAt}` + Set-Cookie |
| POST | `/api/auth/login` | `{email,password}` → `{user,expiresAt}` + Set-Cookie |
| GET | `/api/auth/me` | Safe user metadata (no password hash) |
| POST | `/api/auth/logout` | Revokes token in SQLite; clears cookie |
| GET | `/api/health` | Basic readiness and UTC time |

## Tournament lobby and membership

| Method | Endpoint | Body / return |
| --- | --- | --- |
| GET | `/api/tournaments` | Only tournaments the user joined; includes their local role |
| POST | `/api/tournaments` | `{name,description?}` → new tournament and **one-time** `inviteCode` |
| POST | `/api/tournaments/join` | `{inviteCode}` → membership (idempotent) |
| GET | `/api/tournaments/:id` | Scoped tournament details |
| GET | `/api/tournaments/:id/members` | Member names, IDs, local roles |
| POST | `/api/tournaments/:id/rotate-invite` | Commissioner only; returns new code; invalidates previous code |

## Tournament-specific seasons and prediction reads

| Method | Endpoint | Notes |
| --- | --- | --- |
| GET | `/api/seasons?tournamentId=T` | Requires membership in T; supports same season year in other tournaments |
| GET | `/api/seasons/:id` | Season-specific configuration and published champions |
| GET | `/api/weekends?seasonId=S` | Ordered round calendar; requires membership in season S |
| GET | `/api/weekends/:id` | Own current submissions, published result and points |
| GET | `/api/weekends/:id/leaderboard` | Published weekly scores, scoped to member roster |
| GET | `/api/weekends/:id/picks` | Own picks; other players only after their respective form lock |
| PUT | `/api/weekends/:id/picks/{gp,sprint,unified}` | Append-only pre-lock revision; server UTC lock |
| GET | `/api/roster?seasonId=S` | Driver / constructor IDs registered for season S |
| GET | `/api/standings?seasonId=S` | Season standings, member-only |
| GET | `/api/ledger?seasonId=S` | Cash, projected payouts, sanitized shared ledger |
| GET | `/api/championship-picks?seasonId=S` | Pre-lock blind predictions |
| PUT | `/api/championship-picks` | `{seasonId,category:'wdc'|'wcc',choice}` |

## Commissioner operations (tournament-local)

| Method | Endpoint | Body / notes |
| --- | --- | --- |
| POST | `/api/admin/seasons` | `{tournamentId,year,name,sprintMode,currency,baseEntryCents,smallMax?,mediumMax?,preseasonLock,salvageStart,salvageEnd}` |
| PATCH | `/api/admin/seasons/:id` | Change unlocked season rule settings |
| POST | `/api/admin/roster` | `{seasonId,drivers:[{id,name,code,teamId,teamName}]}` |
| POST | `/api/admin/openf1/import-roster` | `{seasonId,sessionKey}` |
| POST | `/api/admin/openf1/calendar` | `{tournamentId,year}` → preview only |
| POST | `/api/admin/openf1/import-calendar` | `{seasonId,events:[...]}` |
| POST | `/api/admin/weekends` | `{seasonId,round,name,isSprint,qualifyingAt,sprintQualifyingAt?,raceAt,...}` |
| PATCH | `/api/admin/weekends/:id/schedule` | Future dates only |
| GET | `/api/admin/weekends/:id/result` | Current draft |
| POST | `/api/admin/weekends/:id/sync` | OpenF1 provisional draft (never auto-publish) |
| PUT | `/api/admin/weekends/:id/result` | `{result,finalClassification:boolean,source?,note?}` |
| POST | `/api/admin/weekends/:id/preview` | Mandatory dry-run digest |
| POST | `/api/admin/weekends/:id/publish` | Publish immutable score snapshots after verified preview |
| POST | `/api/admin/weekends/:id/fallback` | `{userId,form,pick,evidenceTimestamp,evidenceNote}` |
| POST | `/api/admin/champions` | `{seasonId,wdc,wcc}` at season end |
| POST | `/api/admin/ledger` | `{seasonId,userId?,type,amountCents,description,idempotencyKey}` |
| GET | `/api/admin/audit?tournamentId=T` | Commissioner-scoped audit log; optional `entityId` |
| POST | `/api/admin/backup` | **Global operator only**, encrypted full-database snapshot |

`GET /api/ledger` omits internal idempotency keys and audit actor identifiers. Only authorized tournament members may inspect public ledger entries, while only commissioners can mutate them. All amounts are integer cents, and financial mutations run in SQLite transactions. A refund cannot exceed a participant's paid-in balance; a payout identifies a tournament member; and no debit may make the pool cash-negative.

## Prediction and result examples

GP ballot:

```json
{"top10":["1","4","16","63","55","44","81","14","27","30"],"props":{"pole":"1","fastestLap":"4","firstDnf":"30"}}
```

Sprint two-form ballot:

```json
{"props":{"winner":"1","teamMostPoints":"red-bull-racing","mostGained":"44"}}
```

Verified race result:

```json
{
  "finishers": [{"driverId":"1","position":1,"status":"CLASSIFIED"},{"driverId":"30","position":null,"status":"NC"}],
  "poleId":"1","fastestLapId":"1","firstDnfIds":["30"],
  "greenFlagLaps":52,"cancelled":false,
  "sprint":null
}
```

A fully cancelled race or a classified race with fewer than two green-flag laps scores zero. Official NC/Retired first-DNF winners may be tied. `poleId` is the fastest Q3 qualifier, not the grid slot after penalties. The commissioner verifies source integrity before publishing.

## Security notes

Operator routes provide **no global visibility into tournament predictions or member ledgers**. `POST /api/admin/backup` is a deliberately separate whole-database maintenance capability. Session values remain inaccessible to browser JavaScript. See [source audit](SECURITY.md).
