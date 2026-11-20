# Operational runbook

## Availability and offline windows

Never extend a qualifying deadline automatically because the hosting server was offline. Session lock is `nowUTC >= storedLockUTC`, evaluated in the API and in the UI. Admin can update the *future* timetable with an audit note (API `PATCH /api/admin/weekends/{id}/schedule`); edits to sessions whose first lock has occurred are rejected. If Cloudflare Tunnel is down, participants use a previously agreed group chat/email emergency channel, and the commissioner enters *timestamped pre-lock evidence* via **Race control → Pre-lock outage fallback**. The source and evidence note are logged and cannot be altered after scoring is published.

## Race-data integrity

OpenF1 `session_result`, `laps`, `drivers`, and `starting_grid` data may be provisional, delayed, or incomplete. Admin imports a **draft only**. Verify the race's official FIA final classification, fastest Q3 qualifier rather than Sunday grid P1, fastest eligible classified lap, first official NC/retired status excluding DNS, simultaneous Lap-1 retirements, at least 2 green-flag racing laps, pit-lane starts in Sprint delta, and Sprint team ties. The server refuses publication without a fresh Preview Scores fingerprint and an explicit final-classification marker (or a chequered flag time over 24h ago). It will not recalculate already-published rounds after an appeal.

`AUTO_SYNC_ON_STARTUP=true` (default in `.env.example`) attempts to stage missing OpenF1 draft race results for at most two recent rounds (races between 5 hours and 30 days ago) when the server starts. It never publishes results and never creates score or ledger duplicates. Calendar import skips existing round numbers.

## Durable SQLite storage

The Compose volume `./data:/app/data` holds the SQLite `-wal` and `-shm` files, outside any ephemeral container layer. Keep a single writer/API container for simplicity. Avoid copying only the `.sqlite` file while the server is running; use a consistent SQLite backup. A normal `docker compose stop` sends SIGTERM, triggers a backup, then checkpoints WAL.

## Encrypted backups

Use `openssl rand -hex 32` to generate `BACKUP_ENCRYPTION_KEY` and retain it separately from the backups. **Without it, backups remain unencrypted local `.sqlite` files**. When configured, snapshots are stored in `./backups/*.sqlite.gz.enc` with:

```text
F1BK\x01 (5 bytes) | AES-GCM IV (12 bytes) | GCM authentication tag (16 bytes) | ciphertext
```

Set `BACKUP_RCLONE_REMOTE` to a remote that your rclone configuration can access, e.g. `gdrive:f1-archives` or `s3:f1-pool`. Backups are copied to `remote/<backup basename>`. Rclone must be installed in the runtime and credentials provided through protected mounts or environment. A failed transfer returns a warning but does not roll back already-published scores. Monitor backup logs and perform regular test restores. For intermittently-powered hosts, schedule a backup before every planned shutdown and retain multiple rolling snapshots. The backend already backs up on SIGTERM and score publication.

## Restore after a host failure

1. Stop the app/compose stack. Recover the encrypted `.enc` file and the original encryption key.
2. Restore to a **new database path**; the script refuses to overwrite an existing target:

   ```bash
   BACKUP_ENCRYPTION_KEY=<original-hex-key> node scripts/restore-backup.mjs backups/pool-....sqlite.gz.enc restored/pool.sqlite
   ```

3. Copy restored DB to `./data/pool.sqlite` only after backing up/renaming any old files and ensuring no old `-wal`/`-shm` from a previous DB remains. Ensure owner UID 1000 has write access.
4. Start the app; review the audit log, results, league balances and current locks; run sync if needed. Never assume a local snapshot was uploaded until confirmed by rclone.

## Runtime health check

```bash
curl http://127.0.0.1:8080/api/health
```

Expected: `{"status":"ok","serverTime":"...","database":"sqlite-wal"}`. Serve externally behind Cloudflare Tunnel or HTTPS proxy.
