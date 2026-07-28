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
    // صفحة الرفض لا تسأل عن العضو عند الإقلاع. هي عامة فتُحمَّل اللوحة
    // عليها بلا جلسة؛ ولو سألت `/api/me` لردّ الوسيط ٤٠١ فحوّل إلى المركز،
    // فيسقط الاستقبال، فيعود إلى الرفض — دورة لا تُقرأ فيها الرسالة أصلاً.
    if (window.location.pathname === '/denied') {
      setLoading(false);
      return;
    }
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

  async function logout() {
    // الخروج خارج بادئة `/api` — مسجَّل قبل الحارس ليعمل لمن جلسته انتهت.
    //
    // والوجهة يقولها الخادم، وهي المركز لا جذر هذه المنصة. كان الجذر:
    // وهو محميّ، فيحوّله الحارس إلى المركز، وجلسة المركز لم تُمسّ فتُصدر
    // رمزاً جديداً — فيعود الخارجُ إلى شاشته قبل أن يقرأ شيئاً، ويقرأ من
    // ذلك أن الزرّ لا يعمل.
    let next = '/';
    try {
      const res = await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
      const data = await res.json().catch(() => null);
      if (data && typeof data.next === 'string' && data.next) next = data.next;
    } catch {
      // تعذّر النداء: الوجهة تبقى الجذر، والحارس يردّه إلى الباب.
    }
    setUser(null);
    setPermissions({});
    // تنقّلٌ كامل لا `router.push`: الوجهة أصلٌ آخر، ونداء `fetch` لا يبلغه.
    window.location.href = next;
  }

  const can = (key: string) => !!permissions[key];

  return (
    <AuthContext.Provider value={{ user, permissions, loading, refresh, logout, can }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
