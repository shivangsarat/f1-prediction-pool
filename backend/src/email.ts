import {createHash, randomBytes, randomUUID, createCipheriv, createDecipheriv} from 'node:crypto';
import {all, get, run, transaction} from './db.ts';
import {HttpError, bad, type User} from './auth.ts';

/** Transactional email providers supported without a paid SDK dependency. */
export type MailProvider = 'none' | 'gmail' | 'brevo' | 'resend';

/** Resolve the configured provider while disabling network side effects in automated tests. */
export function mailProvider(): MailProvider {
  const value = process.env.MAIL_PROVIDER ?? 'none';
  if (!['none', 'gmail', 'brevo', 'resend'].includes(value)) throw new Error('Invalid MAIL_PROVIDER');
  return value as MailProvider;
}

/** Bound and encode HTML-free message strings to prevent header injection and mail abuse. */
export function safeMailText(value: string, maxLength = 10000): string {
  const hasControlCharacters = [...value].some(char => {
    const code = char.charCodeAt(0);
    return code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31);
  });
  if (typeof value !== 'string' || value.length > maxLength || hasControlCharacters) {
    throw bad('Invalid notification text');
  }
  return value;
}

/** Validate an outbound email address independently of the registration endpoint. */
function validAddress(value: string): boolean {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value) && value.length < 255;
}

/** Return the public root used in emails; production requires a configured HTTPS URL. */
export function publicUrl(): string {
  const root = (process.env.APP_PUBLIC_URL ?? 'http://localhost:5173').replace(/\/$/, '');
  return root;
}

/** Resolve an at-rest encryption key for sensitive outgoing messages and one-time tokens. */
function mailEncryptionKey(): Buffer {
  const key = process.env.MAIL_ENCRYPTION_KEY ?? process.env.BACKUP_ENCRYPTION_KEY ?? '';
  if (!/^[a-fA-F0-9]{64}$/.test(key)) throw new Error('MAIL_ENCRYPTION_KEY or BACKUP_ENCRYPTION_KEY must be a 64-character hex key');
  return Buffer.from(key, 'hex');
}

/** Encrypt queued mail with AES-256-GCM so database copies do not reveal verification links. */
export function encryptMail(body: string): string {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', mailEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(body, 'utf8'), cipher.final()]);
  return `enc:v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${ciphertext.toString('base64url')}`;
}

/** Decrypt a queued mail only immediately before delivery; reject modified ciphertext. */
export function decryptMail(encrypted: string): string {
  const [prefix, version, iv, tag, body] = encrypted.split(':');
  if (prefix !== 'enc' || version !== 'v1' || !iv || !tag || !body) throw new Error('Invalid encrypted mail envelope');
  const decipher = createDecipheriv('aes-256-gcm', mailEncryptionKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
}

/** Queue a deduplicated email only for an explicitly opted-in, verified recipient. */
export function queueNotification(userId: string, eventKey: string, tournamentId: string | null, subject: string, message: string): boolean {
  if (mailProvider() === 'none') return false;
  if (process.env.NODE_ENV === 'production' && !publicUrl().startsWith('https://')) throw new Error('APP_PUBLIC_URL must use HTTPS when email is enabled');
  const recipient = get('SELECT email,email_verified_at,notification_opt_in FROM users WHERE id=?', userId);
  if (!recipient?.email_verified_at || recipient.notification_opt_in !== 1 || !validAddress(recipient.email)) return false;
  const at = new Date().toISOString();
  const result = run(`INSERT OR IGNORE INTO email_outbox(id,event_key,user_id,tournament_id,subject,body,created_at,next_attempt_at)
    VALUES(?,?,?,?,?,?,?,?)`, randomUUID(), eventKey, userId, tournamentId,
    safeMailText(subject, 180).replace(/[\r\n]/g, ' '), encryptMail(safeMailText(message)), at, at);
  return result.changes > 0;
}

/** Queue a single-use account confirmation link without requiring a pre-verified email. */
export function requestEmailVerification(user: User): void {
  if (mailProvider() === 'none') throw new HttpError(503, 'Email delivery is not configured');
  if (process.env.NODE_ENV === 'production' && !publicUrl().startsWith('https://')) throw new HttpError(503, 'Email delivery URL not configured securely');
  const recipient = get('SELECT email_verified_at FROM users WHERE id=?', user.id);
  if (!recipient || recipient.email_verified_at) return;
  const since = new Date(Date.now() - 24 * 3600000).toISOString();
  const attempts = get('SELECT COUNT(*) AS count FROM email_verifications WHERE user_id=? AND created_at>?', user.id, since)?.count ?? 0;
  if (attempts >= 3) throw new HttpError(429, 'Email verification limit reached. Try tomorrow.');
  const token = randomBytes(32).toString('base64url'), at = new Date().toISOString();
  const expires = new Date(Date.now() + 24 * 3600000).toISOString();
  transaction(() => {
    run('INSERT INTO email_verifications VALUES(?,?,?,?)', createHash('sha256').update(token).digest('hex'), user.id, expires, at);
    run(`INSERT INTO email_outbox(id,event_key,user_id,tournament_id,subject,body,created_at,next_attempt_at)
      VALUES(?,?,?,?,?,?,?,?)`, randomUUID(), `verify:${user.id}:${at}`, user.id, null,
      'Verify your GRIDLOCK email', encryptMail(`Confirm your account email within 24 hours:\n${publicUrl()}/?verify=${encodeURIComponent(token)}\n\nIf you did not create an account, ignore this message.`), at, at);
  });
}

/** Validate a one-time emailed token and mark only its intended account verified. */
export function confirmEmail(code: string): boolean {
  if (!/^[A-Za-z0-9_-]{43}$/.test(code)) return false;
  return transaction(() => {
    const hash = createHash('sha256').update(code).digest('hex');
    const row = get('SELECT user_id FROM email_verifications WHERE token_hash=? AND expires_at>?', hash, new Date().toISOString());
    if (!row) return false;
    run('UPDATE users SET email_verified_at=? WHERE id=?', new Date().toISOString(), row.user_id);
    run('DELETE FROM email_verifications WHERE user_id=?', row.user_id);
    // Catch up new accounts that entered a competition before verifying their inbox.
    const memberships = all(`SELECT t.id,t.name FROM tournaments t JOIN tournament_members m ON m.tournament_id=t.id
      WHERE m.user_id=?`, row.user_id);
    for (const t of memberships) {
      try {
        queueNotification(row.user_id, `verified-member:${t.id}:${row.user_id}`, t.id,
          `Welcome to ${t.name}`, `Your verified email is now linked to this GRIDLOCK tournament.\n${publicUrl()}/?tournament=${t.id}`);
      } catch (error) {console.error('[EMAIL QUEUE]', (error as Error).message);}
    }
    return true;
  });
}

/** Create a bounded UTF-8 MIME payload for Gmail's raw-message API. */
export function gmailRawMessage(to: string, from: string, subject: string, body: string): string {
  if (!validAddress(to) || !validAddress(from)) throw new Error('Invalid email address');
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`;
  return Buffer.from(`To: ${to}\r\nFrom: ${from}\r\nSubject: ${encodedSubject}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(body).toString('base64')}\r\n`).toString('base64url');
}

/** Obtain a short-lived Gmail access token from an operator-owned OAuth refresh token. */
async function gmailAccessToken(): Promise<string> {
  const clientId = process.env.GMAIL_CLIENT_ID, clientSecret = process.env.GMAIL_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) throw new Error('Gmail OAuth credentials not configured');
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token'}),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Gmail authorization failed: ${response.status}`);
  const json = await response.json() as {access_token?: string};
  if (!json.access_token) throw new Error('Gmail did not return an access token');
  return json.access_token;
}

/** Deliver one plain-text transactional message over the selected provider's HTTPS API. */
export async function sendMail(to: string, subject: string, body: string): Promise<void> {
  const provider = mailProvider(), from = process.env.MAIL_FROM ?? '';
  if (provider === 'none') throw new Error('Email delivery is not configured');
  if (!validAddress(from) || !validAddress(to)) throw new Error('MAIL_FROM or recipient is invalid');
  let url = '';
  const headers: Record<string, string> = {'Content-Type': 'application/json'};
  let payload: unknown;
  if (provider === 'gmail') {
    url = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
    headers.Authorization = `Bearer ${await gmailAccessToken()}`;
    payload = {raw: gmailRawMessage(to, from, subject, body)};
  } else if (provider === 'brevo') {
    if (!process.env.BREVO_API_KEY) throw new Error('BREVO_API_KEY is required');
    url = 'https://api.brevo.com/v3/smtp/email';
    headers['api-key'] = process.env.BREVO_API_KEY;
    payload = {sender: {email: from, name: 'GRIDLOCK Race Control'}, to: [{email: to}], subject, textContent: body};
  } else {
    if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is required');
    url = 'https://api.resend.com/emails';
    headers.Authorization = `Bearer ${process.env.RESEND_API_KEY}`;
    payload = {from, to: [to], subject, text: body};
  }
  const response = await fetch(url, {method: 'POST',headers,body: JSON.stringify(payload), signal: AbortSignal.timeout(15000)});
  if (!response.ok) throw new Error(`${provider} delivery failed (HTTP ${response.status})`);
}

/** Atomically claim a pending email with a lease, send it, and persist its delivery state. */
export async function drainEmailOutbox(limit = 10): Promise<{sent: number; failed: number}> {
  if (mailProvider() === 'none') return {sent: 0, failed: 0};
  const now = new Date().toISOString(), lease = new Date(Date.now() + 60000).toISOString();
  const rows = transaction(() => {
    const jobs = all(`SELECT e.id,e.user_id,e.subject,e.body,u.email FROM email_outbox e JOIN users u ON u.id=e.user_id
      WHERE e.delivered_at IS NULL AND e.attempts<7 AND e.next_attempt_at<=?
      AND (e.claimed_until IS NULL OR e.claimed_until<=?) ORDER BY e.created_at LIMIT ?`, now, now, Math.min(limit, 50));
    for (const j of jobs) run('UPDATE email_outbox SET claimed_until=? WHERE id=?', lease, j.id);
    return jobs;
  });
  let sent = 0, failed = 0;
  for (const job of rows) {
    try {
      await sendMail(job.email, job.subject, decryptMail(job.body));
      run('UPDATE email_outbox SET delivered_at=?,claimed_until=NULL,last_error=NULL WHERE id=?', new Date().toISOString(), job.id);
      sent++;
    } catch (e) {
      const attempts = (get('SELECT attempts FROM email_outbox WHERE id=?', job.id)?.attempts ?? 0) + 1;
      const delay = Math.min(24 * 3600, 60 * 2 ** Math.min(attempts, 10));
      run('UPDATE email_outbox SET attempts=?,next_attempt_at=?,claimed_until=NULL,last_error=? WHERE id=?',
        attempts, new Date(Date.now() + delay * 1000).toISOString(), String((e as Error).message).slice(0, 200), job.id);
      failed++;
    }
  }
  return {sent, failed};
}

/** Queue deadline summaries after UTC locks, including missed forms, without relying on cron for lock integrity. */
export function reconcileDeadlineEmails(): number {
  const from = new Date(Date.now() - 14 * 86400000).toISOString(), now = new Date().toISOString();
  const weekends = all(`SELECT w.id,w.name,w.is_sprint,w.qualifying_at,w.sprint_qualifying_at,
    s.sprint_mode,s.tournament_id,t.name AS tournament_name FROM weekends w
    JOIN seasons s ON s.id=w.season_id JOIN tournaments t ON t.id=s.tournament_id
    WHERE (w.qualifying_at BETWEEN ? AND ? OR w.sprint_qualifying_at BETWEEN ? AND ?) AND t.status='active'`, from, now, from, now);
  let queued = 0;
  for (const w of weekends) {
    const forms = w.is_sprint ? (w.sprint_mode === 'one-form' ? [['unified',w.sprint_qualifying_at]] : [['sprint',w.sprint_qualifying_at],['gp',w.qualifying_at]]) : [['gp',w.qualifying_at]];
    for (const [form, deadline] of forms) {
      if (!deadline || deadline > now) continue;
      const members = all('SELECT user_id,joined_at FROM tournament_members WHERE tournament_id=? AND joined_at<=?', w.tournament_id, deadline);
      for (const member of members) {
        const submitted = !!get('SELECT 1 FROM submissions WHERE user_id=? AND weekend_id=? AND form=? LIMIT 1', member.user_id, w.id, form);
        if (queueNotification(member.user_id, `locked:${w.id}:${form}:${member.user_id}`, w.tournament_id,
          `${w.name}: ${form} picks are now public`,
          `${w.tournament_name} — ${w.name}\n${submitted ? 'Your submission is locked in.' : 'You did not submit this form before the deadline.'}\nAll participants’ submitted picks for this form are now visible inside the tournament.\n${publicUrl()}/?tournament=${w.tournament_id}`)) queued++;
      }
    }
  }
  return queued;
}

/** Report aggregate delivery status without revealing other users' email addresses. */
export function mailStatus() {
  return {provider: mailProvider(), pending: get('SELECT COUNT(*) AS n FROM email_outbox WHERE delivered_at IS NULL')?.n ?? 0,
    delivered: get('SELECT COUNT(*) AS n FROM email_outbox WHERE delivered_at IS NOT NULL')?.n ?? 0};
}
