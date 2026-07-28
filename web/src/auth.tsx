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
  logout: () => void;
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

  function logout() {
    // الخروج خارج بادئة `/api` — مسجَّل قبل الحارس ليعمل لمن جلسته انتهت.
    //
    // ═══ تنقّلٌ كامل بـ POST، لا نداء `fetch` ثم قفزة ═══
    //
    // كان: `fetch` يقرأ الوجهة من `next` في الردّ، فإن تعذّر النداء أو لم
    // يُقرأ جسمه بقيت الوجهة الجذر. والجذر محميّ، فيحوّله الحارس إلى المركز،
    // وجلسة المركز لم تُمسّ فتُصدر رمزاً جديداً — فيعود الخارجُ إلى الشاشة
    // التي خرج منها. أي أن كل فشلٍ في ذلك النداء، أياً كان سببه، يُخرج
    // بالمستخدم إلى المشهد نفسه بالضبط: «ضغطتُ خروج فبقيتُ مكاني».
    //
    // ومسارُ التنقّل لا يمرّ بشيء من ذلك: الخادم يردّ التنقّل بـ٣٠٢ إلى
    // المركز مباشرةً — لا جسم يُقرأ ولا وجهة تُستنتج ولا احتياطيّ يخطئ.
    // ويعمل ولو لم يصل الردّ أصلاً، لأن المتصفّح هو من يتنقّل لا الشيفرة.
    //
    // و`POST` لا `GET`: رابطٌ يُخرج صاحبَه بمجرّد فتحه تكفي صورةٌ في صفحة
    // لتشغيله.
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/auth/logout';
    document.body.appendChild(form);
    form.submit();
  }

  const can = (key: string) => !!permissions[key];

  return (
    <AuthContext.Provider value={{ user, permissions, loading, refresh, logout, can }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
