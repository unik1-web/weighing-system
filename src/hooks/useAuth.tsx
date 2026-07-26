import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { UserStorage, SessionStorage, ProfileStorage, initializeStorage, type Session as LocalSession } from '@/lib/storage';

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
    // Initialize storage on mount
    console.log('[AuthProvider] Initializing');
    initializeStorage();

    // Load session from storage
    const storedSession = SessionStorage.getSession();
    console.log('[AuthProvider] Stored session:', storedSession);
    if (storedSession) {
      setSession(storedSession);
      setProfile({
        username: storedSession.profile.username,
        display_name: storedSession.profile.display_name,
        role: storedSession.profile.role,
      });
      console.log('[AuthProvider] Session restored for user:', storedSession.user.username);
    } else {
      console.log('[AuthProvider] No stored session found');
    }
    setLoading(false);
  }, []);

  const signIn = useCallback(async (username: string, password: string) => {
    try {
      const user = UserStorage.validatePassword(username, password);
      if (!user) {
        console.log('[Auth] Invalid credentials for:', username);
        return { error: 'Invalid username or password' };
      }

      const profile = ProfileStorage.getProfile(user.id);
      if (!profile) {
        console.log('[Auth] Profile not found for user:', user.id);
        return { error: 'User profile not found' };
      }

      const session: LocalSession = { user, profile };
      SessionStorage.setSession(session);
      setSession(session);
      setProfile(profile);

      console.log('[Auth] Successfully signed in as:', username, 'Session:', session);
      return { error: null };
    } catch (err: any) {
      console.error('[Auth] Sign in error:', err);
      return { error: err.message };
    }
  }, []);

  const signUp = useCallback(async (username: string, password: string, name: string) => {
    try {
      console.log('[Auth] Creating user:', username);
      const user = UserStorage.createUser(username, password, name);
      console.log('[Auth] User created:', user.id);
      
      const profile = ProfileStorage.getProfile(user.id);
      console.log('[Auth] Profile retrieved:', profile);

      if (!profile) {
        console.error('[Auth] Profile not found after creation');
        return { error: 'Failed to create profile' };
      }

      const session: LocalSession = { user, profile };
      SessionStorage.setSession(session);
      setSession(session);
      setProfile(profile);

      console.log('[Auth] Successfully signed up as:', username);
      return { error: null };
    } catch (err: any) {
      console.error('[Auth] Sign up error:', err);
      return { error: err.message };
    }
  }, []);

  const signOut = useCallback(async () => {
    SessionStorage.clearSession();
    setSession(null);
    setProfile(null);
  }, []);

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
