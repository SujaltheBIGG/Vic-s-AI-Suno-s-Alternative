import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { authApi, User } from '../services/api';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  setupUser: (username: string) => Promise<void>;
  /** Adopt a session returned by /register, /login or the Google callback. */
  adoptSession: (result: { user: User; token: string }) => void;
  updateUsername: (username: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = 'acestep_token';
const USER_KEY = 'acestep_user';

export function AuthProvider({ children }: { children: ReactNode }): React.ReactElement {
  // Start with null - we'll auto-login from database on mount
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const isAuthenticated = !!user && !!token;

  const adoptSession = useCallback((result: { user: User; token: string }): void => {
    setUser(result.user);
    setToken(result.token);
    localStorage.setItem(TOKEN_KEY, result.token);
    localStorage.setItem(USER_KEY, JSON.stringify(result.user));
  }, []);

  useEffect(() => {
    async function initAuth(): Promise<void> {
      try {
        // 1. Token handed back by the Google callback as #token=...
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        const fromGoogle = hash.get('token');
        if (fromGoogle) {
          history.replaceState(null, '', window.location.pathname + window.location.search);
          const { user: gUser } = await authApi.me(fromGoogle);
          adoptSession({ user: gUser, token: fromGoogle });
          return;
        }

        // 2. An existing session in this browser.
        const stored = localStorage.getItem(TOKEN_KEY);
        if (stored) {
          try {
            const { user: sUser } = await authApi.me(stored);
            adoptSession({ user: sUser, token: stored });
            return;
          } catch {
            localStorage.removeItem(TOKEN_KEY);
            localStorage.removeItem(USER_KEY);
          }
        }

        // 3. Single-user dev fallback; returns 404 once DISABLE_AUTO_LOGIN is set.
        const { user: userData, token: newToken } = await authApi.auto();
        setUser(userData);
        setToken(newToken);
        localStorage.setItem(TOKEN_KEY, newToken);
        localStorage.setItem(USER_KEY, JSON.stringify(userData));
      } catch (error: unknown) {
        // No user in database (404) or server error - that's okay
        // Clear any stale localStorage data
        const err = error as { message?: string };
        if (err.message?.startsWith('404:')) {
          // No user exists yet - frontend will show username setup
          console.log('No user in database, need to set up username');
        } else {
          console.warn('Auto-login failed:', error);
        }
        // Clear stale data
        setToken(null);
        setUser(null);
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
      } finally {
        setIsLoading(false);
      }
    }

    initAuth();
  }, [adoptSession]);

  const setupUser = useCallback(async (username: string): Promise<void> => {
    const { user: userData, token: newToken } = await authApi.setup(username);
    setUser(userData);
    setToken(newToken);
    localStorage.setItem(TOKEN_KEY, newToken);
    localStorage.setItem(USER_KEY, JSON.stringify(userData));
  }, []);

  const updateUsername = useCallback(async (username: string): Promise<void> => {
    if (!token) throw new Error('Not authenticated');
    const { user: userData, token: newToken } = await authApi.updateUsername(username, token);
    setUser(userData);
    setToken(newToken);
    localStorage.setItem(TOKEN_KEY, newToken);
    localStorage.setItem(USER_KEY, JSON.stringify(userData));
  }, [token]);

  const logout = useCallback((): void => {
    authApi.logout().catch(() => {});
    setUser(null);
    // Send the user back to the marketing site after signing out.
    setTimeout(() => { window.location.href = '/'; }, 0);
    setToken(null);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }, []);

  const refreshUser = useCallback(async (): Promise<void> => {
    if (!token) return;
    try {
      const { user: userData } = await authApi.me(token);
      setUser(userData);
      localStorage.setItem(USER_KEY, JSON.stringify(userData));
    } catch (error) {
      console.error('Failed to refresh user:', error);
    }
  }, [token]);

  const value: AuthContextType = {
    user,
    token,
    adoptSession,
    isLoading,
    isAuthenticated,
    setupUser,
    updateUsername,
    logout,
    refreshUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
