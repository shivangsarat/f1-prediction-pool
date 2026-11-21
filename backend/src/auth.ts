import {createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual} from 'node:crypto';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {get, run, transaction} from './db.ts';

/** Represent an HTTP error with an explicit, safe-to-disclose status and message. */
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Report invalid request data without exposing implementation details. */
export const bad = (message: string) => new HttpError(400, message);

/** Report authorization failure for an authenticated account. */
export const forbidden = (message = 'Forbidden') => new HttpError(403, message);

/** Hash passwords using a unique random salt and the memory-hard scrypt KDF. */
export function passwordHash(password: string): string {

  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}

/** Compare a password against its saved hash in constant time on equal length hashes. */
export function checkPassword(password: string, stored: string): boolean {

  try {

    const [salt, hash] = stored.split(':');
    if (!salt || !/^[a-f0-9]{128}$/.test(hash)) return false;
    const candidate = scryptSync(password, salt, 64), actual = Buffer.from(hash, 'hex');
    return timingSafeEqual(candidate, actual);
  } catch {
    return false
  }
}

/** Store only a SHA-256 digest of random session tokens, never plaintext. */
export function tokenHash(token: string): string {

  return createHash('sha256').update(token).digest('hex');
}

/** Internal authenticated-user representation; never includes password hashes. */
export type User = {id: string; email: string; display_name: string; role: string};

/** Create an expiring, random session persisted in SQLite. */
export function newSession(userId: string) {

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + 7 * 86400_000).toISOString();
  run('DELETE FROM sessions WHERE expires_at<=?', new Date().toISOString());
  run('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)', tokenHash(token), userId, expiresAt);
  return {token, expiresAt};
}

/** Rate-limit by a hashed combination of remote socket IP, route, and account identifier. */
export function rateLimit(key: string, limit = 8, minutes = 15): void {

  const digest = tokenHash(key), since = new Date(Date.now() - minutes * 60000).toISOString();
  run('DELETE FROM auth_attempts WHERE occurred_at<?', since);
  const count = get('SELECT COUNT(*) AS n FROM auth_attempts WHERE key_hash=? AND occurred_at>=?', digest, since)?.n ?? 0;
  if (count >= limit) throw new HttpError(429, 'Too many attempts. Please retry later.');
}

/** Record a failed authentication attempt for durable abuse throttling. */
export function recordFailedAttempt(key: string): void {

  run('INSERT INTO auth_attempts VALUES(?,?)', tokenHash(key), new Date().toISOString());
}

/** Register a normal user, or optionally bootstrap the single global operator. */
export function register(email: string, name: string, password: string, bootstrapKey?: string) {

  email = typeof email === 'string' ? email.trim().toLowerCase() : '';
  name = typeof name === 'string' ? name.trim() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || name.length < 2 || name.length > 80 ||
    typeof password !== 'string' || password.length < 12 || password.length > 256) {

    throw bad('Valid email, name (2–80), and password (12–256 characters) required');
  }
  const isAdmin = email === process.env.ADMIN_EMAIL?.toLowerCase();
  if (isAdmin && (!process.env.ADMIN_BOOTSTRAP_KEY || bootstrapKey !== process.env.ADMIN_BOOTSTRAP_KEY)) {

    throw forbidden('Operator registration requires a valid bootstrap key');
  }
  const user: User = {id: randomUUID(), email, display_name: name, role: isAdmin ? 'admin' : 'participant'};
  try {

    return transaction(() => {

      run('INSERT INTO users VALUES(?,?,?,?,?,?)', user.id, email, name, passwordHash(password), user.role, new Date().toISOString());
      return {user, ...newSession(user.id)};
    });
  } catch (err) {

    if (/UNIQUE/.test(String(err))) throw new HttpError(409, 'Email already registered');
    throw err;
  }
}

/** Authenticate a user and rate-limit failed attempts in durable storage. */
export function login(email: string, password: string, remoteAddress = 'unknown') {

  const normalized = String(email ?? '').trim().toLowerCase();
  const key = `login:${remoteAddress}:${normalized}`;
  rateLimit(key);
  rateLimit(`login-ip:${remoteAddress}`, 32, 15);
  const row = get('SELECT * FROM users WHERE email=?', normalized);
  // Do similar KDF work for unknown accounts so account existence is less observable.
  const fallback = '00'.repeat(16) + ':' + '00'.repeat(64);
  if (!checkPassword(String(password ?? ''), row?.password_hash ?? fallback) || !row) {

    recordFailedAttempt(key);
    recordFailedAttempt(`login-ip:${remoteAddress}`);
    throw new HttpError(401, 'Incorrect email or password');
  }
  run('DELETE FROM auth_attempts WHERE key_hash=?', tokenHash(key));
  const user: User = {id: row.id, email: row.email, display_name: row.display_name, role: row.role};
  return {user, ...newSession(user.id)};
}

/** Extract a session from an HttpOnly cookie or a separately authorized CLI bearer token. */
export function auth(req: IncomingMessage): User {

  const cookies = String(req.headers.cookie ?? '').split(';').map(x => x.trim());
  const cookie = cookies.find(x => x.startsWith('f1pool_session='))?.slice('f1pool_session='.length);
  const bearer = /^Bearer ([A-Za-z0-9_-]+)$/i.exec(req.headers.authorization ?? '')?.[1];
  const token = cookie ?? bearer;
  if (!token || !/^[A-Za-z0-9_-]{40,100}$/.test(token)) throw new HttpError(401, 'Authentication required');
  const user = get(`SELECT u.id,u.email,u.display_name,u.role FROM users u JOIN sessions s ON s.user_id=u.id
    WHERE s.token_hash=? AND s.expires_at>?`, tokenHash(token), new Date().toISOString());
  if (!user) throw new HttpError(401, 'Session expired or invalid');
  return user as User;
}

/** Revoke the session token regardless of cookie or bearer transport. */
export function logout(req: IncomingMessage): void {

  const cookie = String(req.headers.cookie ?? '').split(';').map(x => x.trim()).find(x => x.startsWith('f1pool_session='))?.slice(15);
  const bearer = /^Bearer ([A-Za-z0-9_-]+)$/i.exec(req.headers.authorization ?? '')?.[1];
  const token = cookie ?? bearer;
  if (token) run('DELETE FROM sessions WHERE token_hash=?', tokenHash(token));
}

/** Set a SameSite Strict, HttpOnly session cookie; require TLS in production. */
export function setSessionCookie(res: ServerResponse, token: string): void {

  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `f1pool_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${secure}`);
}

/** Delete the browser cookie when a user logs out. */
export function clearSessionCookie(res: ServerResponse): void {

  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `f1pool_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`);
}
