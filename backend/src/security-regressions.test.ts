import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {IncomingMessage} from 'node:http';

const directory = mkdtempSync(join(tmpdir(), 'gridlock-security-'));
process.env.NODE_ENV = 'test';
process.env.DB_PATH = join(directory, 'db.sqlite');
const {register, login, validBootstrapKey} = await import('./auth.ts');
const {clientIp, trustedProxyPeer, readJson} = await import('./http.ts');

/** Validate secure comparison and minimum entropy for first-run global operator setup. */
test('operator bootstrap cannot use weak or incorrectly supplied secrets', () => {
  assert.equal(validBootstrapKey('short', 'short'), false);
  const key = 'a-secret-value-with-over-32-chars-012345';
  assert.equal(validBootstrapKey(key, key), true);
  assert.equal(validBootstrapKey(key + 'x', key), false);
  assert.equal(validBootstrapKey(null, key), false);
});

/** Prevent attacker-controlled oversized passwords from entering the expensive scrypt path. */
test('sign-in rejects oversized credentials without exhausting synchronous KDF work', () => {
  const user = register('security@example.test', 'Security Tester', 'correct-sufficiently-long-password');
  assert.equal(login('security@example.test','correct-sufficiently-long-password').user.id, user.user.id);
  assert.throws(() => login('security@example.test','x'.repeat(100_000)), {status: 401});
  assert.throws(() => login('a'.repeat(400), 'guess'), {status: 401});
});

/** Avoid CRLF and control characters in names interpolated into notification text. */
test('registration rejects names containing control characters', () => {
  assert.throws(() => register('control@example.test', 'Bad\nName', 'correct-sufficiently-long-password'), {status: 400});
});

/** A public client cannot spoof rate-limiting identity using X-Real-IP. */
test('reverse-proxy address is trusted only for internal Docker/loopback sockets', () => {
  assert.equal(trustedProxyPeer('172.18.0.3'), true);
  assert.equal(trustedProxyPeer('::ffff:127.0.0.1'), true);
  assert.equal(trustedProxyPeer('8.8.8.8'), false);
  assert.equal(trustedProxyPeer('172.40.0.1'), false);
  const before = process.env.TRUST_PROXY;
  try {
    process.env.TRUST_PROXY = '1';
    const request = (direct: string) => ({socket: {remoteAddress: direct}, headers: {'x-real-ip':'1.2.3.4'}} as unknown as IncomingMessage);
    assert.equal(clientIp(request('8.8.8.8')), '8.8.8.8');
    assert.equal(clientIp(request('172.18.0.3')), '1.2.3.4');
  } finally {
    if (before === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = before;
  }
});

/** Strict JSON Content-Type must not accept a malicious look-alike prefix. */
test('JSON parser rejects look-alike content types', async () => {
  const request = {headers:{'content-type':'application/json-malicious'}} as unknown as IncomingMessage;
  await assert.rejects(readJson(request), {status: 415});
});

/** Hide persistent account identifiers from anonymous discovery and secret-link previews. */
test('public catalogue and invitation preview omit owner account identifiers', async () => {
  const {createTournament, publicCatalogue, invitePreview} = await import('./tournaments.ts');
  const owner = register('catalog-owner@example.test', 'Catalogue Owner', 'correct-sufficiently-long-password').user;
  const pool = createTournament(owner, 'Open Privacy Cup', 'Public tournament', 'public');
  const listing = publicCatalogue().find(x => x.id === pool.id);
  assert.ok(listing);
  assert.equal(listing.owner_id, undefined);
  assert.equal(invitePreview(pool.inviteCode).owner_id, undefined);
});

test.after(() => rmSync(directory, {recursive: true, force: true}));
