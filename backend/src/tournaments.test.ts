import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'gridlock-tournament-'));
process.env.DB_PATH = join(dir, 'tournaments.sqlite'); process.env.NODE_ENV = 'test';
const {register} = await import('./auth.ts');
const {get, run} = await import('./db.ts');
const {tournamentName, inviteHash, newInviteCode, listTournaments, createTournament, joinTournament, requireTournament, requireCommissioner, rotateInvite, requireSeasonMember, requireSeasonCommissioner} = await import('./tournaments.ts');
const owner = register('owner@gridlock.test', 'Owner', 'something secure and unique').user;
const other = register('other@gridlock.test', 'Other', 'something secure and unique').user;
const stranger = register('stranger@gridlock.test', 'Stranger', 'something secure and unique').user;

/** Tournament names reject markup and unsuitable lengths. */
test('tournamentName validates input', () => {

  assert.equal(tournamentName('  Race day  '), 'Race day');
  assert.throws(() => tournamentName('<script>'), {status: 400});
  assert.throws(() => tournamentName('x'), {status: 400});
});

/** Invitations are unpredictable and never persisted in cleartext. */
test('inviteHash and newInviteCode', () => {

  const a = newInviteCode(), b = newInviteCode();
  assert.notEqual(a, b);
  assert.equal(a.length, 32);
  assert.equal(inviteHash(a).length, 64);
  assert.notEqual(inviteHash(a), a);
});

/** Parallel tournaments have independent roles and member lists. */
test('tournament creation, listing and isolation', () => {

  const a = createTournament(owner, 'Main Paddock', 'For group A');
  const b = createTournament(other, 'Alternate Paddock', 'For group B');
  assert.notEqual(a.id, b.id);
  assert.deepEqual(listTournaments(owner).map(x => x.id), [a.id]);
  assert.deepEqual(listTournaments(other).map(x => x.id), [b.id]);
  assert.throws(() => requireTournament(owner, b.id), {status: 404});
  assert.throws(() => requireCommissioner(other, a.id), {status: 404});
  assert.equal(get('SELECT invite_hash FROM tournaments WHERE id=?', a.id)?.invite_hash, inviteHash(a.inviteCode));
  assert.equal(joinTournament(stranger, a.inviteCode).role, 'player');
  assert.equal(joinTournament(stranger, a.inviteCode).role, 'player');
  assert.throws(() => requireCommissioner(stranger, a.id), {status: 403});
  assert.equal(requireCommissioner(owner, a.id).role, 'commissioner');
  const changed = rotateInvite(owner, a.id);
  assert.notEqual(changed.inviteCode, a.inviteCode);
  assert.throws(() => joinTournament(other, a.inviteCode), {status: 404});
  assert.equal(joinTournament(other, changed.inviteCode).id, a.id);
  const now = new Date().toISOString();
  run('INSERT INTO seasons(id,year,name,tournament_id,sprint_mode,currency,base_entry_cents,small_max,medium_max,preseason_lock,salvage_start,salvage_end,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', 'year-a', 2027, 'A', a.id, 'two-form', 'EUR', 1000, 5, 10, now, now, now, now);
  run('INSERT INTO seasons(id,year,name,tournament_id,sprint_mode,currency,base_entry_cents,small_max,medium_max,preseason_lock,salvage_start,salvage_end,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', 'year-b', 2027, 'B', b.id, 'two-form', 'EUR', 1000, 5, 10, now, now, now, now);
  assert.equal(requireSeasonMember(stranger, 'year-a').id, 'year-a');
  assert.throws(() => requireSeasonMember(stranger, 'year-b'), {status: 404});
  assert.throws(() => requireSeasonCommissioner(stranger, 'year-a'), {status: 403});
  assert.equal(requireSeasonCommissioner(owner, 'year-a').id, 'year-a');
});

test.after(() => rmSync(dir, {recursive: true, force: true}));
