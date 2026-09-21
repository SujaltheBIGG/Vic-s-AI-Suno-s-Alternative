/**
 * Deployment preflight.
 *
 *   npm run check:deploy
 *
 * Verifies the three external services independently and says exactly what is
 * wrong with each. Safe to run repeatedly; it writes nothing permanent except
 * one temporary object in the bucket, which it deletes.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const ok = (m: string) => console.log(`  \x1b[32mPASS\x1b[0m  ${m}`);
const bad = (m: string) => console.log(`  \x1b[31mFAIL\x1b[0m  ${m}`);
const skip = (m: string) => console.log(`  \x1b[33mSKIP\x1b[0m  ${m}`);

let failures = 0;

async function checkDatabase() {
  console.log('\n[1/3] Database');
  if (!process.env.DATABASE_URL) {
    skip('DATABASE_URL not set — using local SQLite (data is lost on redeploy)');
    return;
  }
  try {
    const { pgPool } = await import('../db/postgres.js');
    const r = await pgPool.query('select current_database() as db');
    ok(`connected to "${r.rows[0].db}"`);

    const t = await pgPool.query(
      `select table_name from information_schema.tables
        where table_schema='public' order by table_name`
    );
    const names = t.rows.map((x: any) => x.table_name);
    const expected = [
      'comments', 'contact_submissions', 'followers', 'generation_jobs',
      'liked_songs', 'playlist_songs', 'playlists', 'reference_tracks',
      'songs', 'users',
    ];
    const missing = expected.filter((e) => !names.includes(e));
    if (missing.length) {
      bad(`missing tables: ${missing.join(', ')} — start the server once to migrate`);
      failures++;
    } else {
      ok(`all ${expected.length} tables present`);
    }

    const songs = await pgPool.query('select count(*)::int as n from songs');
    const users = await pgPool.query('select count(*)::int as n from users');
    ok(`${users.rows[0].n} user(s), ${songs.rows[0].n} song(s) stored`);
    await pgPool.end();
  } catch (e) {
    bad(`${(e as Error).message}`);
    console.log('        check the password and that you used the Session pooler URI');
    failures++;
  }
}

async function checkStorage() {
  console.log('\n[2/3] Object storage');
  if (!process.env.S3_BUCKET) {
    skip('S3_BUCKET not set — audio stays on local disk (lost on redeploy)');
    return;
  }
  try {
    const { S3StorageProvider } = await import('../services/storage/s3.js');
    const s = new S3StorageProvider();
    // Use the bucket's real content type; buckets may restrict MIME types.
    const key = `__preflight/${Date.now()}.mp3`;
    await s.upload(key, Buffer.from('vics-ai preflight'), 'audio/mpeg');
    ok(`wrote to bucket "${process.env.S3_BUCKET}"`);
    if (!(await s.exists(key))) throw new Error('object not found after upload');
    ok('read back');
    await s.delete(key);
    ok('deleted');
    console.log(
      `        public URLs: ${
        process.env.S3_PUBLIC_BASE_URL
          ? 'permanent (' + process.env.S3_PUBLIC_BASE_URL + ')'
          : 'presigned (set S3_PUBLIC_BASE_URL for permanent links)'
      }`
    );
  } catch (e) {
    bad(`${(e as Error).message}`);
    console.log('        check the endpoint URL, bucket name and API token permissions');
    failures++;
  }
}

async function checkEngine() {
  console.log('\n[3/3] GPU engine');
  const url = process.env.ACESTEP_API_URL;
  if (!url) { skip('ACESTEP_API_URL not set'); return; }
  const local = url.includes('localhost') || url.includes('127.0.0.1');
  try {
    const started = Date.now();
    const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    ok(`reachable in ${secs}s — ${local ? 'LOCAL (your machine)' : 'REMOTE (Modal)'}`);
    if (local) {
      console.log('        still pointing at your Mac; switch to the Modal URL to deploy');
    } else if (Number(secs) > 20) {
      console.log('        slow first hit = cold start; subsequent requests are fast');
    }
  } catch (e) {
    bad(`unreachable: ${(e as Error).message}`);
    failures++;
  }
}

console.log('Vic’s AI — deployment preflight');
await checkDatabase();
await checkStorage();
await checkEngine();

console.log(
  failures === 0
    ? '\n\x1b[32mAll configured services are working.\x1b[0m\n'
    : `\n\x1b[31m${failures} check(s) failed — see the hints above.\x1b[0m\n`
);
process.exit(failures === 0 ? 0 : 1);
