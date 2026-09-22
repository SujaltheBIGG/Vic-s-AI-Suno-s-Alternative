import React, { useEffect, useState } from 'react';
import { Mail, Lock, User, Sparkles, Loader2, ArrowLeft } from 'lucide-react';
import { authApi, AuthResponse } from '../services/api';

interface AuthModalProps {
  isOpen: boolean;
  onAuthenticated: (result: AuthResponse) => void | Promise<void>;
}

type Mode = 'choose' | 'signin' | 'signup';

const GoogleMark = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
    <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.7v3h3.9c2.3-2.1 3.5-5.2 3.5-8.9z"/>
    <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1A12 12 0 0 0 12 24z"/>
    <path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.6V6.7H1.4a12 12 0 0 0 0 10.7l4-3z"/>
    <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.7l4 3.1C6.3 6.9 8.9 4.8 12 4.8z"/>
  </svg>
);

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onAuthenticated }) => {
  const [mode, setMode] = useState<Mode>('choose');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [googleReady, setGoogleReady] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    authApi.googleStatus()
      .then((s) => setGoogleReady(s.configured))
      .catch(() => setGoogleReady(false));
  }, [isOpen]);

  if (!isOpen) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const result =
        mode === 'signup'
          ? await authApi.register(email.trim(), password, username.trim())
          : await authApi.login(email.trim(), password);
      await onAuthenticated(result);
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Something went wrong';
      setError(raw.replace(/^\d+:\s*/, ''));
    } finally {
      setBusy(false);
    }
  };

  const field =
    'w-full pl-11 pr-4 py-3 rounded-xl bg-zinc-100 dark:bg-white/5 border border-zinc-200 ' +
    'dark:border-white/10 text-zinc-900 dark:text-white placeholder-zinc-400 outline-none ' +
    'focus:border-pink-500/60 focus:ring-2 focus:ring-pink-500/20 transition';
  const primary =
    'w-full py-3 rounded-xl font-semibold text-white bg-gradient-to-r from-pink-500 to-purple-600 ' +
    'hover:from-pink-600 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed ' +
    'transition-all flex items-center justify-center gap-2';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-white/10 shadow-2xl overflow-hidden">
        <div className="h-1 bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500" />

        <div className="p-8">
          <div className="flex flex-col items-center text-center mb-7">
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center mb-4">
              <Sparkles className="w-7 h-7 text-white" />
            </div>
            <h2 className="text-2xl font-bold text-zinc-900 dark:text-white">
              {mode === 'signup' ? 'Create your account' : 'Welcome to Vic’s AI'}
            </h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
              {mode === 'signup'
                ? 'Your tracks stay in your own library'
                : 'Sign in to create and keep your music'}
            </p>
          </div>

          {/* Choose how to continue */}
          {mode === 'choose' && (
            <div className="space-y-3">
              <button
                onClick={() => authApi.googleSignIn()}
                disabled={!googleReady}
                title={googleReady ? undefined : 'Google sign-in is not configured on this server'}
                className="w-full py-3 rounded-xl font-medium flex items-center justify-center gap-3
                           bg-white text-zinc-800 border border-zinc-300 hover:bg-zinc-50
                           disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                <GoogleMark />
                Continue with Google
              </button>

              <div className="flex items-center gap-3 py-1">
                <span className="h-px flex-1 bg-zinc-200 dark:bg-white/10" />
                <span className="text-xs text-zinc-400">or</span>
                <span className="h-px flex-1 bg-zinc-200 dark:bg-white/10" />
              </div>

              <button onClick={() => setMode('signin')} className={primary}>
                <Mail className="w-4 h-4" />
                Continue with email
              </button>

              {!googleReady && (
                <p className="text-xs text-center text-zinc-400 pt-1">
                  Google sign-in isn’t configured yet
                </p>
              )}
            </div>
          )}

          {/* Email + password */}
          {mode !== 'choose' && (
            <form onSubmit={submit} className="space-y-3">
              {mode === 'signup' && (
                <div className="relative">
                  <User className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                  <input
                    className={field}
                    placeholder="Username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="username"
                    required
                  />
                </div>
              )}

              <div className="relative">
                <Mail className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                <input
                  className={field}
                  type="email"
                  placeholder="Email"
                  value={email}
                  // Pasting from chat apps can bring spaces or invisible direction
                  // marks, which make the browser reject the address outright.
                  onChange={(e) => setEmail(e.target.value.replace(/[\s ​-\u200F\u202A-\u202E⁠﻿]/g, ''))}
                  autoComplete="email"
                  required
                />
              </div>

              <div className="relative">
                <Lock className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                <input
                  className={field}
                  type="password"
                  placeholder={mode === 'signup' ? 'Password (min 8 characters)' : 'Password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  required
                />
              </div>

              {error && (
                <p className="text-sm text-red-500 bg-red-500/10 rounded-lg px-3 py-2">{error}</p>
              )}

              <button type="submit" disabled={busy} className={primary}>
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                {mode === 'signup' ? 'Create account' : 'Sign in'}
              </button>

              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => { setMode('choose'); setError(''); }}
                  className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-white flex items-center gap-1"
                >
                  <ArrowLeft className="w-4 h-4" /> Back
                </button>
                <button
                  type="button"
                  onClick={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setError(''); }}
                  className="text-sm text-pink-500 hover:text-pink-400 font-medium"
                >
                  {mode === 'signup' ? 'I already have an account' : 'Create an account'}
                </button>
              </div>
            </form>
          )}

          <p className="text-[11px] text-center text-zinc-400 mt-6">
            Your music, your way. Create unlimited AI music.
          </p>
        </div>
      </div>
    </div>
  );
};
