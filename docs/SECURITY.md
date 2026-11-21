# Security audit — GRIDLOCK multi-tournament architecture

Date: 21 November 2026. Scope: source-level review of the browser, API, SQLite, OpenF1 integration, backup mechanism and ledger. This is **not a penetration test or independent third-party audit**, and production security still depends on TLS, host configuration, code review, backup recoverability and commissioner conduct.

## Addressed findings

| Risk | Severity before changes | Implemented control | Verification |
| --- | --- | --- | --- |
| Shared global seasons/roles expose other pools | Critical | Tournament membership tables and scoped authorization on every season, weekend, pick, leaderboard, ledger and commissioner route. Global operator cannot access unjoined tournaments. | `tournaments.test.ts`, cross-tournament HTTP assertions in `server.test.ts` |
| Browser session exposed through `sessionStorage` | High | 256-bit random server-side sessions with SHA-256 token digest in DB. Browser receives HttpOnly/SameSite Strict cookie, Secure under NODE_ENV=production. Registration/login JSON do not reveal the token. | `auth.test.ts`, `http.test.ts` |
| CSRF with cookie-based sessions | High | JSON content-type requirement, strict request-Origin enforcement for browser writes, `Sec-Fetch-Site` screening and no wildcard CORS. CLI Bearer requests are the only originless write exception. | `http.test.ts`, API integration |
| Unbounded password guessing | High | Persisted IP/account-keyed login failure counters with 429 lockout, memory-hard salted `scryptSync` hash, 12-character password minimum and session invalidation on logout. | `auth.test.ts` |
| Finance and identity metadata leaked between groups | High | Member-only ledger reads, commissioner-only mutations, per-tournament audit filter, hidden internal idempotency keys and recording actor IDs in participant ledger views. | Cross-tournament HTTP and ledger assertions |
| Payout overdraw, duplicate event creation | High | SQLite IMMEDIATE transactions, idempotency keys, cash nonnegative check, refund bounded by net paid-in balance; payouts require a paying tournament member. | `server.test.ts`, `db.test.ts`, `backups.test.ts` |
| Unencrypted sensitive DB snapshots | High | Production backup generation refuses missing/invalid AES-256-GCM key; online SQLite snapshots include WAL writes and are restored by an authenticated decryptor. | `backups.test.ts` (AES-GCM decrypt/restore check) and restore runbook |
| Unreviewed external classification changes scoring | High | OpenF1 results are provisional drafts, manual verification required, result preview digest required before publish, published snapshots immutable. | `openf1.test.ts`, `server.test.ts` |
| Lack of secure browser response headers | Medium | Restrictive SPA CSP with no third-party fonts, frame-ancestor restrictions, nosniff and no-referrer. API sends restrictive frame and permission policy. | `http.test.ts`; inspect nginx configuration |
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
11. **Password recovery/MFA:** Password reset, email verification, MFA, account lockout notifications, refresh/session management and administrative user removal are not implemented yet. A security-conscious public deployment should implement these before wider use.

## Recommended future controls

- Email verification and secure account recovery with expiring hashed reset tokens.
- Optional MFA for tournament commissioners and platform operators.
- Centralized event/log monitoring, anomaly alerts for login and ledger edits, and automated dependency scanning.
- Independent security review, authenticated UI acceptance tests and controlled load testing before public launch.

**Conclusion:** The core multi-tenant isolation and the highest-risk browser/session and ledger access issues identified in the initial code have been addressed and covered by tests. The platform is still a prototype, not a certified or independently audited financial system.
