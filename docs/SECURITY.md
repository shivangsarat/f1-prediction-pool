# Security audit — GRIDLOCK multi-tournament architecture

Date: 21 November 2026. Scope: source-level review of the browser, API, SQLite, OpenF1 integration, backup mechanism and ledger. This is **not a penetration test or independent third-party audit**, and production security still depends on TLS, host configuration, code review, backup recoverability and commissioner conduct.

## Addressed findings

| Risk | Severity before changes | Implemented control | Verification |
| --- | --- | --- | --- |
| Shared global seasons/roles expose other pools | Critical | Tournament membership tables and scoped authorization on every season, weekend, pick, leaderboard, ledger and commissioner route. Only a global operator explicitly bypasses tournament membership, with full audit trails for settings changes; commissioners remain confined to their own tournaments. | `tournaments.test.ts`, cross-tournament HTTP assertions in `server.test.ts` |
| Browser session exposed through `sessionStorage` | High | 256-bit random server-side sessions with SHA-256 token digest in DB. Browser receives HttpOnly/SameSite Strict cookie, Secure under NODE_ENV=production. Registration/login JSON do not reveal the token. | `auth.test.ts`, `http.test.ts` |
| CSRF with cookie-based sessions | High | JSON content-type requirement, strict request-Origin enforcement for browser writes, `Sec-Fetch-Site` screening and no wildcard CORS. CLI Bearer requests are the only originless write exception. | `http.test.ts`, API integration |
| Unbounded password guessing | High | Persisted IP/account-keyed login failure counters with 429 lockout, memory-hard salted `scryptSync` hash, 12-character password minimum and session invalidation on logout. | `auth.test.ts` |
| Finance and identity metadata leaked between groups | High | Member-only ledger reads, commissioner-only mutations, per-tournament audit filter, hidden internal idempotency keys and recording actor IDs in participant ledger views. | Cross-tournament HTTP and ledger assertions |
| Payout overdraw, duplicate event creation | High | SQLite IMMEDIATE transactions, idempotency keys, cash nonnegative check, refund bounded by net paid-in balance; payouts require a paying tournament member. | `server.test.ts`, `db.test.ts`, `backups.test.ts` |
| Unencrypted sensitive DB snapshots | High | Production backup generation refuses missing/invalid AES-256-GCM key; online SQLite snapshots include WAL writes and are restored by an authenticated decryptor. | `backups.test.ts` (AES-GCM decrypt/restore check) and restore runbook |
| Unreviewed external classification changes scoring | High | OpenF1 results are provisional drafts, manual verification required, result preview digest required before publish, published snapshots immutable. | `openf1.test.ts`, `server.test.ts` |
| Lack of secure browser response headers | Medium | Restrictive SPA CSP with no third-party fonts, frame-ancestor restrictions, nosniff and no-referrer. API sends restrictive frame and permission policy. | `http.test.ts`; inspect nginx configuration |
| Unverified sender/address impersonation | High | Transactional notifications require verified email ownership and opt-in; user directory never exposes email; pending invitations require acceptance. One-time verification tokens are hashed and email payloads encrypted at rest. | `email.test.ts`, `discovery.test.ts` |
| Mail provider outages / duplicate notices | Medium | Persistent encrypted outbox, event-key deduplication, bounded retries and on-startup lock reconciliation; scoring never depends on email. | `email.test.ts`; provider-specific acceptance in staging |
| Public catalogue reveals private pools | High | Active public-only filter; invite-only pools omitted; private invitation previews require secret codes. | `discovery.test.ts` |
| Browser-only lock enforcement | Critical | All write operations compare persisted UTC lock on the server inside database transaction. | `rules.test.ts`, `server.test.ts` |

## Residual risks and deployment requirements

1. **TLS and origin:** Never expose plain HTTP beyond loopback. Configure Cloudflare Tunnel or an HTTPS reverse proxy, set `PUBLIC_ORIGIN` to the public HTTPS origin, restrict external ports, and configure HSTS at the TLS termination layer. The `Secure` cookie flag is enabled in production.
2. **Operator/commissioner compromise:** Tournament commissioners can create rules and ledger entries for their tournaments. The app cannot verify a real-world payment or prevent an authorized commissioner from deliberately entering a dishonest transaction. Use human reconciliation and periodic audit review.
3. **Ledger is not a payment processor:** No PCI card processing, payment proof, banking integration, automatic payouts or independent external receipt verification. Real-money use needs local legal/regulatory review and accounting controls.
4. **SQLite concurrency:** Use exactly one write API container per database. Multiple APIs sharing SQLite on a network filesystem are not supported. Multi-instance deployment would need PostgreSQL and a shared OpenF1 rate limiter.
5. **Backups:** Keep encryption keys outside backups and deploy encrypted offsite copies with rclone or a host-side job. The published Docker image does not contain rclone. Test a restore before collecting real participation money.
6. **OpenF1:** Source is independent of FIA; verify Pole Award, retirement classification, official results, Sprint grid ties and post-race correction window. Imports cannot substitute for FIA classification.
7. **Availability and abuse controls:** Rate limiting is per database-connected API process and the validated real-client IP received from the private nginx proxy (`TRUST_PROXY=1` only in Docker). Direct development connections ignore spoofable forwarded headers. Deploy additional WAF/reverse-proxy abuse limits, protect signups against bot floods and monitor login failures.
8. **Dependencies and CI:** Run `npm audit`, dependency updates, `npm run lint`, frontend Vitest tests and production build on every release. The frontend dependency install and build were not available in the isolated development environment; CI must be checked before deployment.
9. **Privacy/data retention:** Ledger descriptions are intentionally visible to tournament participants. Avoid recording personal financial details in transaction descriptions; set a policy for retention, account deletion and offsite copies.
10. **Operational secrets:** Never commit `.env`, encryption keys or raw database snapshots; use least privilege, file permissions and secrets management. Make sure the global operator email/bootstrap secret is changed from examples.
11. **Password recovery/MFA:** Email verification is implemented with one-time encrypted queued links, but password recovery, MFA, account lockout notifications, administrative user removal and self-service deletion are not implemented. Require MFA before publicly hosting a financially sensitive administrator account.

## Recommended future controls

- Secure password recovery using expiring hashed reset tokens and verified inboxes; phishing-resistant MFA for commissioner/operator accounts.
- Optional MFA for tournament commissioners and platform operators.
- Centralized event/log monitoring, anomaly alerts for login and ledger edits, and automated dependency scanning.
- Independent security review, authenticated UI acceptance tests and controlled load testing before public launch.

12. **Public catalogue and spam:** Enforce edge/WAF request limits and audit tournament creation/invitations. Usernames are discoverable by commissioners in limited prefix queries; do not include email in responses. Keep invitation links confidential and rotate when exposed.
13. **Email sending and compliance:** The backend is not an unrestricted bulk-mail sender. Provider quotas apply; verify DMARC/SPF for authorized sending domains, secure OAuth refresh tokens/API keys, monitor failed jobs, and obtain appropriate user consent and data-retention policies. Registration email ownership is only established after confirmation.
14. **Global operator privileges:** The operator can administer all tournaments and their ledgers and is a high-value target. Restrict `ADMIN_EMAIL`, guard bootstrap credentials, monitor audit events, and independently reconcile any ledger adjustment. Immutable results and no-overdraft policies remain in force.

**Conclusion:** The core multi-tenant isolation and the highest-risk browser/session and ledger access issues identified in the initial code have been addressed and covered by tests. The platform is still a prototype, not a certified or independently audited financial system.

## v2.0 financial authorization and abuse controls

- Only a global operator may change hosting rake, authorize creator rake globally or debit a `platform_rake` transaction. Tournament commissioners can change their own unlocked season finance settings only; `house_rake` disbursements are restricted to the actual tournament owner, including nonplaying owners.
- The backend caps combined effective operator + creator rates at 1,500 basis points and freezes their season snapshots at Round 1 lock; legacy seasons remain at zero rake. Individual house disbursements cannot exceed their gross-pot-derived entitlements. Player disbursements require final published championship results and cannot exceed individual earned shares. A ledger debit never overdrafts.
- User-supplied `tournamentId`, `seasonId` and username/invitation token never grant permissions by themselves. Public catalogue joining checks `visibility=public`; private joining is invitation-only, with time and nonce checks. Live financial terms are shown at acceptance to prevent misleading stale invite-email promises.
- Account identities, password hashes, OAuth refresh tokens, and raw invitation codes must never be included in public catalogue, invitation, or ledger responses. Store the SQLite database and backup-encryption key outside the Git repository; use HTTPS and protected outbound email credentials.
- This implementation is not a substitute for penetration testing, payment reconciliation, legal/regulatory review or an independent financial audit before using it with real-money stakes.


## v2.1 mid-season cross-pool controls

The active-pool ownership cap, operator public-mid-season creation toggle, real F1 round boundary, upcoming-only imports and strictly tournament-scoped financial ledgers are enforced on the backend, not merely hidden in React. A lock checks the earliest persisted qualifying session each time; post-lock refunds **and negative adjustments** cannot drain a pool to fund another competition. A zero-entry mini-cup cannot accept financial ledger writes. Cached OpenF1 responses remain draft inputs subject to mandatory manual review, and encrypted transactional notifications are ordered to prioritize deadlines/results over invitations. See [v2.1 security and migration notes](MIDSEASON_V2_1.md).
