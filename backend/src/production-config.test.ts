import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'gridlock-origin-'));
process.env.NODE_ENV = 'test';
process.env.DB_PATH = join(dir, 'pool.sqlite');
const {validateProductionConfig} = await import('./server.ts');

/** Explicit production HTTPS origin prevents Host-header-controlled CSRF fallbacks. */
test('production configuration requires safe HTTPS origin', () => {
  const base = {NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://pool.example.test', MAIL_PROVIDER: 'none'};
  assert.doesNotThrow(() => validateProductionConfig(base));
  assert.throws(() => validateProductionConfig({...base, PUBLIC_ORIGIN:''}), /PUBLIC_ORIGIN/);
  assert.throws(() => validateProductionConfig({...base, PUBLIC_ORIGIN:'http://pool.example.test'}), /HTTPS/);
  assert.throws(() => validateProductionConfig({...base, PUBLIC_ORIGIN:'https://pool.example.test/redirect'}), /HTTPS/);
  assert.doesNotThrow(() => validateProductionConfig({...base, MAIL_PROVIDER:'gmail', APP_PUBLIC_URL:'https://pool.example.test'}));
  assert.throws(() => validateProductionConfig({...base, MAIL_PROVIDER:'gmail', APP_PUBLIC_URL:'http://localhost:5173'}), /APP_PUBLIC_URL/);
});

test.after(() => rmSync(dir, {recursive: true, force: true}));
