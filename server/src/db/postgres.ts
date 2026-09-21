import pg from 'pg';
import { config } from '../config/index.js';

/**
 * PostgreSQL pool (Supabase, Neon, or any Postgres).
 *
 * The route code was originally written against Postgres — it already uses
 * $1/$2 placeholders, ILIKE and ::casts — so this layer passes SQL straight
 * through rather than rewriting it the way the SQLite shim has to.
 *
 * Enabled by setting DATABASE_URL. Without it the app stays on SQLite.
 */

const { Pool } = pg;

export interface QueryResult {
  rows: any[];
  rowCount: number;
}

const connectionString = process.env.DATABASE_URL;

// Supabase's pooler requires TLS but serves a cert Node won't verify by default.
const ssl =
  process.env.PGSSL_DISABLE === 'true'
    ? undefined
    : { rejectUnauthorized: false };

export const pgPool = new Pool({
  connectionString,
  ssl,
  max: Number(process.env.PGPOOL_MAX || 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000,
});

pgPool.on('error', (err) => {
  console.error('[postgres] idle client error:', err.message);
});

/**
 * Booleans and objects need no conversion for Postgres (unlike SQLite), but
 * undefined still has to become null.
 */

/**
 * Most routes were written for Postgres ($1 placeholders), but a handful use
 * SQLite syntax that the SQLite shim rewrites on the way in. Translate those
 * here so both dialects work rather than editing every call site and risking
 * a miss.
 */
function toPostgres(sql: string): string {
  let out = sql;

  // datetime('now')                -> now()
  // datetime('now', '-7 days')     -> now() - interval '7 days'
  out = out.replace(
    /datetime\(\s*'now'\s*,\s*'([+-]?)(\d+)\s+(\w+?)s?'\s*\)/gi,
    (_m, sign, n, unit) => `(now() ${sign === '-' ? '-' : '+'} interval '${n} ${unit}')`
  );
  out = out.replace(/datetime\(\s*'now'\s*\)/gi, 'now()');

  // ? placeholders -> $1, $2 ... (skipping anything inside string literals)
  if (!/\$\d/.test(out) && out.includes('?')) {
    let i = 0, inStr = false, res = '';
    for (let c = 0; c < out.length; c++) {
      const ch = out[c];
      if (ch === "'") inStr = !inStr;
      res += ch === '?' && !inStr ? `$${++i}` : ch;
    }
    out = res;
  }
  return out;
}

function sanitize(params?: unknown[]): unknown[] | undefined {
  if (!params) return params;
  return params.map((p) => {
    if (p === undefined) return null;
    // The schema stores these as text to match the existing row handling.
    if (Array.isArray(p) || (typeof p === 'object' && p !== null && !(p instanceof Date))) {
      return JSON.stringify(p);
    }
    return p;
  });
}

export const pool = {
  query: async (sql: string, params?: unknown[]): Promise<QueryResult> => {
    try {
      const res = await pgPool.query(toPostgres(sql), sanitize(params) as any[]);
      return { rows: res.rows, rowCount: res.rowCount ?? 0 };
    } catch (error) {
      console.error('Postgres query error:', (error as Error).message);
      console.error('SQL:', toPostgres(sql));
      throw error;
    }
  },

  /** Mirrors the pg client interface the like/transaction endpoints expect. */
  connect: async () => {
    const client = await pgPool.connect();
    return {
      query: async (sql: string, params?: unknown[]): Promise<QueryResult> => {
        const res = await client.query(toPostgres(sql), sanitize(params) as any[]);
        return { rows: res.rows, rowCount: res.rowCount ?? 0 };
      },
      release: () => client.release(),
    };
  },

  end: async () => {
    await pgPool.end();
  },
};

export async function assertConnection(): Promise<void> {
  const r = await pgPool.query('select current_database() as db, version() as v');
  console.log(
    `Postgres connected: ${r.rows[0].db} (${String(r.rows[0].v).split(' ').slice(0, 2).join(' ')})`
  );
}

export { config };
