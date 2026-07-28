import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './auth';
import Layout from './components/Layout';
import Denied from './pages/Denied';
import Dashboard from './pages/Dashboard';
import PostsList from './pages/PostsList';
import Editor from './pages/Editor';
import Calendar from './pages/Calendar';
import Campaigns from './pages/Campaigns';
import Queue from './pages/Queue';
import News from './pages/News';
import Analytics from './pages/Analytics';
import Settings from './pages/Settings';
import Comments from './pages/Comments';
import Newsletters from './pages/Newsletters';
import Subscribers from './pages/Subscribers';
import Search from './pages/Search';
import Audit from './pages/Audit';

function Protected({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>جارٍ التحميل…</div>;
  // لا شاشة دخول محلية يُحوَّل إليها: الباب في المركز، والحارس على الخادم هو
  // من يقرّر — فتُعاد الصفحة من الخادم ليقرّر هو، بدل أن تخمّن الواجهة.
  if (!user) {
    window.location.reload();
    return null;
  }
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <Routes>
      {/* عامة في حارس الدخول الموحّد — تُفتح بلا جلسة */}
      <Route path="/denied" element={<Denied />} />
      <Route path="/" element={<Protected><Dashboard /></Protected>} />
      <Route path="/posts" element={<Protected><PostsList /></Protected>} />
      <Route path="/editor" element={<Protected><Editor /></Protected>} />
      <Route path="/editor/:id" element={<Protected><Editor /></Protected>} />
      <Route path="/calendar" element={<Protected><Calendar /></Protected>} />
      <Route path="/campaigns" element={<Protected><Campaigns /></Protected>} />
      <Route path="/queue" element={<Protected><Queue /></Protected>} />
      <Route path="/news" element={<Protected><News /></Protected>} />
      <Route path="/analytics" element={<Protected><Analytics /></Protected>} />
      <Route path="/comments" element={<Protected><Comments /></Protected>} />
      <Route path="/newsletters" element={<Protected><Newsletters /></Protected>} />
      <Route path="/subscribers" element={<Protected><Subscribers /></Protected>} />
      <Route path="/search" element={<Protected><Search /></Protected>} />
      <Route path="/settings" element={<Protected><Settings /></Protected>} />
      <Route path="/audit" element={<Protected><Audit /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
