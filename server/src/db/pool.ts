import { pool as sqlitePool, db as sqliteDb } from './sqlite-pool.js';
import { pool as pgPoolWrapper } from './postgres.js';

/**
 * Chooses the database engine.
 *
 *   DATABASE_URL set  -> PostgreSQL (Supabase/Neon). Survives redeploys.
 *   otherwise         -> SQLite file. Correct for local dev, but lost on any
 *                        host with an ephemeral filesystem.
 *
 * Route code is unchanged either way: it already writes Postgres-flavoured SQL
 * ($1 placeholders, ILIKE, ::casts) which the SQLite layer rewrites.
 */
export const usingPostgres = Boolean(process.env.DATABASE_URL);

export const pool = usingPostgres ? pgPoolWrapper : sqlitePool;

/**
 * Raw better-sqlite3 handle. Only meaningful in SQLite mode — the Postgres
 * path uses migrate-postgres.ts instead of db.exec().
 */
export const db = sqliteDb;
