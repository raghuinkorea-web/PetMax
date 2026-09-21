/**
 * Creates (or recreates) a dedicated test database and applies every
 * migration to it before the suite runs. Tests never touch the
 * development database.
 */
import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const TEST_DB = 'adisys_fieldops_test';

function adminUrl(): string {
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = '/postgres';
  return url.toString();
}

export function testDatabaseUrl(): string {
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${TEST_DB}`;
  return url.toString();
}

export async function setup() {
  const admin = new pg.Client({ connectionString: adminUrl() });
  await admin.connect();
  try {
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()`, [TEST_DB]);
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    await admin.query(`CREATE DATABASE ${TEST_DB}`);
  } finally {
    await admin.end();
  }

  const db = new pg.Client({ connectionString: testDatabaseUrl() });
  await db.connect();
  try {
    const dir = path.join(ROOT, 'db/migrations');
    for (const file of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
      await db.query(await readFile(path.join(dir, file), 'utf8'));
    }
  } finally {
    await db.end();
  }

  process.env.DATABASE_URL = testDatabaseUrl();
}

export async function teardown() {
  // The database is left in place so a failing run can be inspected;
  // the next run drops and recreates it.
}
