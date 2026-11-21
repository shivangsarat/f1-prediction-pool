import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'gridlock-email-'));
process.env.DB_PATH = join(tmp, 'mail.sqlite');
process.env.NODE_ENV = 'test';
process.env.MAIL_PROVIDER = 'brevo';
process.env.MAIL_ENCRYPTION_KEY = 'bc'.repeat(32);
const {register} = await import('./auth.ts');
const {get, run} = await import('./db.ts');
const {safeMailText, publicUrl, gmailRawMessage, encryptMail, decryptMail, mailProvider, queueNotification, requestEmailVerification, confirmEmail, mailStatus, reconcileDeadlineEmails, drainEmailOutbox} = await import('./email.ts');
const user = register('notifications@example.test', 'Mail User', 'long-unique-password-123').user;

/** Ensure the configured provider is selected without needing its proprietary SDK. */
test('mailProvider exposes the configured provider', () => assert.equal(mailProvider(), 'brevo'));

/** Strip control characters and reject oversized bodies before queuing mail. */
test('safeMailText checks lengths and invalid controls', () => {
  assert.equal(safeMailText('hello'), 'hello');
  assert.throws(() => safeMailText('a\0b'), {status: 400});
  assert.throws(() => safeMailText('too long', 3), {status: 400});
});

/** Ensure no raw verification token survives inside an SQLite outbox message. */
test('AES-GCM encryption/decryption does not reveal plaintext and detects tampering', () => {
  const ciphertext = encryptMail('secret join link');
  assert.equal(ciphertext.includes('secret join link'), false);
  assert.equal(decryptMail(ciphertext), 'secret join link');
  const parts = ciphertext.split(':');
  parts[3] = (parts[3][0] === 'A' ? 'B' : 'A') + parts[3].slice(1); // Auth tag mutation always differs.
  assert.throws(() => decryptMail(parts.join(':')));
});

/** Encode a UTF-8 message with CRLF headers and avoid unencoded non-ASCII subjects. */
test('Gmail MIME builder uses base64url and safe headers', () => {
  const raw = gmailRawMessage('player@example.test', 'operator@gmail.com', 'Race résultats', 'Your results\n#1');
  const mime = Buffer.from(raw, 'base64url').toString();
  assert.match(mime, /To: player@example\.test\r\nFrom: operator@gmail.com/);
  assert.match(mime, /Subject: =\?UTF-8\?B\?/);
  assert.match(mime, /Content-Transfer-Encoding: base64/);
  assert.throws(() => gmailRawMessage('x\nBcc: other@example.test', 'operator@gmail.com', 'test', 'body'));
});

/** Issue and consume one-time email proof, including expiry and replay defense. */
test('verification email tokens are hashed, expiring, one-time and throttled', () => {
  requestEmailVerification(user);
  const queued = get('SELECT body FROM email_outbox WHERE event_key LIKE ?', 'verify:%');
  assert.ok(queued?.body.startsWith('enc:'));
  const body = decryptMail(queued!.body);
  const token = /\?verify=([A-Za-z0-9_-]{43})/.exec(body)?.[1];
  assert.ok(token);
  assert.equal(confirmEmail(token!), true);
  assert.equal(confirmEmail(token!), false);
  assert.ok(get('SELECT email_verified_at FROM users WHERE id=?', user.id)?.email_verified_at);
});

/** Queue only verified opt-in users, with event-id deduplication across retries/restarts. */
test('notification queue does not reveal addresses and deduplicates event keys', () => {
  const event = `unit-event:${user.id}`;
  assert.equal(queueNotification(user.id, event, null, 'Race completed', 'Confidential result'), true);
  assert.equal(queueNotification(user.id, event, null, 'Race completed', 'Confidential result'), false);
  assert.equal(get('SELECT COUNT(*) AS count FROM email_outbox WHERE event_key=?', event)?.count, 1);
  const row = get('SELECT body FROM email_outbox WHERE event_key=?', event);
  assert.equal(decryptMail(row!.body), 'Confidential result');
  run('UPDATE users SET notification_opt_in=0 WHERE id=?', user.id);
  assert.equal(queueNotification(user.id, 'disabled', null, 'Test', 'Body'), false);
  run('UPDATE users SET notification_opt_in=1 WHERE id=?', user.id);
  assert.ok(mailStatus().pending >= 2);
});

/** Reconcile without queuing unrelated users or performing mail delivery when nothing is due. */
test('reconcileDeadlineEmails skips future events', () => {
  assert.equal(reconcileDeadlineEmails(), 0);
});

/** A provider-neutral scheduler returns promptly when delivery is explicitly disabled. */
test('outbox delivery is inert when not configured', async () => {
  const previous = process.env.MAIL_PROVIDER;
  process.env.MAIL_PROVIDER = 'none';
  try {assert.deepEqual(await drainEmailOutbox(), {sent: 0, failed: 0});}
  finally {process.env.MAIL_PROVIDER = previous;}
});

/** Avoid accidental localhost links when APP_PUBLIC_URL is explicitly configured. */
test('publicUrl strips trailing slash', () => {
  process.env.APP_PUBLIC_URL = 'https://gridlock.example/';
  try {assert.equal(publicUrl(), 'https://gridlock.example');}
  finally {delete process.env.APP_PUBLIC_URL;}
});

/** Exercise OAuth Gmail send against a stubbed fetch, never using real credentials. */
test('sendMail submits Gmail API MIME using refreshed OAuth credentials', async () => {
  const {sendMail} = await import('./email.ts');
  const previousFetch = globalThis.fetch, previousProvider = process.env.MAIL_PROVIDER;
  const previousFrom = process.env.MAIL_FROM;
  process.env.MAIL_PROVIDER = 'gmail';
  process.env.MAIL_FROM = 'operator@gmail.com';
  process.env.GMAIL_CLIENT_ID = 'client-id';
  process.env.GMAIL_CLIENT_SECRET = 'not-a-real-secret';
  process.env.GMAIL_REFRESH_TOKEN = 'not-a-real-refresh-token';
  const requests: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request, options?: RequestInit) => {
    requests.push(String(url));
    if (String(url).includes('oauth2.googleapis.com')) return new Response(JSON.stringify({access_token: 'temporary-access-token'}), {status: 200});
    assert.equal(options?.headers && (options.headers as Record<string, string>).Authorization, 'Bearer temporary-access-token');
    const payload = JSON.parse(String(options?.body));
    assert.match(Buffer.from(payload.raw, 'base64url').toString(), /To: notifications@example.test/);
    return new Response(JSON.stringify({id: 'queued-test-message'}), {status: 200});
  }) as typeof fetch;
  try {
    await sendMail('notifications@example.test', 'Race results', 'Congratulations!');
    assert.equal(requests.length, 2);
    assert.ok(requests[0].includes('oauth2.googleapis.com'));
    assert.ok(requests[1].includes('gmail.googleapis.com'));
  } finally {
    globalThis.fetch = previousFetch;
    process.env.MAIL_PROVIDER = previousProvider;
    process.env.MAIL_FROM = previousFrom;
    delete process.env.GMAIL_CLIENT_ID;
    delete process.env.GMAIL_CLIENT_SECRET;
    delete process.env.GMAIL_REFRESH_TOKEN;
  }
});

/** Validate Brevo's API envelope against a stubbed provider without sending email. */
test('sendMail supports Brevo transactional messages', async () => {
  const {sendMail} = await import('./email.ts');
  const previousFetch = globalThis.fetch;
  process.env.MAIL_PROVIDER = 'brevo'; process.env.MAIL_FROM = 'notifications@example.test';
  process.env.BREVO_API_KEY = 'dummy-key';
  globalThis.fetch = (async (url: string | URL | Request, options?: RequestInit) => {
    assert.equal(String(url), 'https://api.brevo.com/v3/smtp/email');
    assert.equal((options?.headers as Record<string, string>)['api-key'], 'dummy-key');
    const envelope = JSON.parse(String(options?.body));
    assert.equal(envelope.to[0].email, 'notifications@example.test');
    return new Response('{}', {status: 201});
  }) as typeof fetch;
  try {await sendMail('notifications@example.test', 'Race day', 'Good luck');}
  finally {globalThis.fetch = previousFetch; delete process.env.BREVO_API_KEY; delete process.env.MAIL_FROM;}
});

/** A queued post-lock message distinguishes absent ballots and replays idempotently. */
test('reconcileDeadlineEmails emits one absent-submission and public-reveal email', () => {
  const tid = 'mail-league', sid = 'mail-season', wid = 'mail-weekend';
  const past = new Date(Date.now() - 3600000).toISOString();
  const older = new Date(Date.now() - 86400000).toISOString();
  const future = new Date(Date.now() + 86400000).toISOString();
  run(`INSERT INTO tournaments(id,name,description,owner_id,invite_hash,created_at,visibility,status)
    VALUES(?,?,?,?,?,?,'invite_only','active')`, tid, 'Mail League', '', user.id, 'unique-mail-invite', older);
  run('INSERT INTO tournament_members VALUES(?,?,?,?)', tid, user.id, 'commissioner', older);
  run(`INSERT INTO seasons(id,year,name,tournament_id,sprint_mode,currency,base_entry_cents,small_max,medium_max,preseason_lock,salvage_start,salvage_end,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, sid, 2026, 'Mail Season', tid, 'two-form', 'EUR', 1000, 5, 10, older, older, future, older);
  run(`INSERT INTO weekends(id,season_id,round,name,is_sprint,qualifying_at,race_at,created_at)
    VALUES(?,?,?,?,?,?,?,?)`, wid, sid, 1, 'Mail GP', 0, past, future, older);
  assert.equal(reconcileDeadlineEmails(), 1);
  assert.equal(reconcileDeadlineEmails(), 0);
  const row = get('SELECT body FROM email_outbox WHERE event_key=?', `locked:${wid}:gp:${user.id}`);
  assert.ok(row);
  assert.match(decryptMail(row.body), /did not submit/i);
  assert.match(decryptMail(row.body), /now visible/i);
});

/** Sprint forms notify at sprint qualifying even when GP qualifying is still in the future. */
test('reconcileDeadlineEmails observes independent sprint and GP lock deadlines', () => {
  const past = new Date(Date.now() - 1800000).toISOString(), future = new Date(Date.now() + 1800000).toISOString();
  const older = new Date(Date.now() - 86400000).toISOString();
  run(`INSERT INTO weekends(id,season_id,round,name,is_sprint,qualifying_at,sprint_qualifying_at,race_at,created_at)
    VALUES(?,?,?,?,?,?,?,?,?)`, 'mail-sprint', 'mail-season', 2, 'Mail Sprint', 1, future, past, future, older);
  assert.equal(reconcileDeadlineEmails(), 1);
  assert.ok(get('SELECT 1 FROM email_outbox WHERE event_key=?', `locked:mail-sprint:sprint:${user.id}`));
  assert.equal(get('SELECT 1 FROM email_outbox WHERE event_key=?', `locked:mail-sprint:gp:${user.id}`), undefined);
});

test.after(() => rmSync(tmp, {recursive: true, force: true}));
