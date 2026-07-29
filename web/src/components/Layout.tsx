import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useState, type ReactNode } from 'react';
import {
  LayoutDashboard,
  FileText,
  PenLine,
  Calendar,
  Target,
  ListChecks,
  Newspaper,
  BarChart3,
  MessageCircle,
  Settings,
  Search,
  ShieldCheck,
  Mails,
  Users,
} from 'lucide-react';
import { useAuth } from '../auth';
import { ROLE_LABELS } from '../api';
import NotificationBell from './NotificationBell';
import { NafLogo } from './brand/NafLogo';
import {
  AppShell,
  AppMain,
  AppHeader,
  HeaderStart,
  HeaderEnd,
  AppContent,
  Sidebar,
  SidebarHeader,
  SidebarNav,
  ShellBackdrop,
  MenuButton,
  AccountMenu,
  navLinkClassName,
  useShell,
} from '../naf/ui/app-shell';
import { ThemeToggle } from '../naf/ui/theme-toggle';

type NavItem = { to: string; label: string; icon: ReactNode; show?: boolean };

function TopSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  return (
    <form
      className="top-search"
      onSubmit={(e) => {
        e.preventDefault();
        if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`);
      }}
    >
      <Search size={20} className="top-search-icon" aria-hidden="true" />
      <input
        className="input top-search-input"
        placeholder="بحث في المحتوى والأخبار…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
    </form>
  );
}

/** يغلق الدرج عند الانتقال — وإلا بقي مفتوحاً فوق الشاشة الجديدة. */
function CloseDrawerOnNavigate() {
  const { setOpen } = useShell();
  const { pathname } = useLocation();
  useEffect(() => {
    setOpen(false);
  }, [pathname]);
  return null;
}

function ShellBody({ children }: { children: ReactNode }) {
  const { user, logout, can } = useAuth();
  const sz = 24; // مقاس التنقّل — naf-icons.md «المقاسات»

  const items: NavItem[] = [
    { to: '/', label: 'لوحة التحكم', icon: <LayoutDashboard size={sz} /> },
    { to: '/posts', label: 'إدارة المحتوى', icon: <FileText size={sz} /> },
    { to: '/editor', label: 'إنشاء محتوى', icon: <PenLine size={sz} />, show: can('draft.edit') },
    { to: '/calendar', label: 'التقويم', icon: <Calendar size={sz} /> },
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

  return (
    <>
      <CloseDrawerOnNavigate />
      <ShellBackdrop />

      <Sidebar>
        <SidebarHeader>
          <NafLogo variant="mark" className="h-12 shrink-0" />
          <div>
            <div className="naf-sidebar-brand-name">منصة ناف</div>
            <div className="naf-sidebar-brand-sub">لإدارة التسويق</div>
          </div>
        </SidebarHeader>
        <SidebarNav>
          <div className="naf-nav-section">القائمة</div>
          {items
            .filter((i) => i.show === undefined || i.show)
            .map((i) => (
              <NavLink
                key={i.to}
                to={i.to}
                end={i.to === '/'}
                className={({ isActive }) => navLinkClassName(isActive)}
              >
                {i.icon}
                <span>{i.label}</span>
              </NavLink>
            ))}
        </SidebarNav>
      </Sidebar>

      <AppMain>
        <AppHeader>
          <HeaderStart>
            <MenuButton />
            <TopSearch />
          </HeaderStart>
          <HeaderEnd>
            <NotificationBell />
            {/* الخروج داخل القائمة لا أيقونةً مفردة بجوار الجرس: كانت
                أيقونةً وحدها بلا نصّ، فتُقرأ سهماً غامضاً وتُنقر سهواً —
                وإنهاء الجلسة لا رجعة فيه. */}
            <AccountMenu
              name={user?.name ?? 'مستخدم'}
              email={user?.email}
              role={user ? ROLE_LABELS[user.role_name] : undefined}
              appearance={<ThemeToggle />}
              onLogout={() => logout()}
            />
          </HeaderEnd>
        </AppHeader>
        <AppContent>{children}</AppContent>
      </AppMain>
    </>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <AppShell>
      <ShellBody>{children}</ShellBody>
    </AppShell>
  );
}
