import {DatabaseSync, backup} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {randomUUID} from 'node:crypto';

export const dbPath = resolve(process.env.DB_PATH ?? './data/pool.sqlite');
mkdirSync(dirname(dbPath), {recursive: true});
export const db = new DatabaseSync(dbPath);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS tournaments (
 id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',
 owner_id TEXT REFERENCES users(id),invite_hash TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tournament_members (
 tournament_id TEXT NOT NULL REFERENCES tournaments(id),user_id TEXT NOT NULL REFERENCES users(id),
 role TEXT NOT NULL CHECK(role IN ('commissioner','player')),joined_at TEXT NOT NULL,
 PRIMARY KEY(tournament_id,user_id)
);
CREATE TABLE IF NOT EXISTS auth_attempts (
 key_hash TEXT NOT NULL,occurred_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_attempts ON auth_attempts(key_hash,occurred_at); 
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,display_name TEXT NOT NULL,
 password_hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'participant',created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS seasons (
 id TEXT PRIMARY KEY,year INTEGER NOT NULL,name TEXT NOT NULL,tournament_id TEXT NOT NULL REFERENCES tournaments(id),sprint_mode TEXT NOT NULL DEFAULT 'two-form',
 currency TEXT NOT NULL DEFAULT 'EUR',base_entry_cents INTEGER NOT NULL DEFAULT 1000,small_max INTEGER NOT NULL DEFAULT 5,
 medium_max INTEGER NOT NULL DEFAULT 10,preseason_lock TEXT NOT NULL,salvage_start TEXT NOT NULL,salvage_end TEXT NOT NULL,
 created_at TEXT NOT NULL,UNIQUE(tournament_id,year)
);
CREATE TABLE IF NOT EXISTS roster (
 season_id TEXT NOT NULL REFERENCES seasons(id),id TEXT NOT NULL,name TEXT NOT NULL,
 code TEXT NOT NULL,team_id TEXT NOT NULL,team_name TEXT NOT NULL,PRIMARY KEY(season_id,id)
);
CREATE TABLE IF NOT EXISTS weekends (
 id TEXT PRIMARY KEY,season_id TEXT NOT NULL REFERENCES seasons(id),round INTEGER NOT NULL,
 name TEXT NOT NULL,is_sprint INTEGER NOT NULL DEFAULT 0,qualifying_at TEXT NOT NULL,
 sprint_qualifying_at TEXT,race_at TEXT NOT NULL,chequered_at TEXT,
 openf1_keys TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL, UNIQUE(season_id,round)
);
CREATE TABLE IF NOT EXISTS submissions (
 id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),weekend_id TEXT NOT NULL REFERENCES weekends(id),
 form TEXT NOT NULL,payload TEXT NOT NULL,version INTEGER NOT NULL,submitted_at TEXT NOT NULL,
 source TEXT NOT NULL DEFAULT 'web',audit_note TEXT, UNIQUE(user_id,weekend_id,form,version)
);
CREATE TABLE IF NOT EXISTS results (
 weekend_id TEXT PRIMARY KEY REFERENCES weekends(id),payload TEXT NOT NULL,source TEXT NOT NULL,
 version INTEGER NOT NULL,final_classification INTEGER NOT NULL DEFAULT 0,published_at TEXT,published_hash TEXT,
 updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS score_snapshots (
 id TEXT PRIMARY KEY,weekend_id TEXT NOT NULL REFERENCES weekends(id),user_id TEXT NOT NULL REFERENCES users(id),
 result_version INTEGER NOT NULL,points INTEGER NOT NULL,exact_podiums INTEGER NOT NULL,exact_top10 INTEGER NOT NULL,
 prop_points INTEGER NOT NULL,breakdown TEXT NOT NULL,created_at TEXT NOT NULL,
 UNIQUE(weekend_id,user_id,result_version)
);
CREATE TABLE IF NOT EXISTS scoring_previews (
 weekend_id TEXT PRIMARY KEY REFERENCES weekends(id),digest TEXT NOT NULL,created_at TEXT NOT NULL,reviewer_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS champion_picks (
 id TEXT PRIMARY KEY,season_id TEXT NOT NULL REFERENCES seasons(id),user_id TEXT NOT NULL REFERENCES users(id),
 category TEXT NOT NULL,choice TEXT NOT NULL,phase TEXT NOT NULL,submitted_at TEXT NOT NULL,version INTEGER NOT NULL,
 UNIQUE(season_id,user_id,category,version)
);
CREATE TABLE IF NOT EXISTS champions (
 season_id TEXT PRIMARY KEY REFERENCES seasons(id),wdc TEXT NOT NULL,wcc TEXT NOT NULL,
 published_at TEXT NOT NULL,submitted_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ledger (
 id TEXT PRIMARY KEY,season_id TEXT NOT NULL REFERENCES seasons(id),user_id TEXT REFERENCES users(id),
 type TEXT NOT NULL,amount_cents INTEGER NOT NULL,description TEXT NOT NULL,idempotency_key TEXT NOT NULL UNIQUE,
 created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
 id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,action TEXT NOT NULL,entity_id TEXT NOT NULL,
 note TEXT,details TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL,tournament_id TEXT REFERENCES tournaments(id)
);
CREATE INDEX IF NOT EXISTS idx_picks ON submissions(weekend_id,user_id,form,version DESC);
CREATE INDEX IF NOT EXISTS idx_score ON score_snapshots(weekend_id,user_id,result_version DESC);
CREATE INDEX IF NOT EXISTS idx_audit ON audit(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger ON ledger(season_id,created_at DESC);
`);

/** Migrate a single-pool v1 database without discarding scores, picks, or financial history. */
export function migrateLegacyDatabase(): void {

  const columns = db.prepare('PRAGMA table_info(seasons)').all() as Array<{name: string}>;
  if (columns.some(column => column.name === 'tournament_id')) {

    const auditColumns = db.prepare('PRAGMA table_info(audit)').all() as Array<{name: string}>;
    if (!auditColumns.some(column => column.name === 'tournament_id')) db.exec('ALTER TABLE audit ADD COLUMN tournament_id TEXT REFERENCES tournaments(id)');
    return;
  }
  const owner = db.prepare("SELECT id FROM users ORDER BY CASE WHEN role='admin' THEN 0 ELSE 1 END,created_at LIMIT 1").get() as {id: string} | undefined;
  const legacyId = randomUUID(), now = new Date().toISOString();
  // Rebuild is required to remove the original global UNIQUE(year) constraint.
  db.exec('PRAGMA foreign_keys=OFF');
  try {

    db.exec('BEGIN IMMEDIATE');
    db.prepare('INSERT INTO tournaments(id,name,description,owner_id,invite_hash,created_at) VALUES(?,?,?,?,?,?)').run(legacyId, 'Legacy F1 Pool', 'Imported from the single-pool schema', owner?.id ?? null, randomUUID(), now);
    db.exec(`CREATE TABLE seasons_new (
   id TEXT PRIMARY KEY,year INTEGER NOT NULL,name TEXT NOT NULL,
   tournament_id TEXT NOT NULL REFERENCES tournaments(id),sprint_mode TEXT NOT NULL DEFAULT 'two-form',
   currency TEXT NOT NULL DEFAULT 'EUR',base_entry_cents INTEGER NOT NULL DEFAULT 1000,
   small_max INTEGER NOT NULL DEFAULT 5,medium_max INTEGER NOT NULL DEFAULT 10,
   preseason_lock TEXT NOT NULL,salvage_start TEXT NOT NULL,salvage_end TEXT NOT NULL,
   created_at TEXT NOT NULL,UNIQUE(tournament_id,year)
  );`);
    db.prepare(`INSERT INTO seasons_new (id,year,name,tournament_id,sprint_mode,currency,base_entry_cents,small_max,medium_max,preseason_lock,salvage_start,salvage_end,created_at)
    SELECT id,year,name,?,sprint_mode,currency,base_entry_cents,small_max,medium_max,preseason_lock,salvage_start,salvage_end,created_at FROM seasons`).run(legacyId);
    db.exec('DROP TABLE seasons; ALTER TABLE seasons_new RENAME TO seasons;');
    if (owner) {

      db.prepare("INSERT INTO tournament_members SELECT ?,id,CASE WHEN role='admin' THEN 'commissioner' ELSE 'player' END,? FROM users").run(legacyId, now);
    }
    db.exec('ALTER TABLE audit ADD COLUMN tournament_id TEXT REFERENCES tournaments(id)');
    db.prepare('UPDATE audit SET tournament_id=? WHERE entity_id IN (SELECT id FROM seasons UNION SELECT id FROM weekends UNION SELECT id FROM ledger)').run(legacyId);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  finally {
    db.exec('PRAGMA foreign_keys=ON')
  }
  const fkErrors = db.prepare('PRAGMA foreign_key_check').all();
  if (fkErrors.length) throw Error('Legacy migration has unresolved foreign keys');
}
migrateLegacyDatabase();

/** Add optional directory, catalogue and direct-invite fields without rebuilding financial tables. */
export function migrateDiscoverability(): void {
  const cols = (table: string) => new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{name:string}>).map(c => c.name));
  const tournaments = cols('tournaments');
  if (!tournaments.has('visibility')) db.exec("ALTER TABLE tournaments ADD COLUMN visibility TEXT NOT NULL DEFAULT 'invite_only' CHECK(visibility IN ('public','invite_only'))");
  if (!tournaments.has('status')) db.exec("ALTER TABLE tournaments ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived'))");
  const users = cols('users');
  if (!users.has('username')) db.exec('ALTER TABLE users ADD COLUMN username TEXT');
  if (!users.has('email_verified_at')) db.exec('ALTER TABLE users ADD COLUMN email_verified_at TEXT');
  if (!users.has('notification_opt_in')) db.exec('ALTER TABLE users ADD COLUMN notification_opt_in INTEGER NOT NULL DEFAULT 1');
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_username ON users(username COLLATE NOCASE) WHERE username IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_tournaments_discover ON tournaments(visibility,status,created_at);
    CREATE TABLE IF NOT EXISTS tournament_user_invites (
      id TEXT PRIMARY KEY,tournament_id TEXT NOT NULL REFERENCES tournaments(id),
      user_id TEXT NOT NULL REFERENCES users(id),invited_by TEXT NOT NULL REFERENCES users(id),
      status TEXT NOT NULL CHECK(status IN ('pending','accepted','declined')),
      created_at TEXT NOT NULL,UNIQUE(tournament_id,user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_user_invites ON tournament_user_invites(user_id,status);
    CREATE TABLE IF NOT EXISTS email_outbox (
      id TEXT PRIMARY KEY,event_key TEXT NOT NULL UNIQUE,user_id TEXT NOT NULL REFERENCES users(id),
      tournament_id TEXT REFERENCES tournaments(id),subject TEXT NOT NULL,body TEXT NOT NULL,
      created_at TEXT NOT NULL,next_attempt_at TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,
      delivered_at TEXT,last_error TEXT,claimed_until TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_email_pending ON email_outbox(delivered_at,next_attempt_at);
    CREATE TABLE IF NOT EXISTS email_verifications (
      token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),
      expires_at TEXT NOT NULL,created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_email_verify_user ON email_verifications(user_id,created_at);
  `);
  if (!cols('email_outbox').has('claimed_until')) db.exec('ALTER TABLE email_outbox ADD COLUMN claimed_until TEXT');
  // Stable, unique usernames for existing users preserve historical user IDs and sessions.
  for (const u of db.prepare('SELECT id,display_name FROM users WHERE username IS NULL').all() as Array<{id:string,display_name:string}>) {
    const base = u.display_name.toLowerCase().replace(/[^a-z0-9_.-]+/g, '_').replace(/^[_.-]+|[_.-]+$/g, '').slice(0,18) || 'player';
    const username = `${base}_${u.id.replace(/-/g, '').slice(0,8)}`;
    db.prepare('UPDATE users SET username=? WHERE id=?').run(username, u.id);
  }
}
migrateDiscoverability();

/** Add v2.0 financial policy and frozen season terms without altering pre-existing v1 payout behavior. */
export function migrateFinance(): void {
  db.exec(`CREATE TABLE IF NOT EXISTS platform_finance (
    id INTEGER PRIMARY KEY CHECK(id=1),
    platform_rake_enabled INTEGER NOT NULL DEFAULT 0,
    platform_rake_bps INTEGER NOT NULL DEFAULT 500 CHECK(platform_rake_bps BETWEEN 0 AND 1500),
    allow_tournament_house_rake INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  )`);
  db.prepare('INSERT OR IGNORE INTO platform_finance(id,updated_at) VALUES(1,?)').run(new Date().toISOString());
  const existing = new Set((db.prepare('PRAGMA table_info(seasons)').all() as Array<{name:string}>).map(x => x.name));
  const additions: Record<string,string> = {
    payout_model: "TEXT NOT NULL DEFAULT 'adaptive-3tier'",
    house_rake_enabled: 'INTEGER NOT NULL DEFAULT 0',
    house_rake_bps: 'INTEGER NOT NULL DEFAULT 500',
    poker_floor_enabled: 'INTEGER NOT NULL DEFAULT 1',
    poker_itm_pct: 'INTEGER NOT NULL DEFAULT 20',
    poker_alpha_mode: "TEXT NOT NULL DEFAULT 'auto'",
    poker_alpha_manual: 'REAL NOT NULL DEFAULT 1.5',
    platform_rake_bps_snapshot: 'INTEGER DEFAULT NULL',
    house_rake_bps_snapshot: 'INTEGER DEFAULT NULL',
    finance_locked_at: 'TEXT DEFAULT NULL',
  };
  const isMigrating = !existing.has('payout_model');
  for (const [column, definition] of Object.entries(additions)) {
    if (!existing.has(column)) db.exec(`ALTER TABLE seasons ADD COLUMN ${column} ${definition}`);
  }
  // Historical v1 seasons have no rake and must remain grandfathered even when operator policy changes.
  if (isMigrating) db.exec(`UPDATE seasons SET platform_rake_bps_snapshot=0, house_rake_bps_snapshot=0, finance_locked_at=created_at`);
}
migrateFinance();

/**
 * Add v2.1 mid-season governance, optional championship timestamps and shared OpenF1 caching.
 * Rebuild the seasons definition only once to remove v1's NOT NULL August dates safely;
 * foreign keys are checked immediately after the transaction to protect existing scores.
 */
export function migrateMidseason(): void {
  const cols = (table: string) => new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{name: string}>).map(row => row.name));
  const current = cols('seasons');
  if (!current.has('championship_enabled')) {
    const schema = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='seasons'").get() as {sql:string}).sql;
    const relaxed = schema.replace(/^CREATE TABLE\s+"?seasons"?/i, 'CREATE TABLE seasons_midseason')
      .replace(/preseason_lock TEXT NOT NULL/gi, 'preseason_lock TEXT')
      .replace(/salvage_start TEXT NOT NULL/gi, 'salvage_start TEXT')
      .replace(/salvage_end TEXT NOT NULL/gi, 'salvage_end TEXT')
      .replace(/,\s*UNIQUE\(tournament_id,year\)/i, ', championship_enabled INTEGER NOT NULL DEFAULT 1, salvage_enabled INTEGER NOT NULL DEFAULT 1, opening_round INTEGER NOT NULL DEFAULT 1, UNIQUE(tournament_id,year)');
    if (!relaxed.includes('opening_round INTEGER')) throw new Error('Unexpected seasons schema while migrating mid-season rules');
    const columns = [...current].join(',');
    db.exec('PRAGMA foreign_keys=OFF');
    try {
      db.exec('BEGIN IMMEDIATE');
      db.exec(relaxed);
      db.exec(`INSERT INTO seasons_midseason(${columns}) SELECT ${columns} FROM seasons`);
      db.exec('DROP TABLE seasons; ALTER TABLE seasons_midseason RENAME TO seasons;');
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    } finally {
      db.exec('PRAGMA foreign_keys=ON');
    }
    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) throw new Error('Foreign keys invalid after mid-season migration');
  }
  if (!cols('seasons').has('expected_races')) db.exec('ALTER TABLE seasons ADD COLUMN expected_races INTEGER NOT NULL DEFAULT 0');
  const tournamentCols = cols('tournaments');
  if (!tournamentCols.has('launch_opening_round')) db.exec('ALTER TABLE tournaments ADD COLUMN launch_opening_round INTEGER NOT NULL DEFAULT 1');
  if (!tournamentCols.has('launch_expected_races')) db.exec('ALTER TABLE tournaments ADD COLUMN launch_expected_races INTEGER NOT NULL DEFAULT 0');
  if (!tournamentCols.has('launch_year')) db.exec('ALTER TABLE tournaments ADD COLUMN launch_year INTEGER');
  const policyCols = cols('platform_finance');
  if (!policyCols.has('allow_public_midseason')) db.exec('ALTER TABLE platform_finance ADD COLUMN allow_public_midseason INTEGER NOT NULL DEFAULT 1');
  if (!policyCols.has('max_active_owned_pools')) db.exec('ALTER TABLE platform_finance ADD COLUMN max_active_owned_pools INTEGER NOT NULL DEFAULT 3');
  const mailCols = cols('email_outbox');
  if (!mailCols.has('priority')) db.exec('ALTER TABLE email_outbox ADD COLUMN priority INTEGER NOT NULL DEFAULT 50');
  db.exec(`CREATE TABLE IF NOT EXISTS openf1_cache (
    cache_key TEXT PRIMARY KEY,endpoint TEXT NOT NULL,content TEXT NOT NULL,
    updated_at TEXT NOT NULL,expires_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_openf1_cache_expiry ON openf1_cache(expires_at);
  CREATE INDEX IF NOT EXISTS idx_midseason_owned ON tournaments(owner_id,status);`);
  db.exec(`UPDATE email_outbox SET priority=100 WHERE event_key LIKE 'locked:%' OR event_key LIKE 'result:%' OR event_key LIKE 'champions:%' OR event_key LIKE 'verify:%'`);
  db.exec(`UPDATE email_outbox SET priority=10 WHERE event_key LIKE 'invited:%' OR event_key LIKE 'invite:%'`);
}
migrateMidseason();


export type Row = Record<string, any>;
/**
 * Get the first SQLite row matching a parameterized query, or undefined.
 * @param sql - Input to this operation.
 * @param args - Input to this operation.
 */
export function get(sql: string, ...args: any[]): Row | undefined {
  return db.prepare(sql).get(...args) as Row | undefined
}
/**
 * Read every SQLite row matching a parameterized query.
 * @param sql - Input to this operation.
 * @param args - Input to this operation.
 */
export function all(sql: string, ...args: any[]): Row[] {
  return db.prepare(sql).all(...args) as Row[]
}
/**
 * Execute a parameterized SQL statement that mutates persistent storage.
 * @param sql - Input to this operation.
 * @param args - Input to this operation.
 */
export function run(sql: string, ...args: any[]) {
  return db.prepare(sql).run(...args)
}
/**
 * Execute synchronous database work in an atomic IMMEDIATE transaction; roll back on error.
 * @param fn - Input to this operation.
 */
export function transaction<T>(fn: () => T): T {

  db.exec('BEGIN IMMEDIATE');
  try {
    const value = fn();
    db.exec('COMMIT');
    return value
  } catch (err) {
    db.exec('ROLLBACK');
    throw err
  }
}
/**
 * Parse a JSON column from a database record.
 * @param row - Input to this operation.
 * @param field - Input to this operation.
 */
export const json = (row: any, field: string) => JSON.parse(row[field]);
/**
 * Write an online SQLite backup and checkpoint WAL pages without data loss.
 * @param destination - Input to this operation.
 */
export async function checkpointBackup(destination: string) {
  mkdirSync(dirname(destination), {recursive: true});
  await backup(db, destination);
  db.exec('PRAGMA wal_checkpoint(PASSIVE)');
}
