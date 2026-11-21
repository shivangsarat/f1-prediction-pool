import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const folder = mkdtempSync(join(tmpdir(), 'gridlock-auto-roster-'));
process.env.DB_PATH = join(folder, 'pool.sqlite');
process.env.NODE_ENV = 'test';
process.env.MAIL_PROVIDER = 'none';
const {get, run, all} = await import('./db.ts');
const {app} = await import('./server.ts');
const {normalizeOpenF1Roster, recentRosterSessionKeys, mergeSeasonRoster, markManualRoster, ensureSeasonRoster} = await import('./rosterSync.ts');

const originFetch = globalThis.fetch;
let requestCount = 0;
const sourceData = Array.from({length:22}, (_, i) => ({
  driver_number: i + 1,
  full_name: `Driver ${i + 1}`,
  name_acronym: `D${String(i + 1).padStart(2, '0')}`,
  team_name: i < 2 ? 'Cadillac' : `Team ${Math.floor(i / 2)}`,
}));
const year = new Date().getUTCFullYear();
const sessions = [
  {session_key: 2001, year, date_start: `${year}-05-01T10:00:00Z`},
  {session_key: 2002, year, date_start: `${year}-11-01T10:00:00Z`},
  {session_key: 9999, year, date_start: `${year + 1}-12-01T10:00:00Z`},
];

/** Intercept only OpenF1, allowing real HTTP tests against the local API server. */
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  if (url.hostname !== 'api.openf1.org') return originFetch(input, init);
  requestCount++;
  const data = url.pathname.endsWith('/sessions') ? sessions :
    url.pathname.endsWith('/drivers') ? sourceData : [];
  return Promise.resolve(new Response(JSON.stringify(data), {status: 200, headers: {'Content-Type': 'application/json'}}));
}) as typeof fetch;

const owner = 'owner-auto', pool = 'pool-auto', seasonId = 'season-auto';
run('INSERT INTO users(id,email,display_name,password_hash,role,created_at,username) VALUES(?,?,?,?,?,?,?)',
  owner, 'auto@example.test', 'Roster Owner', 'testhash', 'participant', new Date().toISOString(), 'roster_owner');
run('INSERT INTO tournaments(id,name,description,owner_id,invite_hash,created_at) VALUES(?,?,?,?,?,?)',
  pool, 'Auto F1', '', owner, 'a'.repeat(64), new Date().toISOString());
run('INSERT INTO tournament_members(tournament_id,user_id,role,joined_at) VALUES(?,?,?,?)',
  pool, owner, 'commissioner', new Date().toISOString());
run(`INSERT INTO seasons(id,year,name,tournament_id,sprint_mode,currency,base_entry_cents,small_max,medium_max,
  preseason_lock,salvage_start,salvage_end,created_at,opening_round,expected_races,championship_enabled,salvage_enabled)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  seasonId, year, 'Auto F1 season', pool, 'two-form', 'EUR', 0, 5, 10,
  null, null, null, new Date().toISOString(), 20, 5, 0, 0);

/** Normalize driver identity and F1 constructor slugs without including malformed rows. */
test('normalizeOpenF1Roster validates and deduplicates drivers', () => {
  const roster = normalizeOpenF1Roster([...sourceData, {...sourceData[0]}, {driver_number:101,team_name:'Invalid',full_name:'No'},
    {driver_number:88,full_name:'No Team'}]);
  assert.equal(roster.length, 22);
  assert.equal(roster[0].id, '1');
  assert.equal(roster[0].teamId, 'cadillac');
  assert.equal(normalizeOpenF1Roster(null).length, 0);
});

/** Future and different-year OpenF1 sessions must never provide current-season drivers. */
test('recentRosterSessionKeys selects recent current-year sessions', () => {
  assert.deepEqual(recentRosterSessionKeys(sessions, year, Date.parse(`${year}-11-10T00:00:00Z`)), [2002,2001]);
  assert.deepEqual(recentRosterSessionKeys(sessions, year + 1, Date.parse(`${year}-11-10T00:00:00Z`)), []);
});

/** Empty tournament seasons automatically fetch a complete OpenF1 roster and then cache it. */
test('ensureSeasonRoster auto-populates and throttles repeated requests', async () => {
  const result = await ensureSeasonRoster(seasonId);
  assert.equal(result.status, 'ready');
  assert.equal(result.added,22);
  assert.equal(result.count,22);
  assert.equal(result.sessionKey, 2002);
  const fetched = requestCount;
  const retry = await ensureSeasonRoster(seasonId);
  assert.equal(retry.status,'ready');
  assert.equal(requestCount,fetched);
  assert.equal(all('SELECT * FROM roster WHERE season_id=?',seasonId).length,22);
  assert.equal(get('SELECT status FROM season_roster_sync WHERE season_id=?',seasonId)?.status,'ready');
});

/** Once a race has ballots, OpenF1 may append replacements but cannot rewrite existing driver IDs. */
test('mergeSeasonRoster preserves historical picks and their original team identifiers', () => {
  const weekendId = 'weekend-auto';
  const qual = `${year}-11-30T10:00:00Z`, race = `${year}-12-01T10:00:00Z`;
  run(`INSERT INTO weekends(id,season_id,round,name,is_sprint,qualifying_at,sprint_qualifying_at,race_at,openf1_keys,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`, weekendId, seasonId, 20, 'Fixture', 0, qual, null, race, '{}', new Date().toISOString());
  run('INSERT INTO submissions(id,user_id,weekend_id,form,payload,version,submitted_at,source,audit_note) VALUES(?,?,?,?,?,?,?,?,?)',
    'ballot-auto', owner, weekendId, 'gp', '{}',1,`${year}-11-18T10:00:00Z`,'web','fixture');
  const before = get('SELECT * FROM roster WHERE season_id=? AND id=?',seasonId,'1');
  const imported = mergeSeasonRoster(seasonId,[...normalizeOpenF1Roster(sourceData).map(r => r.id === '1' ? {...r,teamId:'new-team',teamName:'New Team'} : r),
    {id:'30',name:'Sub Driver',code:'SUB',teamId:'reserve-team',teamName:'Reserve Team'}],2003);
  assert.equal(imported.added,1);
  assert.equal(imported.updated,0);
  assert.equal(get('SELECT team_id FROM roster WHERE season_id=? AND id=?',seasonId,'1')?.team_id,before?.team_id);
  assert.equal(get('SELECT team_id FROM roster WHERE season_id=? AND id=?',seasonId,'30')?.team_id,'reserve-team');
  assert.equal(get('SELECT COUNT(*) AS n FROM submissions WHERE weekend_id=?',weekendId)?.n,1);
});

/** A future season without a first recorded session must stay unavailable, never using last year's drivers. */
test('a future F1 year is not populated with another year’s driver list', async () => {
  const futureSeason = 'season-future';
  run(`INSERT INTO seasons(id,year,name,tournament_id,sprint_mode,currency,base_entry_cents,small_max,medium_max,
    preseason_lock,salvage_start,salvage_end,created_at,opening_round,expected_races,championship_enabled,salvage_enabled)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    futureSeason, year + 1, 'Next F1 year', pool, 'two-form','EUR',0,5,10,
    null,null,null,new Date().toISOString(),1,24,0,0);
  const response = await ensureSeasonRoster(futureSeason);
  assert.equal(response.status,'unavailable');
  assert.equal(response.count,0);
  const checked = requestCount;
  const again = await ensureSeasonRoster(futureSeason);
  assert.equal(again.status,'retry-later');
  assert.equal(requestCount,checked);
});

/** A manually maintained roster is authoritative and must not be silently changed. */
test('markManualRoster opts out of subsequent OpenF1 updates', async () => {
  markManualRoster(seasonId);
  const countBefore = requestCount;
  const result = await ensureSeasonRoster(seasonId,true);
  assert.equal(result.status,'manual');
  assert.equal(requestCount,countBefore);
});

/** The signed-in HTTP API can fetch the roster without commissioner-specific write access. */
test('GET /api/roster exposes the auto-managed season roster to an authorized member', async () => {
  const {newSession} = await import('./auth.ts');
  const cookie = `f1pool_session=${newSession(owner).token}`;
  const addr = await new Promise<any>(resolve => app.listen(0,'127.0.0.1',()=>resolve(app.address())));
  const origin = `http://127.0.0.1:${addr.port}`;
  const response = await fetch(`${origin}/api/roster?seasonId=${seasonId}`, {headers:{Cookie:cookie}});
  assert.equal(response.status,200);
  assert.equal((await response.json()).length,23);
  const retry = await fetch(`${origin}/api/roster/sync`, {method:'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({seasonId})});
  assert.equal(retry.status,200);
  assert.equal((await retry.json()).status,'manual');
  run('INSERT INTO users(id,email,display_name,password_hash,role,created_at,username) VALUES(?,?,?,?,?,?,?)',
    'other-auto','other@roster.test','Other User','hash','participant',new Date().toISOString(),'roster_other');
  const unrelatedCookie = `f1pool_session=${newSession('other-auto').token}`;
  const forbiddenRead = await fetch(`${origin}/api/roster?seasonId=${seasonId}`, {headers:{Cookie:unrelatedCookie}});
  assert.equal(forbiddenRead.status,404);
  const forbiddenSync = await fetch(`${origin}/api/roster/sync`, {method:'POST',headers:{Cookie:unrelatedCookie,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({seasonId})});
  assert.equal(forbiddenSync.status,404);
  const outside = await fetch(`${origin}/api/roster?seasonId=does-not-exist`, {headers:{Cookie:cookie}});
  assert.equal(outside.status,404);
});

test.after(async () => {
  globalThis.fetch = originFetch;
  if (app.listening) await new Promise<void>(resolve => app.close(() => resolve()));
  rmSync(folder,{recursive:true,force:true});
});
