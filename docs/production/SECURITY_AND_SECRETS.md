# Production Security & Secret Handling

## Published information classification

| Class | Examples | Repository policy |
| --- | --- | --- |
| Public architecture | VM shape family, service separation, generic ports, component paths, source-file names, branch names | May be documented |
| Host-sensitive | Actual reserved IPv4, VM hostname, OCI tenant/compartment identifiers, private bucket, concrete FQDNs if not intended public | Replace with `<VM_HOST>`, `<TENANCY>`, `<OCI_BUCKET>`, `<POOL_FQDN>`, `<DASH_FQDN>` |
| Personal | Operator email, individual account identifiers, SSH home path/personal workstation file names | Replace with `<OPERATOR_EMAIL>`, `<SSH_USER>`, `<KEY_FILE>` |
| Secret | SSH private keys, GitHub deploy keys, OCI customer secret, Gmail OAuth refresh/client secret, AES backup/mail keys, `.env` | **Never commit, paste or print.** Store only in approved secret manager/host private directory |
| Regulated/financial | Full SQLite DB, password hashes, session tokens, ledger PII, encrypted email bodies | Don't commit or share; encrypted backups in restricted object store only |

**The three original v2.3 PDFs are not mirrored to the public repository.** This Markdown documentation paraphrases/updates them with identifiers removed; do not add unredacted PDFs as examples. Masking means *replace*, not merely black text over recoverable underlying PDF content.

## Secret locations and blast radius

- `/etc/f1-env/f1-prediction-pool.env` and `/etc/f1-env/f1_telemetry.env`: owner-only host files (directory 0700, files 0600), linked as ignored `.env` in corresponding Git worktrees. This **is a proposed migration step** until confirmed on the VM.
- GitHub Actions Secrets: optional, SSH deployment identity and verified known-hosts only. The manual workflow **does not copy production `.env` into GitHub**, reducing duplicated secret storage.
- OCI Object Storage: private encrypted snapshot/secret-recovery objects. Restrict access using least privilege, customer key rotation, and retention; avoid logging API credentials.
- Google OAuth: `gmail.send` scope only, with refresh token accessible to backend process, never frontend browser or logs. Verify Google Auth Platform Audience In production and use the same sender account.
- `BACKUP_ENCRYPTION_KEY` and `MAIL_ENCRYPTION_KEY`: distinct high-entropy AES keys preferred, 64 hex characters. Keep old snapshot keys recoverable when rotating; encrypted queued mail needs migration or deliberate requeue before changing its encryption key.

## Public ingress hardening

Caddy terminates public TLS; only ports 80/443 (and optional 443/UDP) should be exposed to the internet. Port 8081 (pool), 8080 (telemetry) must bind only `127.0.0.1`; Node backend 3001 remains accessible solely from the internal Docker network. In OCI Security Lists, firewall opening and host `iptables` ordering must both be correct. Restrict SSH by source IP/security policy; don't put SSH on unrestricted ingress merely to simplify CI.

**Caution:** `TRUST_PROXY=1` and forwarded headers assume only controlled proxy hops reach the backend; never publish port 3001 externally. `PUBLIC_ORIGIN` must exactly match public `https://<POOL_FQDN>` for browser CSRF protection. Do not add wildcard CORS to debug login.

## Account and finance controls

- Sessions are HttpOnly/SameSite Strict, Secure on production HTTPS, with server-side revocation; backend uses scrypt password hashes and persisted auth throttles.
- A global operator can administer all tournaments; tournament commissioners only theirs, players only joined/created pools and the public catalogue. All sensitive authorization is backend-enforced.
- Financial ledger writes require authorization and idempotency, and payouts must respect collected funds/rake caps. The platform does **not** transfer money; no manual SQL ledger repair without explicit audit and reconciliation.
- Server UTC timestamps enforce blind picks and deadlines. Email outages do not change locks. Manual outage fallback requires timestamped pre-lock evidence.

## Safe debug capture

Use `docker compose logs --tail N <service>` only in your protected terminal. Before attaching to tickets, remove any tokens, query parameters containing invite/verify codes, user emails, authentication headers/cookies, password hashes, backup paths with sensitive names, and identifiers. Avoid `printenv`, `cat .env`, `set -x`, `docker inspect` environment sections, `rclone config show` or full SQLite dumps in shared logs.

## Credential exposure response

1. Stop publishing the affected screenshot/log; assume the credential is compromised.
2. Identify provider/permissions, rotate at source (OCI user customer key, Google OAuth credential, GitHub SSH deploy key or AES data key).
3. Update private host environment/config and reload the affected service only after verification.
4. Confirm access is restored and old credential revoked; test backup restore implications where an encryption key changed.
5. Record incident summary in GitHub **without secret values**, plus a private evidence pointer if required.

## Authentication of the SSH server

Do not use `StrictHostKeyChecking=no`. Capture the VM's SSH host-key fingerprint over an independent authenticated channel, review it in a protected inventory, then populate `PROD_SSH_KNOWN_HOSTS` repository secret with the verified host key. A raw automated `ssh-keyscan` during the job, without comparing fingerprints, is not sufficient.

## `f1_telemetry` boundaries

GRIDLOCK's release workflow never executes telemetry deployment or edits its environment. Telemetry has its own application-specific token/provider policies and its own pinned feature branch; inspect and separately approve any telemetry config changes.
