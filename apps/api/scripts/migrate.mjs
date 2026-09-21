#!/usr/bin/env node
/**
 * ADISYS FieldOps migration runner.
 * Applies every db/migrations/*.sql exactly once, inside a transaction,
 * recording the checksum so an edited migration is detected rather than
 * silently skipped.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(here, '../../../db/migrations');
const reset = process.argv.includes('--reset');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();

try {
  if (reset) {
    console.log('⚠️  --reset: dropping and recreating the public schema');
    await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    text PRIMARY KEY,
      checksum    char(64) NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now(),
      duration_ms int NOT NULL
    )`);

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const { rows: applied } = await client.query('SELECT filename, checksum FROM schema_migrations');
  const appliedMap = new Map(applied.map((r) => [r.filename, r.checksum]));

  let count = 0;
  for (const file of files) {
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');

    if (appliedMap.has(file)) {
      if (appliedMap.get(file) !== checksum) {
        throw new Error(
          `Migration ${file} has changed since it was applied.\n` +
          `Migrations are immutable — add a new migration instead of editing this one.`);
      }
      continue;
    }

    const started = Date.now();
    process.stdout.write(`  → ${file} ... `);
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (filename, checksum, duration_ms) VALUES ($1,$2,$3)',
        [file, checksum, Date.now() - started]);
      await client.query('COMMIT');
      console.log(`ok (${Date.now() - started}ms)`);
      count++;
    } catch (err) {
      await client.query('ROLLBACK');
      console.log('FAILED');
      throw err;
    }
  }
  console.log(count ? `✅ Applied ${count} migration(s).` : '✅ Database already up to date.');
} catch (err) {
  console.error('\n❌ Migration failed:', err.message);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}
