// Regenerates tests/fixtures/postgres-schema.json.
//
// It applies every file in supabase/migrations/ to a real, throwaway Postgres and
// introspects the result. The snapshot is what tests/schema-migrations.test.ts
// checks the code's row shapes against, so it must come from actually running the
// SQL — not from reading it.
//
//   node scripts/snapshot-schema.mjs                    # starts its own Postgres
//   node scripts/snapshot-schema.mjs "postgres://…"     # uses one you point at
//
// Run this whenever you add a migration. If you skip it, the schema test keeps
// checking against the old columns and a missing migration reaches production.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase', 'migrations');
const OUT = path.join(process.cwd(), 'tests', 'fixtures', 'postgres-schema.json');
const PORT = 55433;

const explicitUrl = process.argv[2];

function psql(args, { db, url } = {}) {
  const base = url
    ? [url]
    : ['-h', socketDir, '-p', String(PORT), '-U', 'postgres', '-d', db ?? 'postgres'];
  return execFileSync('psql', [...base, '-v', 'ON_ERROR_STOP=1', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

let socketDir = '';
let dataDir = '';
let started = false;

function startPostgres() {
  const binDir = ['/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/15/bin', '/usr/local/bin'].find(
    (candidate) => {
      const probe = spawnSync(path.join(candidate, 'initdb'), ['--version'], { stdio: 'ignore' });
      return probe.status === 0;
    },
  );
  if (!binDir) {
    console.error(
      'No local Postgres found. Install postgresql, or pass a connection URL:\n' +
        '  node scripts/snapshot-schema.mjs "postgres://user:pass@host/db"',
    );
    process.exit(2);
  }

  dataDir = mkdtempSync(path.join('/var/tmp', 'phonelab-pg-'));
  socketDir = mkdtempSync(path.join('/var/tmp', 'phonelab-sock-'));

  // initdb refuses to run as root, so hand the directories to the postgres user
  // when we are root and drop privileges for both commands.
  const asPostgres = process.getuid?.() === 0;
  const run = (command, args) => {
    if (asPostgres) {
      execFileSync('chown', ['-R', 'postgres', dataDir, socketDir]);
      execFileSync('su', ['postgres', '-c', [command, ...args].join(' ')], { stdio: 'ignore' });
    } else {
      execFileSync(command, args, { stdio: 'ignore' });
    }
  };

  run(path.join(binDir, 'initdb'), ['-D', dataDir, '-A', 'trust', '-U', 'postgres']);
  run(path.join(binDir, 'pg_ctl'), [
    '-D',
    dataDir,
    '-o',
    `"-p ${PORT} -k ${socketDir}"`,
    '-l',
    path.join(dataDir, 'server.log'),
    'start',
  ]);
  started = true;

  // pg_ctl returns before the socket is always ready on a cold start.
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      psql(['-tc', 'select 1']);
      return;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
    }
  }
  throw new Error('Postgres did not become ready.');
}

function stopPostgres() {
  if (!started) return;
  try {
    const binDir = '/usr/lib/postgresql/16/bin';
    const command = `${path.join(binDir, 'pg_ctl')} -D ${dataDir} -m immediate stop`;
    if (process.getuid?.() === 0) execFileSync('su', ['postgres', '-c', command], { stdio: 'ignore' });
    else execFileSync('sh', ['-c', command], { stdio: 'ignore' });
  } catch {
    // Best effort — the directory goes away either way.
  }
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(socketDir, { recursive: true, force: true });
}

try {
  const url = explicitUrl;
  if (!url) startPostgres();

  const db = url ? undefined : 'phonelab_schema_snapshot';
  if (!url) psql(['-c', `create database ${db};`]);

  const migrations = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  if (migrations.length === 0) throw new Error(`No migrations in ${MIGRATIONS_DIR}`);

  for (const migration of migrations) {
    process.stdout.write(`  applying ${migration}… `);
    psql(['-f', path.join(MIGRATIONS_DIR, migration)], { db, url });
    console.log('ok');
  }

  const raw = psql(
    [
      '-tA',
      '-F',
      '|',
      '-c',
      `select table_name, column_name
         from information_schema.columns
        where table_schema = 'public'
        order by table_name, column_name;`,
    ],
    { db, url },
  );

  const tables = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [table, column] = trimmed.split('|');
    if (!table || !column) continue;
    (tables[table] ??= []).push(column);
  }

  const sorted = Object.fromEntries(
    Object.keys(tables)
      .sort()
      .map((table) => [table, tables[table].sort()]),
  );

  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(
    OUT,
    `${JSON.stringify(
      {
        _comment:
          'Generated by scripts/snapshot-schema.mjs: supabase/migrations/*.sql applied to a real Postgres, then introspected. Regenerate after adding a migration.',
        tables: sorted,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  const columnCount = Object.values(sorted).reduce((sum, columns) => sum + columns.length, 0);
  console.log(
    `\nWrote ${path.relative(process.cwd(), OUT)} — ${Object.keys(sorted).length} tables, ${columnCount} columns.`,
  );
} catch (error) {
  console.error('\nFailed to snapshot the schema:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  stopPostgres();
}
