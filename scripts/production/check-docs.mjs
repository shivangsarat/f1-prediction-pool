/**
 * Validate the production handbook's local links and security boundary in CI.
 * This source-only check never accesses the cloud, .env, users, or SQLite data.
 */
import {readFileSync, existsSync} from 'node:fs';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const pages = [
  'docs/production/README.md',
  'docs/production/SUPPORT_HANDBOOK.md',
  'docs/production/CODE_AND_CLOUD_MAP.md',
  'docs/production/DEPLOYMENT.md',
  'docs/production/INCIDENTS.md',
  'docs/production/BACKUP_RECOVERY.md',
  'docs/production/SECURITY_AND_SECRETS.md',
  'docs/production/RELEASE_CHECKLIST.md',
  'docs/production/V23_RELEASE_NOTES.md',
];

/** Return true for a local file hyperlink that resolves to a tracked source file. */
function validLocalLink(source, href) {
  const clean = href.split('#', 1)[0].split('?', 1)[0];
  if (!clean || /^(?:https?:|mailto:)/.test(clean)) return true;
  return existsSync(resolve(dirname(join(root, source)), decodeURIComponent(clean)));
}

let failures = 0;
for (const file of pages) {
  const markdown = readFileSync(join(root, file), 'utf8');
  const links = [...markdown.matchAll(/\]\(([^)]+)\)/g)].map(match => match[1]);
  for (const href of links) {
    if (!validLocalLink(file, href)) {
      console.error(`Broken handbook link in ${file}: ${href}`);
      failures++;
    }
  }
}
const compose = readFileSync(join(root, 'docker-compose.yml'), 'utf8');
if (!compose.includes("'127.0.0.1:${FRONTEND_PORT:-8081}:8080'") || /\n\s*ports:\s*\n\s*-\s*['"]?(?:3001|0\.0\.0\.0:3001)/.test(compose)) {
  console.error('Compose must use loopback port 8081 by default and not publish backend port 3001');
  failures++;
}
const deployment = readFileSync(join(root, '.github/workflows/deploy-production.yml'), 'utf8');
if (!/workflow_dispatch:/.test(deployment) || /\n\s+push:/.test(deployment)) {
  console.error('Production deployment workflow must be manual-only');
  failures++;
}
for (const [label, content] of pages.map(path => [path, readFileSync(join(root, path), 'utf8')])) {
  if (/134\.98\.131\.158|gridlockf1commissioner@gmail\.com|gridlockf1commissioner\b/i.test(content)) {
    console.error(`Private production identifier found in ${label}`);
    failures++;
  }
}
if (failures) {
  console.error(`${failures} production documentation/configuration checks failed.`);
  process.exitCode = 1;
} else {
  console.log(`Production documentation verified: ${pages.length} pages, local links, secret masking, loopback port, manual deploy.`);
}
