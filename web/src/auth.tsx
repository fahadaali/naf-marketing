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
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  can: (key: string) => boolean;
};

const AuthContext = createContext<AuthState>(null as any);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  async function refresh() {
    try {
      const me = await api.get('/auth/me');
      setUser(me.user);
      setPermissions(me.permissions || {});
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  // الخروج ينهي جلسة المنصة في الخادم، ثم تُعاد الصفحة ليقرّر الحارس الوجهة —
  // ولا حالة محلية تُصفَّر: مسحُها هنا يعرض واجهةً بلا مستخدم للحظة قبل المغادرة.
  async function logout() {
    await api.post('/auth/logout');
    window.location.assign('/');
  }

  const can = (key: string) => !!permissions[key];

  return (
    <AuthContext.Provider value={{ user, permissions, loading, refresh, logout, can }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
