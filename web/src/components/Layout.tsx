import { NavLink, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../auth';
import { ROLE_LABELS } from '../api';

type NavItem = { to: string; label: string; icon: string; show?: boolean };

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout, can } = useAuth();
  const navigate = useNavigate();

  const items: NavItem[] = [
    { to: '/', label: 'الداشبورد', icon: '📊' },
    { to: '/posts', label: 'المحتوى', icon: '📝' },
    { to: '/editor', label: 'إنشاء محتوى', icon: '✍️', show: can('draft.edit') },
    { to: '/calendar', label: 'التقويم', icon: '🗓️' },
    { to: '/campaigns', label: 'الحملات', icon: '🎯' },
    { to: '/queue', label: 'طابور الاعتماد', icon: '✅', show: can('content.review') },
    { to: '/news', label: 'خلاصة الأخبار', icon: '📰' },
    { to: '/analytics', label: 'التحليلات', icon: '📈', show: can('analytics.view') },
    { to: '/settings', label: 'الإعدادات والمستخدمون', icon: '⚙️', show: can('settings.manage') || can('users.manage') },
  ];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="logo">
          منصة ناف
          <small>لإدارة التسويق</small>
        </div>
        <nav>
          {items
            .filter((i) => i.show === undefined || i.show)
            .map((i) => (
              <NavLink key={i.to} to={i.to} end={i.to === '/'} className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
                <span className="nav-icon">{i.icon}</span>
                <span>{i.label}</span>
              </NavLink>
            ))}
        </nav>
      </aside>

      <div className="main">
        <header className="topbar">
          <div />
          <div className="user-chip">
            <span>{user?.name}</span>
            <span className="badge blue">{user ? ROLE_LABELS[user.role_name] : ''}</span>
            <button
              className="btn ghost sm"
              onClick={async () => {
                await logout();
                navigate('/login');
              }}
            >
              خروج
            </button>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
