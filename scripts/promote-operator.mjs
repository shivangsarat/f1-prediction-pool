#!/usr/bin/env node
import {DatabaseSync} from 'node:sqlite';
import {resolve} from 'node:path';
import {timingSafeEqual} from 'node:crypto';

/** Grant the configured Gmail operator account global access from a trusted server shell only. */
function main() {
  const email = (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
  const key = process.env.ADMIN_BOOTSTRAP_KEY ?? '';
  const confirmation = process.argv[2] ?? '';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || key.length < 32 || confirmation.length !== key.length ||
    !timingSafeEqual(Buffer.from(key), Buffer.from(confirmation))) {
    throw new Error('Set ADMIN_EMAIL, ADMIN_BOOTSTRAP_KEY (32+ chars), then supply that exact key as the CLI argument.');
  }
  const dbPath = resolve(process.env.DB_PATH ?? './data/pool.sqlite');
  const db = new DatabaseSync(dbPath);
  try {
    const user = db.prepare('SELECT id,role FROM users WHERE email=?').get(email);
    if (!user) throw new Error(`No account registered for ${email}; register it first.`);
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare("UPDATE users SET role='admin' WHERE id=?").run(user.id);
      db.prepare("INSERT INTO audit(id,actor_id,action,entity_id,note,details,created_at,tournament_id) VALUES(hex(randomblob(16)),?,'operator.promote',?,?,?,datetime('now'),NULL)")
        .run(user.id, user.id, `Local shell promotion of ${email}`, '{}');
      db.exec('COMMIT');
    } catch (error) {db.exec('ROLLBACK'); throw error;}
    console.log(`Platform operator enabled for ${email}; all existing sessions remain valid.`);
  } finally {db.close();}
}
main();
