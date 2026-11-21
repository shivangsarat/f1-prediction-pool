import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {IncomingMessage, ServerResponse} from 'node:http';

const tmp = mkdtempSync(join(tmpdir(), 'gridlock-http-'));
process.env.DB_PATH = join(tmp, 'http.sqlite'); process.env.NODE_ENV = 'test';
const {readJson, assertSameOrigin, securityHeaders, sendJson, jsonDigest, writeAudit, clientIp} = await import('./http.ts');
const {get} = await import('./db.ts');

/** Construct a minimal readable request for the JSON parser. */
function message(body: string, headers: Record<string, string> = {'content-type': 'application/json'}) {

  return {    
headers,
    /** Yield the serialized request body as an async source for the parser. */
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(body)
    }
  } as unknown as IncomingMessage;
}

/** Parse only JSON objects, rejecting invalid syntax and oversized bodies. */
test('readJson body handling', async () => {

  assert.deepEqual(await readJson(message('{"ok":true}')), {ok: true});
  await assert.rejects(readJson(message('[]')), {status: 400});
  await assert.rejects(readJson(message('{oops')), {status: 400});
  await assert.rejects(readJson(message('{}', {'content-type': 'text/plain'})), {status: 415});
  await assert.rejects(readJson(message('x'.repeat(262145))), {status: 413});
});

/** Block browser cross-site writes while allowing same-origin requests. */
test('assertSameOrigin CSRF checks', () => {

  const req = {method: 'POST', headers: {host: 'race.example.test', origin: 'https://race.example.test'}} as IncomingMessage;
  assert.doesNotThrow(() => assertSameOrigin(req));
  assert.throws(() => assertSameOrigin({...req, headers: {host: 'race.example.test', origin: 'https://evil.example.test'}} as IncomingMessage), {status: 403});
  assert.throws(() => assertSameOrigin({...req, headers: {host: 'race.example.test'}} as IncomingMessage), {status: 403});
  assert.doesNotThrow(() => assertSameOrigin({...req, headers: {authorization: 'Bearer test'}} as IncomingMessage));
});

/** Response headers prevent caching and MIME sniffing; JSON is serialized explicitly. */
test('securityHeaders and sendJson', () => {

  const headers: Record<string, any> = {};
  let body = '';
  const response = {    
setHeader: (key: string, value: any) => headers[key] = value, writeHead: (status: number, data: any) => {
      headers.status = status;
      Object.assign(headers, data)
    }, end: (value: string) => body = value  
} as ServerResponse;
  securityHeaders(response);
  sendJson(response, 201, {saved: true});
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['Cache-Control'], 'no-store');
  assert.equal(headers.status, 201);
  assert.deepEqual(JSON.parse(body), {saved: true});
});

/** Audit writes resolve tournament ownership; digests are deterministic. */
test('writeAudit and jsonDigest', () => {

  assert.equal(jsonDigest('test'), jsonDigest('test'));
  assert.notEqual(jsonDigest('test'), jsonDigest('different'));
  writeAudit('system', 'audit.test', 'entity-1');
  assert.equal(get("SELECT action FROM audit WHERE entity_id='entity-1'")?.action, 'audit.test');
});

test.after(() => rmSync(tmp, {recursive: true, force: true}));

/** Ensure rate limiting uses the real IP only when nginx is configured as trusted. */
test('clientIp proxy trust', () => {

  const req = {headers: {'x-real-ip': '198.51.100.8'}, socket: {remoteAddress: '127.0.0.1'}} as unknown as IncomingMessage;
  const prev = process.env.TRUST_PROXY;
  try {

    delete process.env.TRUST_PROXY;
    assert.equal(clientIp(req), '127.0.0.1');
    process.env.TRUST_PROXY = '1';
    assert.equal(clientIp(req), '198.51.100.8');
    assert.equal(clientIp({...req, headers: {'x-real-ip': 'malformed'}} as IncomingMessage), '127.0.0.1');
  } finally {

    if (prev === undefined) delete process.env.TRUST_PROXY; else process.env.TRUST_PROXY = prev;
  }
});
