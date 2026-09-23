import { Router, Request, Response } from 'express';
import jwt, { SignOptions } from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { pool } from '../db/pool.js';
import { generateUUID } from '../db/sqlite.js';
import { config } from '../config/index.js';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth.js';

const jwtOptions = { expiresIn: config.jwt.expiresIn } as SignOptions;

const router = Router();

interface SetupBody {
  username: string;
}

// Whitespace (incl. no-break space) and zero-width / bidi marks.
const PASTE_JUNK = /[\s ​-\u200F\u202A-\u202E⁠﻿]/g;
const PASTE_JUNK_ENDS = /^[\s ​-\u200F\u202A-\u202E⁠﻿]+|[\s ​-\u200F\u202A-\u202E⁠﻿]+$/g;

function issueAccessToken(payload: { id: string; username: string }): string {
  return jwt.sign(payload, config.jwt.secret, jwtOptions);
}


/**
 * Real accounts.
 *
 * /auto (below) logs any visitor in as the first user in the database — fine
 * for a single-user local app, wrong for anything public. Set
 * DISABLE_AUTO_LOGIN=true in production so these endpoints are the only way in.
 */

const publicUser = (u: any) => ({
  id: u.id,
  username: u.username,
  email: u.email ?? null,
  bio: u.bio,
  avatar_url: u.avatar_url,
  banner_url: u.banner_url,
  isAdmin: Boolean(u.is_admin),
  createdAt: u.created_at,
});

function validate(email?: string, password?: string, username?: string) {
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return 'A valid email is required';
  if (!password || password.length < 8) return 'Password must be at least 8 characters';
  if (username !== undefined) {
    const u = (username || '').trim();
    if (u.length < 2 || u.length > 50) return 'Username must be 2-50 characters';
    if (!/^[a-zA-Z0-9_-]+$/.test(u)) return 'Username may only contain letters, numbers, _ and -';
  }
  return null;
}

router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password, username } = req.body ?? {};
    const problem = validate(email, password, username);
    if (problem) { res.status(400).json({ error: problem }); return; }

    const emailLc = String(email).toLowerCase().trim();
    const name = String(username).trim();

    const clash = await pool.query(
      'SELECT id, email, username FROM users WHERE lower(email) = $1 OR username = $2',
      [emailLc, name]
    );
    if (clash.rows.length) {
      const taken = clash.rows[0].email?.toLowerCase() === emailLc ? 'email' : 'username';
      res.status(409).json({ error: `That ${taken} is already registered` });
      return;
    }

    const hash = await bcrypt.hash(String(password), 12);
    const id = generateUUID();
    await pool.query(
      `INSERT INTO users (id, username, email, password_hash, is_admin, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [id, name, emailLc, hash]
    );

    const created = await pool.query(
      'SELECT id, username, email, bio, avatar_url, banner_url, is_admin, created_at FROM users WHERE id = $1',
      [id]
    );
    const user = created.rows[0];
    res.status(201).json({ user: publicUser(user), token: issueAccessToken({ id: user.id, username: user.username }) });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body ?? {};
    if (!email || !password) { res.status(400).json({ error: 'Email and password are required' }); return; }

    // Credentials pasted from a chat app often carry stray spaces or invisible
    // direction marks. An email can't contain either, so strip them all; the
    // password is tried as typed first, then with them trimmed from the ends.
    const cleanEmail = String(email).replace(PASTE_JUNK, '').toLowerCase();
    const typed = String(password);
    const trimmed = typed.replace(PASTE_JUNK_ENDS, '');

    const found = await pool.query(
      `SELECT id, username, email, password_hash, bio, avatar_url, banner_url, is_admin, created_at
         FROM users WHERE lower(email) = $1`,
      [cleanEmail]
    );
    const user = found.rows[0];

    const ok = !!user?.password_hash && (
      await bcrypt.compare(typed, user.password_hash) ||
      (trimmed !== typed && await bcrypt.compare(trimmed, user.password_hash))
    );

    const who = { email: cleanEmail, ip: req.headers['x-forwarded-for'] || req.ip, ua: String(req.headers['user-agent'] || '').slice(0, 120) };
    if (!ok) {
      const reason = !user ? 'no account' : !user.password_hash ? 'Google-only account' : 'wrong password';
      // Length only, never the password itself: enough to tell a typo from a
      // browser filling in an old saved password.
      console.warn(`[auth] login failed (${reason})`, { ...who, passwordLength: trimmed.length });
      // Same response whether the account is missing or the password is wrong,
      // so this can't be used to discover which emails are registered.
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    console.log('[auth] login ok', who);
    res.json({ user: publicUser(user), token: issueAccessToken({ id: user.id, username: user.username }) });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Auto-login: Get the default user from database (for local single-user app)
router.get('/auto', async (_req: Request, res: Response) => {
  if (process.env.DISABLE_AUTO_LOGIN === 'true') {
    res.status(404).json({ error: 'Auto-login is disabled; use /api/auth/login' });
    return;
  }
  try {
    // Get the first user from the database (local app typically has one user)
    const result = await pool.query(
      'SELECT id, username, bio, avatar_url, banner_url, is_admin, created_at FROM users ORDER BY created_at ASC LIMIT 1'
    );

    if (result.rows.length === 0) {
      // No user exists yet - frontend should show username setup
      res.status(404).json({ error: 'No user found' });
      return;
    }

    const user = result.rows[0];

    // Generate token for the user
    const token = issueAccessToken({
      id: user.id,
      username: user.username,
    });

    res.json({
      user: {
        id: user.id,
        username: user.username,
        bio: user.bio,
        avatar_url: user.avatar_url,
        banner_url: user.banner_url,
        isAdmin: Boolean(user.is_admin),
        createdAt: user.created_at,
      },
      token,
    });
  } catch (error) {
    console.error('Auto-login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Setup or get user by username (simplified auth for local app)
router.post('/setup', async (req: Request<object, object, SetupBody>, res: Response) => {
  // Username-only sign-in let anyone claim an account. Disabled alongside
  // /auto; register or Google sign-in are the supported paths.
  if (process.env.DISABLE_AUTO_LOGIN === 'true') {
    res.status(404).json({ error: 'Username-only signup is disabled; use /api/auth/register' });
    return;
  }
  try {
    const { username } = req.body;

    if (!username || typeof username !== 'string') {
      res.status(400).json({ error: 'Username is required' });
      return;
    }

    // Sanitize username
    const sanitizedUsername = username
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .slice(0, 50);

    if (sanitizedUsername.length < 2) {
      res.status(400).json({ error: 'Username must be at least 2 characters' });
      return;
    }

    // Check if user exists
    const existingUser = await pool.query(
      'SELECT id, username, bio, avatar_url, banner_url, is_admin, created_at FROM users WHERE username = ?',
      [sanitizedUsername]
    );

    let user;

    if (existingUser.rows.length > 0) {
      // User exists, return it
      user = existingUser.rows[0];
    } else {
      // Create new user
      const userId = generateUUID();
      await pool.query(
        `INSERT INTO users (id, username, is_admin, created_at, updated_at)
         VALUES (?, ?, 0, datetime('now'), datetime('now'))`,
        [userId, sanitizedUsername]
      );

      const newUser = await pool.query(
        'SELECT id, username, bio, avatar_url, banner_url, is_admin, created_at FROM users WHERE id = ?',
        [userId]
      );
      user = newUser.rows[0];
    }

    // Generate token
    const token = issueAccessToken({
      id: user.id,
      username: user.username,
    });

    res.status(200).json({
      user: {
        id: user.id,
        username: user.username,
        bio: user.bio,
        avatar_url: user.avatar_url,
        banner_url: user.banner_url,
        isAdmin: Boolean(user.is_admin),
        createdAt: user.created_at,
      },
      token,
    });
  } catch (error) {
    console.error('Auth setup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get current user
router.get('/me', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT id, username, bio, avatar_url, banner_url, is_admin, created_at FROM users WHERE id = ?',
      [req.user!.id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const user = result.rows[0];
    res.json({
      user: {
        id: user.id,
        username: user.username,
        bio: user.bio,
        avatar_url: user.avatar_url,
        banner_url: user.banner_url,
        isAdmin: Boolean(user.is_admin),
        createdAt: user.created_at,
      },
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update username
router.patch('/username', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { username } = req.body;

    if (!username || typeof username !== 'string') {
      res.status(400).json({ error: 'Username is required' });
      return;
    }

    // Sanitize username
    const sanitizedUsername = username
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .slice(0, 50);

    if (sanitizedUsername.length < 2) {
      res.status(400).json({ error: 'Username must be at least 2 characters' });
      return;
    }

    // Check if username is taken by another user
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE username = ? AND id != ?',
      [sanitizedUsername, req.user!.id]
    );

    if (existingUser.rows.length > 0) {
      res.status(409).json({ error: 'Username is already taken' });
      return;
    }

    // Update username
    await pool.query(
      `UPDATE users SET username = ?, updated_at = datetime('now') WHERE id = ?`,
      [sanitizedUsername, req.user!.id]
    );

    // Get updated user
    const result = await pool.query(
      'SELECT id, username, bio, avatar_url, banner_url, is_admin, created_at FROM users WHERE id = ?',
      [req.user!.id]
    );

    const user = result.rows[0];

    // Issue new token with updated username
    const token = issueAccessToken({
      id: user.id,
      username: user.username,
    });

    res.json({
      user: {
        id: user.id,
        username: user.username,
        bio: user.bio,
        avatar_url: user.avatar_url,
        banner_url: user.banner_url,
        isAdmin: Boolean(user.is_admin),
        createdAt: user.created_at,
      },
      token,
    });
  } catch (error) {
    console.error('Update username error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Logout (no-op for local app, just for API compatibility)
router.post('/logout', async (_req: Request, res: Response) => {
  res.json({ success: true });
});

// Refresh token (for API compatibility - just returns current user if token valid)
router.post('/refresh', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await pool.query(
      'SELECT id, username, bio, avatar_url, banner_url, is_admin, created_at FROM users WHERE id = ?',
      [req.user!.id]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const user = result.rows[0];
    const token = issueAccessToken({
      id: user.id,
      username: user.username,
    });

    res.json({
      user: {
        id: user.id,
        username: user.username,
        bio: user.bio,
        avatar_url: user.avatar_url,
        banner_url: user.banner_url,
        isAdmin: Boolean(user.is_admin),
        createdAt: user.created_at,
      },
      token,
    });
  } catch (error) {
    console.error('Refresh token error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
