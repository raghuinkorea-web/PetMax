import pg from 'pg';
import { config } from '../config.js';

// numeric/int8 arrive as strings from node-postgres; money and minute
// totals are always consumed as numbers in this codebase.
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));  // numeric
pg.types.setTypeParser(20,   (v) => (v === null ? null : Number(v)));  // int8
// DATE must stay a plain YYYY-MM-DD string — never shift it into a local
// timezone, or a claim dated the 1st can display as the previous month.
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  application_name: 'adisys-fieldops-api',
});

pool.on('error', (err) => console.error('[db] idle client error', err));

export type Sql = pg.PoolClient | pg.Pool;

export async function query<T extends pg.QueryResultRow = any>(
  sql: string, params: unknown[] = [], client: Sql = pool,
): Promise<T[]> {
  const res = await client.query<T>(sql, params as any[]);
  return res.rows;
}

export async function one<T extends pg.QueryResultRow = any>(
  sql: string, params: unknown[] = [], client: Sql = pool,
): Promise<T | null> {
  const rows = await query<T>(sql, params, client);
  return rows[0] ?? null;
}

/** Runs `fn` inside a transaction, rolling back on any thrown error. */
export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Builds a parameterised WHERE clause without string interpolation of
 * user input. Returns `{ text, params, next }` where `next` is the index
 * the caller should continue numbering from.
 */
export class SqlBuilder {
  private clauses: string[] = [];
  readonly params: unknown[] = [];
  constructor(private readonly startIndex = 1) {}
  /** `add('u.status = $?', value)` — each `$?` consumes one parameter. */
  add(fragment: string, ...values: unknown[]): this {
    let i = 0;
    const text = fragment.replace(/\$\?/g, () => {
      this.params.push(values[i++]);
      return `$${this.startIndex + this.params.length - 1}`;
    });
    this.clauses.push(text);
    return this;
  }
  addIf(condition: unknown, fragment: string, ...values: unknown[]): this {
    if (condition !== undefined && condition !== null && condition !== '') this.add(fragment, ...values);
    return this;
  }
  get where(): string { return this.clauses.length ? `WHERE ${this.clauses.join(' AND ')}` : ''; }
  get and(): string { return this.clauses.length ? `AND ${this.clauses.join(' AND ')}` : ''; }
  get next(): number { return this.startIndex + this.params.length; }
}
