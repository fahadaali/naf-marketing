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
/* مجموعات التنقّل الأربع — أسماؤها في `naf-terms.md` §٢، ولوحةُ التحكم
   خارجها: هي أوّل ما يُفتح ولا تنتمي إلى ما بعدها. */
type NavGroup = { key: string; label: string | null; items: NavItem[] };

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

  /* أربعُ مجموعاتٍ بدل ثلاثة عشر عنصراً في عمودٍ واحد. من يبحث عن
     «المشتركين» كان يقرأ الثلاثة عشر كلَّها لأن لا شيء يقول أين يبحث. */
  const groups: NavGroup[] = [
    {
      key: 'home',
      label: null,
      items: [{ to: '/', label: 'لوحة التحكم', icon: <LayoutDashboard size={sz} /> }],
    },
    {
      key: 'content',
      label: 'المحتوى',
      items: [
        { to: '/posts', label: 'إدارة المحتوى', icon: <FileText size={sz} /> },
        { to: '/editor', label: 'إنشاء محتوى', icon: <PenLine size={sz} />, show: can('draft.edit') },
        { to: '/calendar', label: 'التقويم', icon: <Calendar size={sz} /> },
        { to: '/campaigns', label: 'الحملات', icon: <Target size={sz} /> },
        { to: '/queue', label: 'طابور الاعتماد', icon: <ListChecks size={sz} />, show: can('content.review') },
        { to: '/news', label: 'خلاصة الأخبار', icon: <Newspaper size={sz} /> },
      ],
    },
    {
      key: 'measurement',
      label: 'القياس',
      items: [{ to: '/analytics', label: 'التحليلات', icon: <BarChart3 size={sz} />, show: can('analytics.view') }],
    },
    {
      key: 'communication',
      label: 'التواصل',
      items: [
        { to: '/comments', label: 'التعليقات والرسائل', icon: <MessageCircle size={sz} />, show: can('comments.manage') },
        { to: '/newsletters', label: 'النشرات والمقالات', icon: <Mails size={sz} />, show: can('newsletter.manage') },
        { to: '/subscribers', label: 'المشتركون', icon: <Users size={sz} />, show: can('newsletter.manage') },
      ],
    },
    {
      key: 'system',
      label: 'النظام',
      items: [
        { to: '/audit', label: 'سجل التدقيق', icon: <ShieldCheck size={sz} />, show: can('audit.view') },
        {
          to: '/settings',
          label: 'الإعدادات والمستخدمون',
          icon: <Settings size={sz} />,
          show: can('settings.manage') || can('users.manage'),
        },
      ],
    },
  ];

  /* المجموعة الفارغة تسقط بعنوانها: عضوٌ لا يملك تصاريح «النظام» لا يرى
     عنوانه معلّقاً فوق فراغ. */
  const visible = groups
    .map((g) => ({ ...g, items: g.items.filter((i) => i.show === undefined || i.show) }))
    .filter((g) => g.items.length > 0);

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
          {visible.map((g) => (
            <div key={g.key}>
              {g.label && <div className="naf-nav-section">{g.label}</div>}
              {g.items.map((i) => (
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
            </div>
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
              name={user?.name}
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
