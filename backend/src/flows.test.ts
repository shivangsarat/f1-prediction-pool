import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const dir = mkdtempSync(join(tmpdir(), 'gridlock-endpoints-'));
process.env.DB_PATH = join(dir, 'flows.sqlite');
process.env.NODE_ENV = 'test';
process.env.MAIL_PROVIDER = 'none';
process.env.ADMIN_EMAIL = 'operator@gmail.com';
process.env.ADMIN_BOOTSTRAP_KEY = 'long-separate-admin-bootstrap-key';
const {app} = await import('./server.ts');
const address = await new Promise<any>(resolve => app.listen(0, '127.0.0.1', () => resolve(app.address())));
const origin = `http://127.0.0.1:${address.port}`;

/** Send same-origin API requests, retaining cookies for each independent account. */
async function call(path: string, method = 'GET', payload?: unknown, cookie = '') {
  const response = await fetch(origin + '/api' + path, {
    method,
    headers: {'Origin': origin, ...(payload ? {'Content-Type': 'application/json'} : {}), ...(cookie ? {'Cookie': cookie} : {})},
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  return {status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] ?? ''};
}

/** Run the complete public/private discovery and operator/commissioner permission boundary. */
test('public catalogue, direct invites, deep link preview and operator cross-pool amendments', async () => {
  const guestCatalog = await call('/catalogue');
  assert.equal(guestCatalog.status, 200);
  assert.deepEqual(guestCatalog.data, []);
  const operatorReg = await call('/auth/register', 'POST', {email: 'operator@gmail.com', name: 'Operator', username: 'platform_operator', password: 'long-and-unique-password', bootstrapKey: 'long-separate-admin-bootstrap-key'});
  assert.equal(operatorReg.status, 201);
  const operatorCookie = operatorReg.cookie;
  assert.equal(operatorReg.data.user.role, 'admin');
  const owner = await call('/auth/register', 'POST', {email: 'owner@example.test', name: 'Owner', username: 'commissioner_55', password: 'long-and-unique-password'});
  const ownerCookie = owner.cookie;
  const invited = await call('/auth/register', 'POST', {email: 'driver@example.test', name: 'Driver', username: 'driver44', password: 'long-and-unique-password'});
  const invitedCookie = invited.cookie;
  const privatePool = await call('/tournaments', 'POST', {name: 'Hidden Summer Cup', description: 'Private league', visibility: 'invite_only'}, ownerCookie);
  const publicPool = await call('/tournaments', 'POST', {name: 'World Public Cup', description: 'Public league', visibility: 'public'}, ownerCookie);
  assert.equal(privatePool.status, 201);
  assert.equal(publicPool.status, 201);
  assert.equal((await call('/catalogue')).data.length, 1);
  assert.equal((await call('/catalogue?q=hidden')).data.length, 0);
  assert.equal((await call(`/invite-preview/${privatePool.data.inviteCode}`)).data.name, privatePool.data.name);
  assert.equal((await call(`/tournaments/${privatePool.data.id}`, 'GET', undefined, invitedCookie)).status, 404);
  assert.equal((await call(`/tournaments/${privatePool.data.id}`, 'GET', undefined, operatorCookie)).status, 200);
  assert.equal((await call('/tournaments', 'GET', undefined, invitedCookie)).data.length, 0);
  assert.equal((await call('/tournaments', 'GET', undefined, operatorCookie)).data.length, 2);
  assert.equal((await call('/tournaments/join-public', 'POST', {tournamentId: privatePool.data.id}, invitedCookie)).status, 404);
  assert.equal((await call('/tournaments/join-public', 'POST', {tournamentId: publicPool.data.id}, invitedCookie)).status, 200);
  assert.equal((await call(`/tournaments/${privatePool.data.id}/users?q=driv`, 'GET', undefined, ownerCookie)).data[0].username, 'driver44');
  assert.equal((await call(`/tournaments/${privatePool.data.id}/users?q=driv`, 'GET', undefined, invitedCookie)).status, 404);
  const pending = await call(`/tournaments/${privatePool.data.id}/invite-user`, 'POST', {userId: invited.data.user.id}, ownerCookie);
  assert.equal(pending.status, 201);
  const inbox = await call('/invitations', 'GET', undefined, invitedCookie);
  assert.equal(inbox.data.length, 1);
  assert.equal((await call('/invitations', 'GET', undefined, operatorCookie)).data.length, 0);
  assert.equal((await call(`/invitations/${inbox.data[0].id}/respond`, 'POST', {action: 'accept'}, ownerCookie)).status, 404);
  const accepted = await call(`/invitations/${inbox.data[0].id}/respond`, 'POST', {action: 'accept'}, invitedCookie);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.data.role, 'player');
  assert.equal((await call(`/tournaments/${privatePool.data.id}`, 'PATCH', {visibility: 'public'}, invitedCookie)).status, 403);
  const changed = await call(`/tournaments/${privatePool.data.id}`, 'PATCH', {visibility: 'public'}, operatorCookie);
  assert.equal(changed.status, 200);
  assert.equal((await call('/catalogue')).data.length, 2);
  assert.equal((await call(`/tournaments/${privatePool.data.id}`, 'PATCH', {status: 'archived'}, ownerCookie)).status, 200);
  assert.equal((await call('/catalogue')).data.length, 1);
  const mail = await call('/admin/mail', 'GET', undefined, operatorCookie);
  assert.equal(mail.status, 200);
  assert.equal(mail.data.provider, 'none');
  assert.equal((await call('/admin/mail', 'GET', undefined, ownerCookie)).status, 403);
  assert.equal((await call('/auth/verify-email?token=invalid')).status, 400);
  assert.equal((await call('/account/notifications', 'PATCH', {enabled: false}, invitedCookie)).status, 200);
});

test.after(async () => {
  await new Promise<void>(resolve => app.close(() => resolve()));
  rmSync(dir, {recursive: true, force: true});
});
