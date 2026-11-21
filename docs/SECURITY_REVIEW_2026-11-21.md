# GRIDLOCK security review — 21 November 2026

**Scope:** source-level analysis of Node HTTP API and SQLite, browser UI, cookies, roles and tenant isolation, tournament invitations, financial ledger, OpenF1 imports, email, Docker Compose and deployment configuration. This is **not** an independent penetration test, cloud-account inspection, dependency CVE scan, or assurance about unreviewed deployed containers. Treat sensitive production keys and encrypted SQLite snapshots as secrets.

## Fixed in this release

| Finding | Risk | Mitigation | Verification |
| --- | --- | --- | --- |
| Operator bootstrap key compared with ordinary string equality; short key permitted | High: privileged registration brute-force and weak-key exposure | Require a 32+ character secret, compare fixed-length SHA-256 digests with `timingSafeEqual`, and throttle failed bootstrap attempts globally in addition to the existing IP-level registration limit | `security-regressions.test.ts`, existing registration integration tests |
| Unbounded sign-in credential length fed to synchronous scrypt | Medium–High: deliberate CPU/memory exhaustion on public login | Reject passwords above 256 chars and emails above 254 chars before KDF work, without account enumeration | `security-regressions.test.ts` |
| Production could launch without configured `PUBLIC_ORIGIN` | High: spoofable Host/Origin pair could weaken CSRF defense on a misconfigured proxy | Fail startup unless `PUBLIC_ORIGIN` is a proper HTTPS origin; when mail is enabled, require `APP_PUBLIC_URL` to match it | `production-config.test.ts`, origin/CSRF suite |
| `TRUST_PROXY=1` accepted any valid `X-Real-IP` string | Medium: if the backend port is accidentally exposed, clients could evade IP-based rate limits | Only trust forwarded IPs when connection originates from Docker/private or loopback IP; keep API unexposed and ensure nginx overwrites the header | `security-regressions.test.ts` |
| JSON parser accepted `application/json-malicious` as `application/json` | Low: content-type confusion | Enforce exact media type plus optional charset parameters | `security-regressions.test.ts` |
| Display names allowed CR/LF control characters | Medium: malformed notifications and logs | Reject control-character names at registration | `security-regressions.test.ts` |

Existing critical controls validated in prior suites: salted scrypt password hashes, HttpOnly/SameSite cookies, server-digest session storage, persistent auth throttling, strict CSRF origin checks, operator/commissioner/participant authorization, private invitations, per-tournament ledger records, append-only pick revisions, result review/digest checks, integer-cent payouts and anti-overdraw, AES-GCM encrypted backups and email outbox.

## Residual risks and release obligations

1. **Privileged operator email:** `ADMIN_EMAIL` and `ADMIN_BOOTSTRAP_KEY` are host-only secrets; use a strong random key (32+ characters) and rotate if exposed. Never place the key in the public frontend bundle or source repository. Bootstrap UI field is optional for ordinary users.
2. **Trusted proxy boundary:** Backend container must remain **private** (`expose: 3001` only), frontend should bind to `127.0.0.1:8081`, Caddy terminates TLS, and nginx must overwrite `X-Real-IP`; no wildcard CORS. A hostile process on the same Docker network remains in the trusted network zone.
3. **Financial/operational:** GRIDLOCK is **not a payment processor**. Commissioners manually reconcile settlement outside the app. Fee/ledger integrity tests are not equivalent to regulatory compliance or independent financial audit.
4. **Persistence and backups:** Test restoring an actual encrypted offsite snapshot; key loss makes AES-GCM data unrecoverable. Do not rotate `MAIL_ENCRYPTION_KEY` while encrypted mail awaits delivery. Backups must include SQLite WAL state via Node's online backup method.
5. **External services:** Gmail OAuth refresh tokens, OCI S3 customer secrets, SSH deploy keys and backup keys must remain out of Git and chat logs. Scope OAuth to `gmail.send` and rotate exposed credentials immediately. Free mail quotas can delay reminders; server UTC locks always prevail.
6. **Web/app dependencies:** Dependency review, SAST, infrastructure probing and independent penetration testing remain recommended before taking substantial real-money entries. React's escaping and CSP reduce XSS exposure but do not replace manual review of new dynamic HTML.
7. **CI deployment:** Review and manually authorize production changes. Production now deliberately refuses startup until a valid `PUBLIC_ORIGIN` is configured. Set it *before* deploying this release to avoid outage.

## Safe pre-deploy verification

```bash
npm run test --prefix backend
npm run lint --prefix backend
npm run test --prefix frontend
npm run lint --prefix frontend
npm run build --prefix frontend
# Confirm PUBLIC_ORIGIN=https://<your-approved-domain> and APP_PUBLIC_URL matches for email.
# Review Docker port binding and verify recovery keys exist in a password manager.
```

The release does **not** modify any production credentials, Caddy config or live VM. Keep the exact deployment target and secrets in host environment / GitHub encrypted secrets, never in this report.
