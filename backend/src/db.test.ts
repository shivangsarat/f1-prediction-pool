import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';

const dir = mkdtempSync(join(tmpdir(), 'gridlock-upgrade-'));
const path = join(dir, 'legacy.sqlite');
process.env.DB_PATH = path;
process.env.NODE_ENV = 'test';

const legacy = new DatabaseSync(path);
legacy.exec(`CREATE TABLE users (id TEXT PRIMARY KEY,email TEXT NOT NULL,display_name TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE seasons (id TEXT PRIMARY KEY,year INTEGER UNIQUE NOT NULL,name TEXT NOT NULL,sprint_mode TEXT NOT NULL,currency TEXT NOT NULL,base_entry_cents INTEGER NOT NULL,small_max INTEGER NOT NULL,medium_max INTEGER NOT NULL,preseason_lock TEXT NOT NULL,salvage_start TEXT NOT NULL,salvage_end TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE audit (id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,action TEXT NOT NULL,entity_id TEXT NOT NULL,note TEXT,details TEXT NOT NULL,created_at TEXT NOT NULL);`);
legacy.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run('admin1', 'commissioner@legacy.test', 'Legacy Commissioner', 'oldhash', 'admin', new Date().toISOString());
legacy.prepare('INSERT INTO seasons VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('season-legacy', 2026, '2026 Season', 'two-form', 'EUR', 1000, 5, 10, '2026-03-01T00:00:00Z', '2026-08-01T00:00:00Z', '2026-08-08T00:00:00Z', new Date().toISOString());
legacy.prepare('INSERT INTO audit VALUES(?,?,?,?,?,?,?)').run('audit1', 'admin1', 'season.create', 'season-legacy', '', '{}', new Date().toISOString());
legacy.close();
const {db, get, all, run, transaction, migrateLegacyDatabase} = await import('./db.ts');

/** Upgrade old seasons into a legacy tournament without losing the season. */
test('legacy database migration retains seasons and members', () => {

  const season = get('SELECT * FROM seasons WHERE id=?', 'season-legacy');
  assert.equal(season?.year, 2026);
  assert.ok(season?.tournament_id);
  assert.equal(get('SELECT role FROM tournament_members WHERE tournament_id=? AND user_id=?', season.tournament_id, 'admin1')?.role, 'commissioner');
  assert.equal(get('SELECT tournament_id FROM audit WHERE id=?', 'audit1')?.tournament_id, season.tournament_id);
  migrateLegacyDatabase();
  assert.equal(all('SELECT * FROM tournaments').length, 1);
});

/** Verify global year uniqueness is removed in favor of unique (tournament, year). */
test('parallel tournaments may reuse a season year', () => {

  const season = get('SELECT * FROM seasons WHERE id=?', 'season-legacy');
  run('INSERT INTO tournaments(id,name,description,owner_id,invite_hash,created_at) VALUES(?,?,?,?,?,?)', 'tournament-2', 'Second', '', 'admin1', 'another-hash', new Date().toISOString());
  run('INSERT INTO seasons(id,year,name,tournament_id,sprint_mode,currency,base_entry_cents,small_max,medium_max,preseason_lock,salvage_start,salvage_end,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', 'season-2', 2026, '2026 Second', 'tournament-2', 'two-form', 'EUR', 1000, 5, 10, '2026-03-01T00:00:00Z', '2026-08-01T00:00:00Z', '2026-08-08T00:00:00Z', new Date().toISOString());
  assert.equal(all('SELECT * FROM seasons WHERE year=2026').length, 2);
  assert.notEqual(get('SELECT tournament_id FROM seasons WHERE id=?', 'season-2')?.tournament_id, season?.tournament_id);
});

/** A failed ledger or prediction mutation rolls back its entire transaction. */
test('SQLite immediate transactions roll back atomically', () => {

  assert.throws(() => transaction(() => {
    run('INSERT INTO auth_attempts VALUES(?,?)', 'rolled-back', new Date().toISOString());
    throw Error('rollback')
  }));
  assert.equal(get('SELECT * FROM auth_attempts WHERE key_hash=?', 'rolled-back'), undefined);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
});

test.after(() => {
  db.close();
  rmSync(dir, {recursive: true, force: true})
});
