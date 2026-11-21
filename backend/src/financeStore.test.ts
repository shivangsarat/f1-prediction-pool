import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const folder = mkdtempSync(join(tmpdir(), 'gridlock-finance-config-'));
process.env.DB_PATH = join(folder, 'finance.sqlite'); process.env.NODE_ENV = 'test';
const {get, run} = await import('./db.ts');
const {platformPolicy, updatePlatformPolicy, seasonFinanceConfig, validateSeasonFinanceChanges, snapshotFinance, tournamentTerms} = await import('./financeStore.ts');
const {register} = await import('./auth.ts');
const {createTournament} = await import('./tournaments.ts');
const owner = register('creator@finance.test','Creator','long-unique-test-password',undefined,'creator_finance').user;
const league = createTournament(owner,'Finance Policies','Spec regression checks','public');
const cols = 'id,year,name,tournament_id,sprint_mode,currency,base_entry_cents,small_max,medium_max,preseason_lock,salvage_start,salvage_end,created_at';

/** Save a test season without relying on table column ordering across schema migrations. */
function setup(id: string, qualifyingAt: string) {
  const future = '2031-03-01T12:00:00Z';
  run(`INSERT INTO seasons(${cols}) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, id,id === 'season-open' ? 2031 : 2032,'Finance season',league.id,'two-form','EUR',1000,5,10,future,'2031-08-01T00:00:00Z','2031-08-08T00:00:00Z',new Date().toISOString());
  run('INSERT INTO weekends(id,season_id,round,name,is_sprint,qualifying_at,sprint_qualifying_at,race_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    `round-${id}`,id,1,'Test GP',0,qualifyingAt,null,'2031-03-03T12:00:00Z',new Date().toISOString());
}

test('operator policy defaults disabled with remembered 500-bps rates', () => {
  assert.deepEqual(platformPolicy(),{platformRakeEnabled:false,platformRakeBps:500,allowTournamentHouseRake:false});
});

test('public tournament terms disclose an unconfigured season without leaking private settings', () => {
  assert.equal(tournamentTerms(league.id).configured,false);
  assert.match(tournamentTerms(league.id).warning,/confirm terms/);
});

test('global operator priority constrains new creator terms; one tournament cannot override global permission', () => {
  setup('season-open','2031-03-01T12:00:00Z');
  assert.throws(()=>validateSeasonFinanceChanges('season-open',{houseRakeEnabled:true}),/disabled/);
  updatePlatformPolicy({platformRakeEnabled:true,platformRakeBps:500,allowTournamentHouseRake:true});
  assert.equal(validateSeasonFinanceChanges('season-open',{houseRakeEnabled:true,houseRakeBps:1000}).houseRakeBps,1000);
  assert.throws(()=>validateSeasonFinanceChanges('season-open',{houseRakeEnabled:true,houseRakeBps:1001}),/15%/);
  run('UPDATE seasons SET house_rake_enabled=1,house_rake_bps=1000 WHERE id=?','season-open');
  const config = seasonFinanceConfig('season-open');
  assert.equal(config.platformRakeBps,500);
  assert.equal(config.creatorRakeBps,1000);
  assert.equal(tournamentTerms(league.id).totalRakeBps,1500);
  updatePlatformPolicy({platformRakeBps:1000});
  assert.equal(seasonFinanceConfig('season-open').creatorRakeBps,500, 'Operator takes priority until the first lock');
});

test('locked Round 1 snapshots preserve operator and creator terms across later operator mutations', () => {
  setup('season-locked','2020-01-01T00:00:00Z');
  run('UPDATE seasons SET house_rake_enabled=1,house_rake_bps=500 WHERE id=?','season-locked');
  const before = seasonFinanceConfig('season-locked');
  assert.equal(before.platformRakeBps,1000);
  assert.equal(before.creatorRakeBps,500);
  assert.equal(before.configLocked,true);
  assert.ok(get('SELECT finance_locked_at FROM seasons WHERE id=?','season-locked')?.finance_locked_at);
  updatePlatformPolicy({platformRakeEnabled:false,allowTournamentHouseRake:false});
  const after = seasonFinanceConfig('season-locked');
  assert.equal(after.platformRakeBps,1000);
  assert.equal(after.creatorRakeBps,500);
  assert.equal(seasonFinanceConfig('season-open').platformRakeBps,0);
  assert.equal(seasonFinanceConfig('season-open').creatorRakeBps,0);
});

test('invalid platform rates and poker season settings fail closed', () => {
  assert.throws(()=>updatePlatformPolicy({platformRakeBps:1501}),/Invalid/);
  assert.throws(()=>validateSeasonFinanceChanges('season-open',{payoutModel:'totally-wrong',houseRakeEnabled:false}),/payout engine/);
  assert.throws(()=>validateSeasonFinanceChanges('season-open',{pokerItmPct:51,houseRakeEnabled:false}),/15–50%/);
  assert.throws(()=>validateSeasonFinanceChanges('season-open',{pokerAlphaManual:3.5,houseRakeEnabled:false}),/0.50/);
  snapshotFinance('season-locked');
  assert.equal(get('SELECT platform_rake_bps_snapshot FROM seasons WHERE id=?','season-locked')?.platform_rake_bps_snapshot,1000);
});

test.after(()=>rmSync(folder,{recursive:true,force:true}));
