import { Router, Request, Response } from 'express';
import jwt, { SignOptions } from 'jsonwebtoken';
import crypto from 'crypto';
import { pool } from '../db/pool.js';
import { generateUUID } from '../db/sqlite.js';
import { config } from '../config/index.js';

/**
 * "Continue with Google" — OAuth 2.0 authorization-code flow.
 *
 * Accounts are keyed on the verified Google email:
 *   - email already in users  -> that account is linked and signed in
 *     (so signing in with sujalgundalbusiness@gmail.com reaches the existing
 *      library rather than creating a duplicate)
 *   - email unknown           -> a brand new isolated account is created
 */

const router = Router();
const jwtOptions = { expiresIn: config.jwt.expiresIn } as SignOptions;

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
/** Must match a redirect URI registered in Google Cloud Console exactly. */
const REDIRECT_URI =
  process.env.GOOGLE_REDIRECT_URI ||
  `${process.env.PUBLIC_URL || 'http://localhost:4321'}/api/auth/google/callback`;
/** Where the browser lands after a successful sign-in. */
const APP_URL = process.env.APP_URL || config.frontendUrl;

const configured = () => Boolean(CLIENT_ID && CLIENT_SECRET);

// Short-lived CSRF state values.
const pendingStates = new Map<string, number>();
function newState(): string {
  const s = crypto.randomBytes(16).toString('hex');
  pendingStates.set(s, Date.now() + 10 * 60_000);
  for (const [k, exp] of pendingStates) if (exp < Date.now()) pendingStates.delete(k);
  return s;
}
function consumeState(s?: string): boolean {
  if (!s || !pendingStates.has(s)) return false;
  const ok = (pendingStates.get(s) as number) > Date.now();
  pendingStates.delete(s);
  return ok;
}

router.get('/google/status', (_req: Request, res: Response) => {
  res.json({ configured: configured(), redirectUri: REDIRECT_URI });
});

/** Step 1 — send the user to Google. */
router.get('/google', (_req: Request, res: Response) => {
  if (!configured()) {
    res.status(503).json({ error: 'Google sign-in is not configured on this server' });
    return;
  }
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', newState());
  url.searchParams.set('prompt', 'select_account');
  res.redirect(url.toString());
});

/** Step 2 — Google redirects back with a code. */
router.get('/google/callback', async (req: Request, res: Response) => {
  const fail = (msg: string) =>
    res.redirect(`${APP_URL}/?auth_error=${encodeURIComponent(msg)}`);

  try {
    if (!configured()) return fail('Google sign-in is not configured');
    if (req.query.error) return fail(String(req.query.error));
    if (!consumeState(req.query.state as string)) return fail('Invalid or expired state');

    const code = req.query.code as string;
    if (!code) return fail('No authorization code returned');

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });
    if (!tokenRes.ok) return fail(`Token exchange failed: ${await tokenRes.text()}`);
    const tokens = (await tokenRes.json()) as { access_token?: string };
    if (!tokens.access_token) return fail('No access token from Google');

    const profRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!profRes.ok) return fail('Could not read Google profile');
    const profile = (await profRes.json()) as {
      sub: string; email?: string; email_verified?: boolean; name?: string; picture?: string;
    };

    if (!profile.email || profile.email_verified === false) {
      return fail('Your Google account has no verified email');
    }
    const email = profile.email.toLowerCase();

    // Link by email first, then by google_id.
    const existing = await pool.query(
      `SELECT id, username, email, bio, avatar_url, banner_url, is_admin, created_at
         FROM users WHERE lower(email) = $1 OR google_id = $2 LIMIT 1`,
      [email, profile.sub]
    );

    let user = existing.rows[0];
    if (user) {
      await pool.query(
        `UPDATE users SET google_id = $1, email = COALESCE(email, $2),
                avatar_url = COALESCE(avatar_url, $3), updated_at = CURRENT_TIMESTAMP
          WHERE id = $4`,
        [profile.sub, email, profile.picture ?? null, user.id]
      );
    } else {
      // New person -> their own isolated account.
      const base = (profile.name || email.split('@')[0])
        .replace(/[^a-zA-Z0-9_-]/g, '')
        .slice(0, 40) || 'user';
      let username = base;
      for (let i = 0; i < 50; i++) {
        const clash = await pool.query('SELECT 1 FROM users WHERE username = $1', [username]);
        if (!clash.rows.length) break;
        username = `${base}${Math.floor(Math.random() * 9000) + 1000}`;
      }
      const id = generateUUID();
      await pool.query(
        `INSERT INTO users (id, username, email, google_id, avatar_url, is_admin, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [id, username, email, profile.sub, profile.picture ?? null]
      );
      user = (
        await pool.query(
          `SELECT id, username, email, bio, avatar_url, banner_url, is_admin, created_at
             FROM users WHERE id = $1`,
          [id]
        )
      ).rows[0];
    }

    const token = jwt.sign({ id: user.id, username: user.username }, config.jwt.secret, jwtOptions);
    // Handed to the SPA via the URL fragment so it never hits server logs.
    res.redirect(`${APP_URL}/#token=${token}`);
  } catch (error) {
    console.error('Google OAuth error:', error);
    fail('Sign-in failed');
  }
});

export default router;
