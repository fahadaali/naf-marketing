import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { useAuth } from './auth';
import Layout from './components/Layout';

/* ═══ الشاشات تُجلب عند الحاجة لا مع أول فتحة ═══

   كانت الستّ عشرة كلُّها في حزمةٍ واحدة — ٥٠٣ ك.ب تتجاوز حدّ التحذير —
   فمن يفتح لوحة التحكم يحمّل معها محرّر النشرة ومحرّر المحتوى وشاشة
   التحليلات، وهي الأثقل ولا يفتحها في تلك الجلسة.

   والثلاث الأولى مباشرةٌ لا مؤجَّلة: `Login` و`Denied` بابان يُبلغان قبل
   أن تُقلع اللوحة، و`Dashboard` أول ما يُفتح — وتأجيلُ ما يُطلب فوراً
   يزيد رحلةً ولا يوفّر شيئاً. */
import Login from './pages/Login';
import Denied from './pages/Denied';
import Dashboard from './pages/Dashboard';

const PostsList = lazy(() => import('./pages/PostsList'));
const Editor = lazy(() => import('./pages/Editor'));
const Calendar = lazy(() => import('./pages/Calendar'));
const Campaigns = lazy(() => import('./pages/Campaigns'));
const Queue = lazy(() => import('./pages/Queue'));
const News = lazy(() => import('./pages/News'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Settings = lazy(() => import('./pages/Settings'));
const Comments = lazy(() => import('./pages/Comments'));
const Newsletters = lazy(() => import('./pages/Newsletters'));
const Subscribers = lazy(() => import('./pages/Subscribers'));
const Search = lazy(() => import('./pages/Search'));
const Audit = lazy(() => import('./pages/Audit'));

/* شاشة «لا صلاحية» — naf-terms.md §٧ · الأخطاء · «لا صلاحية».

   والأيقونة `Lock` من `naf-icons.md`: «محتوى مقفل يراه المستخدم ولا يفتحه»
   — وهي حال هذه الشاشة بالضبط. ولا تُستعار `ShieldX`: تلك لمن رُدّ على باب
   منصة فلم يدخلها، واستعارتها هنا تجعل من يقف داخلها يقرأ أنه مُنع منها.

   ولا تُقلب في الاتجاه: قفلٌ لا سهم. */
function NoPermission() {
  return (
    <main className="min-h-full grid place-items-center p-6">
      <div className="grid justify-items-center gap-4 max-w-prose text-center">
        <Lock className="text-muted-foreground" size={40} aria-hidden="true" />
        <p className="text-base text-muted-foreground" role="status">
          لا تملك صلاحية الوصول لهذه الصفحة
        </p>
      </div>
    </main>
  );
}

/**
 * الحارس. الدخولُ شرطٌ أوّل، والتصريحُ شرطٌ ثانٍ حين يُطلب.
 *
 * وكان الشرط الأول وحده: القائمة الجانبية تُخفي ما لا يملكه العضو، والمسار
 * يبقى مفتوحاً لمن كتبه في شريط العنوان أو حفظه في مفضّلته. فيرى `writer`
 * شاشةَ التحليلات كاملةً ثم تفشل نداءاتها وحدها — جداولُ فارغة ورسائلُ خطأ
 * مكان جملةٍ واحدة تقول إنه لا يملكها.
 *
 * والإخفاء هنا راحةٌ للقارئ لا حاجز أمني: كل مسار محميّ في الخادم كذلك،
 * و`hasPermission` هناك هي الحكم.
 */
function Protected({
  children,
  permission,
}: {
  children: JSX.Element;
  /** تصريحٌ واحد، أو عدّةٌ يكفي أحدها — شاشة الإعدادات يفتحها تصريحان. */
  permission?: string | string[];
}) {
  const { user, loading, can } = useAuth();
  const location = useLocation();
  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>جارٍ التحميل…</div>;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  const allowed = permission
    ? (Array.isArray(permission) ? permission : [permission]).some(can)
    : true;
  if (!allowed) {
    return (
      <Layout>
        <NoPermission />
      </Layout>
    );
  }
  /* الانتظار داخل الهيكل لا فوقه: القائمة الجانبية والترويسة تبقيان،
     ولا تومض الشاشة بيضاء بين نقرةٍ وأخرى. والنصّ من naf-terms §٤ —
     التحميل والانتظار. */
  return (
    <Layout>
      <Suspense fallback={<p className="muted" style={{ padding: 40, textAlign: 'center' }}>جارٍ التحميل…</p>}>
        {children}
      </Suspense>
    </Layout>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      {/* عامة في حارس الدخول الموحّد — تُفتح بلا جلسة */}
      <Route path="/denied" element={<Denied />} />
      {/* التصريح المطلوب لكل شاشة هو نفسه الذي تُخفى به من القائمة الجانبية
          في `Layout.tsx` — قائمةٌ واحدة في موضعين تفترق أوّل ما تُعدَّل في
          أحدهما. وما لا تصريح له مفتوحٌ لكل عضو: الشاشات الخمس الأولى
          يراها `writer` كما يراها المدير العام. */}
      <Route path="/" element={<Protected><Dashboard /></Protected>} />
      <Route path="/posts" element={<Protected><PostsList /></Protected>} />
      <Route path="/editor" element={<Protected permission="draft.edit"><Editor /></Protected>} />
      <Route path="/editor/:id" element={<Protected permission="draft.edit"><Editor /></Protected>} />
      <Route path="/calendar" element={<Protected><Calendar /></Protected>} />
      <Route path="/campaigns" element={<Protected><Campaigns /></Protected>} />
      <Route path="/queue" element={<Protected permission="content.review"><Queue /></Protected>} />
      <Route path="/news" element={<Protected><News /></Protected>} />
      <Route path="/analytics" element={<Protected permission="analytics.view"><Analytics /></Protected>} />
      <Route path="/comments" element={<Protected permission="comments.manage"><Comments /></Protected>} />
      <Route path="/newsletters" element={<Protected permission="newsletter.manage"><Newsletters /></Protected>} />
      <Route path="/subscribers" element={<Protected permission="newsletter.manage"><Subscribers /></Protected>} />
      <Route path="/search" element={<Protected><Search /></Protected>} />
      <Route
        path="/settings"
        element={
          <Protected permission={['settings.manage', 'users.manage']}>
            <Settings />
          </Protected>
        }
      />
      <Route path="/audit" element={<Protected permission="audit.view"><Audit /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
