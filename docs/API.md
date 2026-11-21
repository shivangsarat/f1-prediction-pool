# Current v2.0 API contract (supersedes older examples below)

**Visibility:** Public tournaments may be joined from `/api/catalogue`, via `/api/tournaments/join-public`, or by an authenticated invitation link / accepted username invitation. Invite-only tournaments **never** appear in the catalogue and require a valid invitation. Public and private invite flows preserve the tournament destination through new-user registration.

**Financial routes:**

| Method | Endpoint | Authorization | Semantics |
| --- | --- | --- | --- |
| GET | `/api/finance-policy` | Signed-in users | Safe operator policy used for commissioner UI; no secrets |
| GET | `/api/operator/finance` | Global operator | Current platform rake permission/rate |
| PATCH | `/api/operator/finance` | Global operator | Update `platformRakeEnabled`, `platformRakeBps`, `allowTournamentHouseRake`; grandfather Round-1 locked seasons |
| GET | `/api/tournaments/:id/terms` | Authorized tournament member/operator | Live season payout, fee, floor and freeze disclosure |
| GET | `/api/catalogue` | Public | Public tournaments and live `terms` field |
| GET | `/api/invitations` | Invited user | Private pending invitations and live `terms` field |
| GET | `/api/invite-preview/:token` | Link holder | Limited tournament metadata and live `terms` |
| POST | `/api/admin/seasons` | Tournament commissioner/operator | Create with optional `payoutModel`, `houseRakeEnabled`, `houseRakeBps`, `pokerFloorEnabled`, `pokerItmPct`, `pokerAlphaMode`, `pokerAlphaManual` |
| PATCH | `/api/admin/seasons/:id` | Tournament commissioner/operator | Update financial settings until Round 1 lock |
| POST | `/api/admin/finance-preview` | Tournament commissioner/operator | `{seasonId,...financialFields}`: server-calculated cent-exact prize preview |
| GET | `/api/ledger?seasonId=...` | Tournament member/operator | Cash balance, contribution-derived gross/net/house entitlements and projected positions |
| POST | `/api/admin/ledger` | Commissioner/operator | May record `platform_rake` (global operator only), `house_rake` (creator beneficiary only), alongside historical types; entitlement and cash caps apply |

The season record includes `finance`, a server-resolved read-only view of effective financial settings, including Round-1 snapshots. `payouts` in Ledger includes `grossPotCents`, `platformRakeCents`, `creatorRakeCents`, `netPlayerPotCents`, `paidPlaces`, `slotsCents`, `alpha`, `payoutModel`, and individually capped `prizes`. All money is integer cents; `platformRakeBps + creatorRakeBps <= 1500` for active rates. Rake **never** reuses remaining cash after disbursement. Old v1 seasons migrate to adaptive/zero rake. Consult [v2 financial contract](FINANCIAL_RULES_V2.md).

---

# Gridlock HTTP API (v2) — tournament-scoped

All API responses are JSON. Browser sessions are conveyed using a `f1pool_session` **HttpOnly, SameSite Strict cookie**. In production the cookie is also `Secure`; JavaScript never reads the session secret. Use `credentials:'same-origin'`. JSON writes require `Content-Type: application/json` and the browser's same-origin `Origin` header; server rejects foreign origins. CLI clients can use separately authorized Bearer tokens, although normal login/register responses do **not** disclose tokens to JavaScript.

Unauthorized tournament/season/weekend lookups return **404**, not the existence or details of another pool. Commissioner actions require the calling user's membership role of `commissioner` **in that tournament**. The global operator role **does** override membership for audited global administration; ordinary users and tournament commissioners remain tenant-scoped.

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

Operator routes permit **global visibility and tournament-scoped administration across every tournament**. Nonoperators never bypass membership checks. `POST /api/admin/backup` is a deliberately separate whole-database maintenance capability. Session values remain inaccessible to browser JavaScript. See [source audit](SECURITY.md).

## Global operator, tournament catalogue and invitations (v0.3)

Authorization levels:

- **Global operator (`users.role='admin'`)**: sees every tournament in `GET /api/tournaments`, can enter any workspace and use all tournament commissioner endpoints, edit tournament visibility/status, inspect ledgers/audits, and execute database-wide backups. Existing ledger transactions and published results remain immutable; corrections must be auditable and obey financial/lock invariants.
- **Tournament commissioner (`tournament_members.role='commissioner'`)**: manages only pools they own/commission, including members, settings, season, payouts ledger, results, and invite tools.
- **Participant (`tournament_members.role='player'`)**: can view only member tournaments, submit their own eligible picks, and read that tournament's revealed picks, standings, and ledger projections. Cannot mutate management resources.
- **Guest**: only `GET /api/catalogue`, `GET /api/invite-preview/{token}`, mail availability, health, registration and login. No private pool information.

| Method | API path | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/api/catalogue?q=monaco` | Public | Active, public tournament metadata only (100 max); no private pools or invite secrets |
| GET | `/api/invite-preview/{token}` | Public | Validate an active secret invitation and return limited display metadata |
| GET | `/api/tournaments` | Signed in | My tournaments; **all** tournaments for global operator |
| POST | `/api/tournaments` | Signed in | `{name,description,visibility:'public'\|'invite_only'}`; creator becomes commissioner |
| PATCH | `/api/tournaments/{id}` | Commissioner/operator | Modify name, description, visibility and `status:'active'\|'archived'` |
| POST | `/api/tournaments/join-public` | Signed in | `{tournamentId}`; only active public pools |
| POST | `/api/tournaments/join` | Signed in | `{inviteCode}`; only active pools with a valid rotating secret |
| POST | `/api/tournaments/{id}/rotate-invite` | Commissioner/operator | Revoke old link and return a one-time 192-bit invitation token |
| GET | `/api/tournaments/{id}/users?q=username` | Commissioner/operator | Search up to 10 nonmembers by username, without emails |
| POST | `/api/tournaments/{id}/invite-user` | Commissioner/operator | `{userId}`; create a pending invitation rather than silently enrolling |
| GET | `/api/invitations` | Signed in | Pending invitations addressed only to caller |
| POST | `/api/invitations/{id}/respond` | Signed in recipient | `{action:'accept'\|'decline'}`; acceptance creates the membership |
| GET | `/api/auth/verify-email?token=...` | Public one-time token | Verify own inbox, invalidate all prior proof links |
| GET | `/api/email/capabilities` | Public | `{available:boolean}`, no credentials |
| POST | `/api/account/verification-email` | Signed in | Request a confirmation message (max 3/day) |
| PATCH | `/api/account/notifications` | Signed in | `{enabled:boolean}`; opt out of event mail |
| GET | `/api/admin/mail` | Operator only | Provider and aggregate queued/delivered counts |
| POST | `/api/admin/mail/sync` | Operator only | Reconcile missed session-lock notifications, try up to 10 deliveries |

### Invitation deep links and redirect behavior

- Private sharing URL: `https://gridlock.example/?invite=<secret>`. A signed-in user joins and opens the tournament immediately. A guest sees **registration first** and an obvious **sign-in alternative** for existing users. After successful authentication the pending link is validated server-side, joined and opened. Unknown accounts cannot be distinguished from existing ones solely from a link (account-enumeration prevention).
- Public catalogue joining: guests are redirected to sign-up with `?public=<tournamentId>` preserved; after authentication the server confirms visibility is still public/active before joining and opening that tournament.
- Official email links to existing members use `/?tournament=<id>` (not secret tokens). Membership is still authorized for each API call.
- Secret codes are SHA-256 hashed in the database, never returned on reads. Rotating a code invalidates all earlier URLs. Archived pools cannot accept new entrants via either mechanism.

### Notification behavior

Email is an **optional** provider-backed service. Delivery is disabled until configured; the game continues to operate normally. An account must verify its inbox and opt in before ordinary event email is queued. The encrypted SQLite outbox deduplicates by event, claims each job for one worker, retries failures with exponential backoff, and catches up session-lock events after downtime (14-day window). This is **not exactly-once delivery**: an outage between provider acceptance and recording success may cause duplicate emails.

Notifications include: email-verification link, tournament creation/welcome, explicit username invitation, entry confirmation, pick-submission receipt, post-lock receipt/no-submission plus a link to revealed picks, published result with own points/current rank plus standings link, and post-championship final rank plus computed prize allocation. No other players' email addresses or secret invitation codes appear in routine notification bodies.

Financial email amounts represent the ledger's **calculated allocation**, not proof that a payment has been made. No payment processor or payment initiation is integrated.
