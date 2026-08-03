import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import {
  UserStorage,
  SessionStorage,
  ProfileStorage,
  initializeStorage,
  normalizeVehicleDictionaryPlates,
  type Session as LocalSession,
} from '@/lib/storage';
import { loadStorageFromServer, DICTIONARIES_UPDATED_EVENT } from '@/lib/storage-sync';
import { ensureSiteMigrated } from '@/lib/site-runtime';
import { authChangePassword, authLogin, authRegister } from '@/lib/auth-api';
import { logger } from '@/lib/logger';

export type UserRole = 'user' | 'admin';

interface Profile {
  username: string;
  display_name: string;
  role: UserRole;
}

interface AuthContextValue {
  user: { id: string; email: string; username?: string } | null;
  session: LocalSession | null;
  loading: boolean;
  mustChangePassword: boolean;
  signIn: (username: string, password: string) => Promise<{ error: string | null }>;
  signUp: (username: string, password: string, displayName: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  changePassword: (args: {
    newPassword: string;
    currentPassword: string;
  }) => Promise<{ error: string | null }>;
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
  const [mustChangePassword, setMustChangePassword] = useState(false);

  useEffect(() => {
    let active = true;

    void (async () => {
      await loadStorageFromServer();
      if (!active) return;

      if (normalizeVehicleDictionaryPlates()) {
        window.dispatchEvent(new Event(DICTIONARIES_UPDATED_EVENT));
      }

      initializeStorage();
      ensureSiteMigrated();

      const storedSession = SessionStorage.getSession();
      if (storedSession) {
        setSession(storedSession);
        setProfile({
          username: storedSession.profile.username,
          display_name: storedSession.profile.display_name,
          role: storedSession.profile.role,
        });
        const storedUser = UserStorage.getUserById(storedSession.user.id);
        setMustChangePassword(Boolean(storedUser?.mustChangePassword));
      }
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, []);

  const signIn = useCallback(async (username: string, password: string) => {
    try {
      const result = await authLogin(username, password);
      const user = {
        id: result.user.id,
        email: result.user.email,
        username: result.user.username,
        mustChangePassword: result.must_change_password,
      };
      UserStorage.upsertUser(user);
      ProfileStorage.setProfile(user.id, result.profile);

      const nextSession: LocalSession = { user, profile: result.profile };
      SessionStorage.setSession(nextSession);
      setSession(nextSession);
      setProfile(result.profile);
      setMustChangePassword(Boolean(result.must_change_password));
      logger.info('auth', `Вход пользователя: ${result.profile.username}`);

      return { error: null };
    } catch (err: unknown) {
      logger.error('auth', 'Ошибка входа', err);
      return { error: err instanceof Error ? err.message : 'Ошибка входа' };
    }
  }, []);

  const signUp = useCallback(async (username: string, password: string, name: string) => {
    try {
      const result = await authRegister(username, password, name);
      const user = {
        id: result.user.id,
        email: result.user.email,
        username: result.user.username,
        mustChangePassword: Boolean(result.must_change_password),
      };
      UserStorage.upsertUser(user);
      ProfileStorage.setProfile(user.id, result.profile);

      const nextSession: LocalSession = { user, profile: result.profile };
      SessionStorage.setSession(nextSession);
      setSession(nextSession);
      setProfile(result.profile);
      setMustChangePassword(Boolean(result.must_change_password));
      logger.info('auth', `Регистрация пользователя: ${result.profile.username}`);

      return { error: null };
    } catch (err: unknown) {
      logger.error('auth', 'Ошибка регистрации', err);
      return { error: err instanceof Error ? err.message : 'Ошибка регистрации' };
    }
  }, []);

  const changePassword = useCallback(
    async (args: { newPassword: string; currentPassword: string }) => {
      if (!session?.user?.id) {
        return { error: 'Нет активной сессии' };
      }
      try {
        await authChangePassword({
          user_id: session.user.id,
          new_password: args.newPassword,
          current_password: args.currentPassword,
        });
        UserStorage.setMustChangePassword(session.user.id, false);
        setMustChangePassword(false);
        logger.info('auth', 'Пароль изменён');
        return { error: null };
      } catch (err: unknown) {
        logger.error('auth', 'Ошибка смены пароля', err);
        return { error: err instanceof Error ? err.message : 'Ошибка смены пароля' };
      }
    },
    [session?.user?.id],
  );

  const signOut = useCallback(async () => {
    if (profile?.username) {
      logger.info('auth', `Выход пользователя: ${profile.username}`);
    }
    SessionStorage.clearSession();
    setSession(null);
    setProfile(null);
    setMustChangePassword(false);
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
        mustChangePassword,
        signIn,
        signUp,
        signOut,
        changePassword,
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
