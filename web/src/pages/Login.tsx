import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Scale } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';

export default function Login() {
  const { needsSetup, refresh, user } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) {
    navigate('/');
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      if (needsSetup) {
        await api.post('/auth/setup', { name, email, password });
      } else {
        await api.post('/auth/login', { email, password });
      }
      await refresh();
      navigate('/');
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <div className="brand-mark" style={{ width: 52, height: 52, borderRadius: 13 }}>
            <Scale size={28} />
          </div>
          <h1>منصة ناف للتسويق</h1>
        </div>
        <p className="sub">
          {needsSetup ? 'التهيئة الأولى — إنشاء حساب المدير العام' : 'شركة ناف للاستشارات القانونية'}
        </p>

        {needsSetup && (
          <div className="field">
            <label>الاسم</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
        )}
        <div className="field">
          <label>البريد الإلكتروني</label>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="field">
          <label>كلمة المرور</label>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {err && <p className="err">{err}</p>}
        <button className="btn" style={{ width: '100%', marginTop: 8 }} disabled={busy}>
          {busy ? '…' : needsSetup ? 'إنشاء الحساب والدخول' : 'تسجيل الدخول'}
        </button>
      </form>
    </div>
  );
}
