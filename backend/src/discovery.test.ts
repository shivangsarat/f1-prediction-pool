import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'gridlock-discovery-'));
process.env.DB_PATH = join(dir, 'pools.sqlite');
process.env.NODE_ENV = 'test';
const {register, normalizeUsername} = await import('./auth.ts');
const {get} = await import('./db.ts');
const {createTournament, listTournaments, publicCatalogue, requireTournament, requireCommissioner, tournamentVisibility, joinPublicTournament, joinTournament, invitePreview, searchUsers, inviteExistingUser, myInvitations, respondInvitation, amendTournament, rotateInvite} = await import('./tournaments.ts');
const admin = register('operator@test.example', 'Platform Operator', 'secure-passphrase-operator', undefined, 'global_operator').user;
const owner = register('owner@test.example', 'Pool Owner', 'secure-passphrase-owner', undefined, 'my_league_owner').user;
const invited = register('invited@test.example', 'Invited User', 'secure-passphrase-invited', undefined, 'speedster_one').user;
const outsider = register('outsider@test.example', 'Outsider', 'secure-passphrase-outsider', undefined, 'rookie_other').user;
const globalOperator = {...admin, role: 'admin'};

/** Require safe usernames, unique regardless of case. */
test('normalizeUsername enforces safe searchable usernames', () => {
  assert.equal(normalizeUsername('  Lewis_44 '), 'lewis_44');
  assert.throws(() => normalizeUsername('a@b'), {status: 400});
  assert.throws(() => register('duplicate@test.example', 'Duplicate', 'long_password_for_duplicate', undefined, 'SPEEDSTER_ONE'), {status: 409});
});

/** Strict public/invite-only visibility inputs prevent unknown states. */
test('tournamentVisibility accepts the two supported modes only', () => {
  assert.equal(tournamentVisibility('public'), 'public');
  assert.equal(tournamentVisibility('invite_only'), 'invite_only');
  assert.throws(() => tournamentVisibility('unlisted'), {status: 400});
});

/** Hidden pools cannot be discovered or joined without the secret invite. */
test('catalogue contains active public pools only', () => {
  const privatePool = createTournament(owner, 'Private Race League', 'Members only', 'invite_only');
  const publicPool = createTournament(owner, 'Public Grid Championship', 'Open roster', 'public');
  assert.deepEqual(publicCatalogue().map(t => t.id), [publicPool.id]);
  assert.deepEqual(publicCatalogue('grid').map(t => t.id), [publicPool.id]);
  assert.deepEqual(publicCatalogue('private'), []);
  assert.throws(() => joinPublicTournament(outsider, privatePool.id), {status: 404});
  assert.throws(() => requireTournament(outsider, privatePool.id), {status: 404});
  assert.equal(invitePreview(privatePool.inviteCode).id, privatePool.id);
  assert.equal(joinTournament(outsider, privatePool.inviteCode).id, privatePool.id);
  assert.equal(invitePreview(publicPool.inviteCode).id, publicPool.id, 'public tournaments are also invite-accessible');
  assert.equal(joinTournament(outsider, publicPool.inviteCode).id, publicPool.id, 'public tournament join-by-link is supported');
  assert.equal(joinPublicTournament(invited, publicPool.id).id, publicPool.id);
  assert.equal(requireTournament(invited, publicPool.id).role, 'player');
  assert.throws(() => requireCommissioner(invited, publicPool.id), {status: 403});
  assert.ok(get('SELECT invite_hash FROM tournaments WHERE id=?', privatePool.id)?.invite_hash);
  const changed = rotateInvite(owner, privatePool.id);
  assert.throws(() => invitePreview(privatePool.inviteCode), {status: 404});
  assert.equal(invitePreview(changed.inviteCode).id, privatePool.id);
  amendTournament(owner, publicPool.id, {status: 'archived'});
  assert.equal(publicCatalogue().length, 0);
  assert.throws(() => joinPublicTournament(outsider, publicPool.id), {status: 404});
  assert.throws(() => invitePreview('invalid'), {status: 404});
});

/** A global operator has explicit cross-pool access without changing tournament memberships. */
test('operator can inspect and amend every tournament, but a normal account cannot', () => {
  const a = createTournament(owner, 'Operators World League', 'One', 'invite_only');
  const b = createTournament(outsider, 'Operators Other League', 'Two', 'invite_only');
  assert.ok(listTournaments(globalOperator).some(t => t.id === a.id));
  assert.ok(listTournaments(globalOperator).some(t => t.id === b.id));
  assert.equal(requireCommissioner(globalOperator, a.id).role, 'operator');
  assert.equal(requireCommissioner(globalOperator, b.id).role, 'operator');
  assert.throws(() => requireTournament(owner, b.id), {status: 404});
  assert.throws(() => amendTournament(owner, b.id, {name: 'Hacked'}), {status: 404});
  const updated = amendTournament(globalOperator, b.id, {name: 'Official Other League', visibility: 'public'});
  assert.equal(updated.name, 'Official Other League');
  assert.ok(publicCatalogue('official').some(t => t.id === b.id));
  assert.equal(get('SELECT COUNT(*) AS count FROM tournament_members WHERE user_id=?', globalOperator.id)?.count, 0);
});

/** Invitations cannot add users without their consent; inboxes remain private. */
test('username-based invites require explicit acceptance or decline', () => {
  const t = createTournament(owner, 'Invite User Pool', '', 'invite_only');
  const matches = searchUsers(owner, t.id, 'speed');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].username, 'speedster_one');
  assert.equal(matches[0].email, undefined);
  assert.throws(() => searchUsers(outsider, t.id, 'speed'), {status: 404});
  inviteExistingUser(owner, t.id, invited.id);
  assert.equal(myInvitations(outsider).length, 0);
  const invite = myInvitations(invited).find(i => i.tournament_id === t.id)!;
  assert.ok(invite);
  assert.throws(() => respondInvitation(outsider, invite.id, 'accept'), {status: 404});
  assert.throws(() => requireTournament(invited, t.id), {status: 404});
  assert.equal(respondInvitation(invited, invite.id, 'decline').status, 'declined');
  assert.equal(myInvitations(invited).length, 0);
  inviteExistingUser(owner, t.id, invited.id);
  const second = myInvitations(invited).find(i => i.tournament_id === t.id)!;
  assert.equal(respondInvitation(invited, second.id, 'accept').id, t.id);
  assert.equal(requireTournament(invited, t.id).role, 'player');
  assert.throws(() => inviteExistingUser(owner, t.id, invited.id), {status: 409});
});

test.after(() => rmSync(dir, {recursive: true, force: true}));
