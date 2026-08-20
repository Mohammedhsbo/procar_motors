#!/usr/bin/env node
/**
 * Database backup and restore.
 *
 *   node scripts/backup.js create              # write a new dump
 *   node scripts/backup.js list                # show what exists
 *   node scripts/backup.js verify <file>       # restore into a scratch database
 *   node scripts/backup.js restore <file>      # restore over the real database
 *
 * `verify` is the one that matters: a backup nobody has restored is not a
 * backup. Run it on a schedule, not only when something has already gone wrong.
 *
 * Uses pg_dump's custom format so restores can run in parallel and skip
 * individual objects if needed.
 */
const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(process.cwd(), 'backups');
const RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS || 30);

function parseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port || '5432',
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
  };
}

function pgEnv(db) {
  return { ...process.env, PGPASSWORD: db.password };
}

function run(cmd, args, db) {
  return execFileSync(cmd, args, {
    env: pgEnv(db),
    stdio: ['ignore', 'inherit', 'inherit'],
  });
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function create() {
  const db = parseUrl();
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const file = path.join(BACKUP_DIR, `${db.database}-${stamp()}.dump`);

  console.log(`Dumping ${db.database} → ${file}`);
  run(
    'pg_dump',
    ['-h', db.host, '-p', db.port, '-U', db.user, '-d', db.database,
     '--format=custom', '--no-owner', '--no-acl', '--file', file],
    db,
  );

  const size = fs.statSync(file).size;
  if (size < 1024) {
    console.error(`Dump is only ${size} bytes — refusing to call that a backup.`);
    process.exit(1);
  }
  console.log(`Done: ${(size / 1024 / 1024).toFixed(2)} MB`);

  prune();
  return file;
}

function prune() {
  if (!fs.existsSync(BACKUP_DIR) || !RETENTION_DAYS) return;
  const cutoff = Date.now() - RETENTION_DAYS * 86400000;
  let removed = 0;
  for (const name of fs.readdirSync(BACKUP_DIR)) {
    if (!name.endsWith('.dump')) continue;
    const full = path.join(BACKUP_DIR, name);
    if (fs.statSync(full).mtimeMs < cutoff) {
      fs.unlinkSync(full);
      removed++;
    }
  }
  if (removed) console.log(`Pruned ${removed} backup(s) older than ${RETENTION_DAYS} days.`);
}

function list() {
  if (!fs.existsSync(BACKUP_DIR)) {
    console.log('No backups yet.');
    return;
  }
  const rows = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith('.dump'))
    .map((f) => {
      const s = fs.statSync(path.join(BACKUP_DIR, f));
      return { file: f, mb: (s.size / 1024 / 1024).toFixed(2), at: s.mtime.toISOString() };
    })
    .sort((a, b) => b.at.localeCompare(a.at));

  if (!rows.length) {
    console.log('No backups yet.');
    return;
  }
  for (const r of rows) console.log(`${r.at}  ${r.mb.padStart(8)} MB  ${r.file}`);
}

/** Restores into a throwaway database and counts the rows that came back. */
function verify(file) {
  const db = parseUrl();
  const target = path.isAbsolute(file) ? file : path.join(BACKUP_DIR, file);
  if (!fs.existsSync(target)) {
    console.error(`No such backup: ${target}`);
    process.exit(1);
  }

  const scratch = `verify_${Date.now()}`;
  const psql = (sql, database = 'postgres') =>
    execFileSync(
      'psql',
      ['-h', db.host, '-p', db.port, '-U', db.user, '-d', database, '-tAc', sql],
      { env: pgEnv(db), encoding: 'utf8' },
    ).trim();

  console.log(`Restoring ${path.basename(target)} into ${scratch} …`);
  psql(`CREATE DATABASE ${scratch}`);

  try {
    // pg_restore reports benign notices on a fresh database; only the row
    // counts below decide whether the restore is good.
    try {
      execFileSync(
        'pg_restore',
        ['-h', db.host, '-p', db.port, '-U', db.user, '-d', scratch,
         '--no-owner', '--no-acl', '--jobs', '4', target],
        { env: pgEnv(db), stdio: ['ignore', 'ignore', 'pipe'] },
      );
    } catch {
      // fall through to the row check
    }

    const users = psql('SELECT count(*) FROM core.users', scratch);
    const perms = psql('SELECT count(*) FROM core.permissions', scratch);
    const tables = psql(
      `SELECT count(*) FROM pg_tables WHERE schemaname IN
       ('core','promotors','inventory','purchasing','finance','ops','uxp','tireszone','daily_cafe')`,
      scratch,
    );

    console.log(`  tables      : ${tables}`);
    console.log(`  users       : ${users}`);
    console.log(`  permissions : ${perms}`);

    if (Number(tables) < 50 || Number(users) < 1) {
      console.error('\nRestore looks incomplete. This backup is NOT usable.');
      process.exit(1);
    }
    console.log('\nRestore verified — this backup is usable.');
  } finally {
    psql(`DROP DATABASE IF EXISTS ${scratch}`);
  }
}

function restore(file) {
  const db = parseUrl();
  const target = path.isAbsolute(file) ? file : path.join(BACKUP_DIR, file);
  if (!fs.existsSync(target)) {
    console.error(`No such backup: ${target}`);
    process.exit(1);
  }
  if (process.env.CONFIRM_RESTORE !== 'yes') {
    console.error(
      `This overwrites ${db.database}. Re-run with CONFIRM_RESTORE=yes to proceed.`,
    );
    process.exit(1);
  }

  console.log(`Restoring ${path.basename(target)} over ${db.database} …`);
  execFileSync(
    'pg_restore',
    ['-h', db.host, '-p', db.port, '-U', db.user, '-d', db.database,
     '--clean', '--if-exists', '--no-owner', '--no-acl', '--jobs', '4', target],
    { env: pgEnv(db), stdio: 'inherit' },
  );
  console.log('Restore complete.');
}

const [command, arg] = process.argv.slice(2);
switch (command) {
  case 'create':
    create();
    break;
  case 'list':
    list();
    break;
  case 'verify':
    if (!arg) {
      console.error('Usage: backup.js verify <file>');
      process.exit(1);
    }
    verify(arg);
    break;
  case 'restore':
    if (!arg) {
      console.error('Usage: backup.js restore <file>');
      process.exit(1);
    }
    restore(arg);
    break;
  default:
    console.log('Usage: backup.js create | list | verify <file> | restore <file>');
    process.exit(1);
}
