'use strict';

/**
 * Production / CI migration entry.
 * Runs `prisma migrate deploy` only. Never db push, migrate dev, or reset.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const extra = process.argv.slice(2).map((a) => a.toLowerCase());
const forbidden = ['push', 'reset', 'dev', 'force-reset', 'db'];
if (extra.some((a) => forbidden.includes(a) || a.includes('push'))) {
  console.error(
    'Refusing unsafe Prisma command. Production uses prisma migrate deploy only.',
  );
  process.exit(1);
}

if (!process.env.DATABASE_URL || !String(process.env.DATABASE_URL).trim()) {
  console.error('DATABASE_URL is required for migrate deploy');
  process.exit(1);
}

const root = path.join(__dirname, '..');
let prismaCli;
try {
  prismaCli = require.resolve('prisma/build/index.js', { paths: [root] });
} catch {
  console.error('Prisma CLI not found. Run npm ci / npm install first.');
  process.exit(1);
}

// Invoke via node + resolved path so Windows paths with spaces work
// (shell:true + unquoted .cmd breaks on "D:\\procar app\\...").
const result = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
  stdio: 'inherit',
  env: process.env,
  cwd: root,
});

process.exit(result.status === null ? 1 : result.status);
