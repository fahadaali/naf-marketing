import { NavLink, useNavigate } from 'react-router-dom';
import { useState, type ReactNode } from 'react';
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
  Search,
  ShieldCheck,
  Mails,
  Users,
} from 'lucide-react';
import { useAuth } from '../auth';
import { ROLE_LABELS } from '../api';
import NotificationBell from './NotificationBell';
import { ThemeToggle } from './ThemeToggle';
import { NafLogo } from './brand/NafLogo';

type NavItem = { to: string; label: string; icon: ReactNode; show?: boolean };

function TopSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  return (
    <form
      style={{ position: 'relative', width: 280 }}
      onSubmit={(e) => { e.preventDefault(); if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`); }}
    >
      <Search size={15} style={{ position: 'absolute', insetInlineStart: 11, top: 10, color: 'var(--muted-foreground)' }} />
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
  const sz = 18;

  const items: NavItem[] = [
    { to: '/', label: 'لوحة التحكم', icon: <LayoutDashboard size={sz} /> },
    { to: '/posts', label: 'إدارة المحتوى', icon: <FileText size={sz} /> },
    { to: '/editor', label: 'إنشاء محتوى', icon: <PenLine size={sz} />, show: can('draft.edit') },
    { to: '/calendar', label: 'التقويم', icon: <CalendarDays size={sz} /> },
    { to: '/campaigns', label: 'الحملات', icon: <Target size={sz} /> },
    { to: '/queue', label: 'طابور الاعتماد', icon: <ListChecks size={sz} />, show: can('content.review') },
    { to: '/news', label: 'خلاصة الأخبار', icon: <Newspaper size={sz} /> },
    { to: '/analytics', label: 'التحليلات', icon: <BarChart3 size={sz} />, show: can('analytics.view') },
    { to: '/comments', label: 'التعليقات والرسائل', icon: <MessageCircle size={sz} />, show: can('comments.manage') },
    { to: '/newsletters', label: 'النشرات والمقالات', icon: <Mails size={sz} />, show: can('newsletter.manage') },
    { to: '/subscribers', label: 'المشتركون', icon: <Users size={sz} />, show: can('newsletter.manage') },
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
          <NafLogo variant="mark" className="h-12 shrink-0" />
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
            <ThemeToggle iconSize={16} />
            <div className="avatar">{initials}</div>
            <div style={{ lineHeight: 1.35 }}>
              <div style={{ fontWeight: 600 }}>{user?.name}</div>
              <div className="muted" style={{ fontSize: 'var(--text-xs)' }}>
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
