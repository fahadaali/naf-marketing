import { NavLink, useNavigate } from 'react-router-dom';
import { useEffect, useState, type ReactNode } from 'react';
import {
  LayoutDashboard,
  FileText,
  PenLine,
  CalendarDays,
  Target,
  ListChecks,
  Newspaper,
  BarChart3,
  MessageCircle,
  Settings,
  LogOut,
  Sun,
  Moon,
  Scale,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../auth';
import { ROLE_LABELS } from '../api';
import NotificationBell from './NotificationBell';

type NavItem = { to: string; label: string; icon: ReactNode; show?: boolean };

function useTheme() {
  const [theme, setTheme] = useState<string>(
    () => document.documentElement.getAttribute('data-theme') || 'light',
  );
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('naf-theme', theme);
    } catch {}
  }, [theme]);
  return { theme, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) };
}

function TopSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  return (
    <form
      style={{ position: 'relative', width: 280 }}
      onSubmit={(e) => { e.preventDefault(); if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`); }}
    >
      <Search size={15} style={{ position: 'absolute', insetInlineStart: 11, top: 10, color: 'hsl(var(--muted-foreground))' }} />
      <input
        className="input"
        style={{ paddingInlineStart: 32, height: 34 }}
        placeholder="بحث في المحتوى والأخبار…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
    </form>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout, can } = useAuth();
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
  const sz = 18;

  const items: NavItem[] = [
    { to: '/', label: 'الداشبورد', icon: <LayoutDashboard size={sz} /> },
    { to: '/posts', label: 'إدارة المحتوى', icon: <FileText size={sz} /> },
    { to: '/editor', label: 'إنشاء محتوى', icon: <PenLine size={sz} />, show: can('draft.edit') },
    { to: '/calendar', label: 'التقويم', icon: <CalendarDays size={sz} /> },
    { to: '/campaigns', label: 'الحملات', icon: <Target size={sz} /> },
    { to: '/queue', label: 'طابور الاعتماد', icon: <ListChecks size={sz} />, show: can('content.review') },
    { to: '/news', label: 'خلاصة الأخبار', icon: <Newspaper size={sz} /> },
    { to: '/analytics', label: 'التحليلات', icon: <BarChart3 size={sz} />, show: can('analytics.view') },
    { to: '/comments', label: 'التعليقات والرسائل', icon: <MessageCircle size={sz} />, show: can('comments.manage') },
    { to: '/audit', label: 'سجل التدقيق', icon: <ShieldCheck size={sz} />, show: can('audit.view') },
    {
      to: '/settings',
      label: 'الإعدادات والمستخدمون',
      icon: <Settings size={sz} />,
      show: can('settings.manage') || can('users.manage'),
    },
  ];

  const initials = (user?.name || '؟').trim().charAt(0);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Scale size={20} />
          </div>
          <div className="brand-text">
            <b>منصة ناف</b>
            <small>لإدارة التسويق</small>
          </div>
        </div>
        <div className="nav-section">القائمة</div>
        <nav>
          {items
            .filter((i) => i.show === undefined || i.show)
            .map((i) => (
              <NavLink
                key={i.to}
                to={i.to}
                end={i.to === '/'}
                className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}
              >
                <span className="nav-icon">{i.icon}</span>
                <span>{i.label}</span>
              </NavLink>
            ))}
        </nav>
      </aside>

      <div className="main">
        <header className="topbar">
          <TopSearch />
          <div className="user-chip">
            <NotificationBell />
            <button
              className="icon-btn"
              onClick={toggle}
              title={theme === 'dark' ? 'الوضع الفاتح' : 'الوضع الداكن'}
            >
              {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <div className="avatar">{initials}</div>
            <div style={{ lineHeight: 1.2 }}>
              <div style={{ fontWeight: 600 }}>{user?.name}</div>
              <div className="muted" style={{ fontSize: 12 }}>
                {user ? ROLE_LABELS[user.role_name] : ''}
              </div>
            </div>
            <button
              className="icon-btn"
              title="تسجيل الخروج"
              onClick={async () => {
                await logout();
                navigate('/login');
              }}
            >
              <LogOut size={17} />
            </button>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
