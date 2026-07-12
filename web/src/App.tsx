import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import PostsList from './pages/PostsList';
import Editor from './pages/Editor';
import Calendar from './pages/Calendar';
import Campaigns from './pages/Campaigns';
import Queue from './pages/Queue';
import News from './pages/News';
import Analytics from './pages/Analytics';
import Settings from './pages/Settings';

function Protected({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>جارٍ التحميل…</div>;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Protected><Dashboard /></Protected>} />
      <Route path="/posts" element={<Protected><PostsList /></Protected>} />
      <Route path="/editor" element={<Protected><Editor /></Protected>} />
      <Route path="/editor/:id" element={<Protected><Editor /></Protected>} />
      <Route path="/calendar" element={<Protected><Calendar /></Protected>} />
      <Route path="/campaigns" element={<Protected><Campaigns /></Protected>} />
      <Route path="/queue" element={<Protected><Queue /></Protected>} />
      <Route path="/news" element={<Protected><News /></Protected>} />
      <Route path="/analytics" element={<Protected><Analytics /></Protected>} />
      <Route path="/settings" element={<Protected><Settings /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
