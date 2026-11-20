import {DatabaseSync, backup} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname, resolve} from 'node:path';

export const dbPath=resolve(process.env.DB_PATH??'./data/pool.sqlite');
mkdirSync(dirname(dbPath),{recursive:true});
export const db=new DatabaseSync(dbPath);
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,display_name TEXT NOT NULL,
 password_hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'participant',created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS seasons (
 id TEXT PRIMARY KEY,year INTEGER NOT NULL UNIQUE,name TEXT NOT NULL,sprint_mode TEXT NOT NULL DEFAULT 'two-form',
 currency TEXT NOT NULL DEFAULT 'EUR',base_entry_cents INTEGER NOT NULL DEFAULT 1000,small_max INTEGER NOT NULL DEFAULT 5,
 medium_max INTEGER NOT NULL DEFAULT 10,preseason_lock TEXT NOT NULL,salvage_start TEXT NOT NULL,salvage_end TEXT NOT NULL,
 created_at TEXT NOT NULL
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
 note TEXT,details TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_picks ON submissions(weekend_id,user_id,form,version DESC);
CREATE INDEX IF NOT EXISTS idx_score ON score_snapshots(weekend_id,user_id,result_version DESC);
CREATE INDEX IF NOT EXISTS idx_audit ON audit(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger ON ledger(season_id,created_at DESC);
`);
export type Row=Record<string,any>;
export function get(sql:string,...args:any[]):Row|undefined{return db.prepare(sql).get(...args) as Row|undefined}
export function all(sql:string,...args:any[]):Row[]{return db.prepare(sql).all(...args) as Row[]}
export function run(sql:string,...args:any[]){return db.prepare(sql).run(...args)}
export function transaction<T>(fn:()=>T):T{
 db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value}catch(err){db.exec('ROLLBACK');throw err}
}
export const json=(row:any,field:string)=>JSON.parse(row[field]);
export async function checkpointBackup(destination:string){mkdirSync(dirname(destination),{recursive:true});await backup(db,destination);db.exec('PRAGMA wal_checkpoint(PASSIVE)');}
