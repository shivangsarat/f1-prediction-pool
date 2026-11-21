import test from 'node:test';
import assert from 'node:assert/strict';
import {createDecipheriv} from 'node:crypto';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';

const temp = mkdtempSync(join(tmpdir(), 'gridlock-backups-'));
process.env.DB_PATH = join(temp, 'test.sqlite');
process.env.BACKUP_DIR = join(temp, 'backups');
process.env.BACKUP_RCLONE_REMOTE = '';
process.env.NODE_ENV = 'test';
const {createBackup} = await import('./backups.ts');
const {run} = await import('./db.ts');

/** Verify that production-compatible AES-GCM backups can be authenticated and restored. */
test('createBackup writes an encrypted, consistent SQLite snapshot', async () => {

  const key = '43'.repeat(32);
  process.env.BACKUP_ENCRYPTION_KEY = key;
  run('INSERT INTO users(id,email,display_name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)', 'u1', 'backup@example.test', 'Backup Test', 'testhash', 'participant', new Date().toISOString());
  const backup = await createBackup();
  assert.equal(backup.encrypted, true);
  assert.equal(backup.offsite, false);
  const payload = readFileSync(backup.location);
  assert.equal(payload.subarray(0, 5).toString(), 'F1BK\x01');
  const iv = payload.subarray(5, 17), tag = payload.subarray(17, 33);
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
  decipher.setAuthTag(tag);
  const sqlite = gunzipSync(Buffer.concat([decipher.update(payload.subarray(33)), decipher.final()]));
  assert.equal(sqlite.subarray(0, 16).toString(), 'SQLite format 3\0');
  assert.ok(sqlite.includes(Buffer.from('backup@example.test')));
});

/** Reject malformed backup keys before exporting plaintext into an offsite archive. */
test('createBackup rejects invalid encryption key', async () => {

  process.env.BACKUP_ENCRYPTION_KEY = 'invalid';
  await assert.rejects(createBackup(), /64 hexadecimal characters/);
});

test.after(() => rmSync(temp, {recursive: true, force: true}));
