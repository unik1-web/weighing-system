import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { UserStorage, SessionStorage, ProfileStorage, initializeStorage, type Session as LocalSession } from '@/lib/storage';
import { logger } from '@/lib/logger';

export type UserRole = 'user' | 'admin';

interface Profile {
  username: string;
  display_name: string;
  role: UserRole;
}

interface AuthContextValue {
  user: { id: string; email: string } | null;
  session: LocalSession | null;
  loading: boolean;
  signIn: (username: string, password: string) => Promise<{ error: string | null }>;
  signUp: (username: string, password: string, displayName: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  displayName: string;
  username: string;
  role: UserRole;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<LocalSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    initializeStorage();

    const storedSession = SessionStorage.getSession();
    if (storedSession) {
      setSession(storedSession);
      setProfile({
        username: storedSession.profile.username,
        display_name: storedSession.profile.display_name,
        role: storedSession.profile.role,
      });
    }
    setLoading(false);
  }, []);

  const signIn = useCallback(async (username: string, password: string) => {
    try {
      const user = UserStorage.validatePassword(username, password);
      if (!user) {
        return { error: 'Неверный логин или пароль' };
      }

      const profile = ProfileStorage.getProfile(user.id);
      if (!profile) {
        return { error: 'Профиль пользователя не найден' };
      }

      const session: LocalSession = { user, profile };
      SessionStorage.setSession(session);
      setSession(session);
      setProfile(profile);
      logger.info('auth', `Вход пользователя: ${profile.username}`);

      return { error: null };
    } catch (err: unknown) {
      logger.error('auth', 'Ошибка входа', err);
      return { error: err instanceof Error ? err.message : 'Ошибка входа' };
    }
  }, []);

  const signUp = useCallback(async (username: string, password: string, name: string) => {
    try {
      const user = UserStorage.createUser(username, password, name);
      const profile = ProfileStorage.getProfile(user.id);

      if (!profile) {
        return { error: 'Не удалось создать профиль' };
      }

      const session: LocalSession = { user, profile };
      SessionStorage.setSession(session);
      setSession(session);
      setProfile(profile);
      logger.info('auth', `Регистрация пользователя: ${profile.username}`);

      return { error: null };
    } catch (err: unknown) {
      logger.error('auth', 'Ошибка регистрации', err);
      return { error: err instanceof Error ? err.message : 'Ошибка регистрации' };
    }
  }, []);

  const signOut = useCallback(async () => {
    if (profile?.username) {
      logger.info('auth', `Выход пользователя: ${profile.username}`);
    }
    SessionStorage.clearSession();
    setSession(null);
    setProfile(null);
  }, [profile?.username]);

  const displayName = profile?.display_name || '';
  const username = profile?.username || '';
  const role: UserRole = profile?.role ?? 'user';
  const isAdmin = role === 'admin';

  return (
    <AuthContext.Provider
      value={{
        user: session?.user ?? null,
        session,
        loading,
        signIn,
        signUp,
        signOut,
        displayName,
        username,
        role,
        isAdmin,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
