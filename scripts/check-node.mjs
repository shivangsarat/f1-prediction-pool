#!/usr/bin/env node

/**
 * Validate the Node.js runtime before starting either app.
 *
 * GRIDLOCK uses Node 22's native TypeScript stripping, watch mode, and
 * Vite APIs that are unavailable on older macOS/system Node installations.
 * Keep the minimum version aligned with backend/frontend package engines and CI.
 */
const [major, minor, patch] = process.versions.node.split('.').map(Number);
const compatible = major > 22 || (major === 22 && (minor > 16 || (minor === 16 && patch >= 0)));

if (!compatible) {
  console.error(
    [
      `GRIDLOCK requires Node.js >=22.16.0; found ${process.version}.`,
      'Install and select the pinned Node version from the repository root:',
      '  nvm install && nvm use',
      'Then verify with: node -v && which node',
    ].join('\n'),
  );
  process.exitCode = 1;
}
