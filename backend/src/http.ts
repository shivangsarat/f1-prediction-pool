import {createHash, randomUUID} from 'node:crypto';
import {isIP} from 'node:net';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {bad, HttpError} from './auth.ts';
import {get, run} from './db.ts';

/** Parse a JSON request body with a strict 256 KiB size limit. */
export async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {

  if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {

    throw new HttpError(415, 'Content-Type must be application/json');
  }
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const raw of req) {

    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    bytes += chunk.length;
    if (bytes > 262144) throw new HttpError(413, 'Request body too large');
    chunks.push(chunk)
  }
  if (!bytes) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('Object required');
    return parsed;
  }
  catch {
    throw bad('Expected a JSON object')
  }
}

/** Enforce same-origin browser writes to prevent cross-site cookie authentication. */
export function assertSameOrigin(req: IncomingMessage): void {

  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method ?? '')) return;
  const origin = req.headers.origin;
  // CLI/automation Bearer requests are not CSRF-vulnerable; cookie requests require Origin.
  if (!req.headers.cookie && req.headers.authorization?.startsWith('Bearer ')) return;
  if (!origin) throw new HttpError(403, 'Origin required for state-changing requests');
  const allowed = process.env.PUBLIC_ORIGIN;
  let normalized: string;
  try {
    normalized = new URL(origin).origin;
  } catch {
    throw new HttpError(403, 'Invalid Origin')
  }
  const requestHost = String(req.headers.host ?? '');
  const matchesPublicOrigin = allowed
    ? normalized === new URL(allowed).origin
    : new URL(normalized).host === requestHost;
  // In development Vite serves the UI on :5173 and forwards /api to loopback :3001.
  // Some proxy configurations rewrite Host to the API target. Only the known
  // loopback UI origins are exempt, and NEVER outside explicit development mode.
  const localViteOrigin = process.env.NODE_ENV === 'development' &&
    (normalized === 'http://localhost:5173' || normalized === 'http://127.0.0.1:5173') &&
    ['localhost:5173', '127.0.0.1:5173', 'localhost:3001', '127.0.0.1:3001'].includes(requestHost);
  if (!matchesPublicOrigin && !localViteOrigin) {
    throw new HttpError(403, 'Cross-origin request blocked');
  }
  if (req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'Cross-site request blocked');
}

/** Attach baseline hardening headers for JSON and static responses. */
export function securityHeaders(res: ServerResponse): void {

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

/** Emit a JSON response without allowing shared intermediary caching. */
export function sendJson(res: ServerResponse, status: number, data: unknown): void {

  res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
  res.end(JSON.stringify(data));
}

/** Record an auditable tournament-scoped action, resolving the owning entity. */
export function writeAudit(actorId: string, action: string, entityId: string, note = '', details: unknown = {}): void {

  const t = get('SELECT id FROM tournaments WHERE id=?', entityId)?.id ??
    get('SELECT tournament_id FROM seasons WHERE id=?', entityId)?.tournament_id ??
    get('SELECT s.tournament_id FROM weekends w JOIN seasons s ON s.id=w.season_id WHERE w.id=?', entityId)?.tournament_id ??
    get('SELECT s.tournament_id FROM ledger l JOIN seasons s ON s.id=l.season_id WHERE l.id=?', entityId)?.tournament_id ?? null;
  run('INSERT INTO audit VALUES(?,?,?,?,?,?,?,?)', randomUUID(), actorId, action, entityId, note, JSON.stringify(details), new Date().toISOString(), t);
}

/** Compute the digest of canonical, serialized JSON for replay detection. */
export function jsonDigest(json: string): string {
  return createHash('sha256').update(json).digest('hex')
}

/**
 * Resolve the real client address for abuse controls. Trust X-Real-IP only behind
 * the private nginx proxy, which overwrites this field for incoming requests.
 * @param req - HTTP request originating from a direct client or trusted proxy.
 */
export function clientIp(req: IncomingMessage): string {

  const direct = req.socket.remoteAddress ?? 'unknown';
  const forwarded = req.headers['x-real-ip'];
  if (process.env.TRUST_PROXY === '1' && typeof forwarded === 'string' && isIP(forwarded)) return forwarded;
  return direct;
}
