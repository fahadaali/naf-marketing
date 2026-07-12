import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';

export type User = {
  id: string;
  name: string;
  email: string;
  role_name: 'writer' | 'marketing_manager' | 'general_manager';
};

type AuthState = {
  user: User | null;
  permissions: Record<string, boolean>;
  loading: boolean;
  needsSetup: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  can: (key: string) => boolean;
};

const AuthContext = createContext<AuthState>(null as any);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);

  async function refresh() {
    try {
      const [me, setup] = await Promise.all([
        api.get('/auth/me'),
        api.get('/auth/setup-status').catch(() => ({ needsSetup: false })),
      ]);
      setUser(me.user);
      setPermissions(me.permissions || {});
      setNeedsSetup(setup.needsSetup);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function logout() {
    await api.post('/auth/logout');
    setUser(null);
    setPermissions({});
  }

  const can = (key: string) => !!permissions[key];

  return (
    <AuthContext.Provider value={{ user, permissions, loading, needsSetup, refresh, logout, can }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
