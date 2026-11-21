import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import type {IncomingMessage, ServerResponse} from 'node:http';

const tmp = mkdtempSync(join(tmpdir(), 'gridlock-auth-'));
process.env.DB_PATH = join(tmp, 'auth.sqlite');
process.env.NODE_ENV = 'test';
const {passwordHash, checkPassword, tokenHash, register, login, auth, logout, rateLimit, recordFailedAttempt, setSessionCookie, clearSessionCookie, newSession} = await import('./auth.ts');
const {get} = await import('./db.ts');

/** Assert password hashes are salted and wrong passwords fail validation. */
test('password hash and constant-time verifier', () => {

  const one = passwordHash('a strong password'), two = passwordHash('a strong password');
  assert.notEqual(one, two);
  assert.ok(checkPassword('a strong password', one));
  assert.equal(checkPassword('wrong', one), false);
  assert.equal(checkPassword('anything', 'not-valid'), false);
});

/** Assert random tokens are stored only as SHA-256 digests. */
test('session digest and durable token lookup', () => {

  assert.equal(tokenHash('secret').length, 64);
  const u = register('auth@test.invalid', 'Auth User', 'a sufficiently long password');
  assert.equal(get('SELECT COUNT(*) AS n FROM sessions WHERE user_id=?', u.user.id)?.n, 1);
  assert.equal(get('SELECT * FROM sessions WHERE token_hash=?', u.token), undefined);
  const next = newSession(u.user.id);
  assert.notEqual(next.token, u.token);
  const req = {headers: {cookie: `f1pool_session=${u.token}`}} as IncomingMessage;
  assert.equal(auth(req).id, u.user.id);
  logout(req);
  assert.throws(() => auth(req), {status: 401});
});

/** Test authentication failures and persistence-backed account rate limiting. */
test('login rejects guessing and eventually returns 429', () => {

  for (let n = 0; n < 8; n++)assert.throws(() => login('auth@test.invalid', 'wrongpass', '198.51.100.7'), {status: 401});
  assert.throws(() => login('auth@test.invalid', 'wrongpass', '198.51.100.7'), {status: 429});
  assert.equal(login('auth@test.invalid', 'a sufficiently long password', '198.51.100.8').user.email, 'auth@test.invalid');
});

/** Check the generic persisted request limiter independently of login. */
test('rate limiter measures hashed failures', () => {

  rateLimit('test-key', 1);
  recordFailedAttempt('test-key');
  assert.throws(() => rateLimit('test-key', 1), {status: 429});
});

/** Ensure sessions are sent as HttpOnly, SameSite cookies and can be revoked. */
test('session cookie creation and clearing', () => {

  const state = new Map<string, string>();
  const response = {setHeader: (k: string, v: string) => state.set(k, v)} as ServerResponse;
  setSessionCookie(response, 'fake');
  assert.match(state.get('Set-Cookie') ?? '', /HttpOnly; SameSite=Strict/);
  clearSessionCookie(response);
  assert.match(state.get('Set-Cookie') ?? '', /Max-Age=0/);
});

test.after(() => rmSync(tmp, {recursive: true, force: true}));
