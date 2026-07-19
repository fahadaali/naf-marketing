import { useEffect, useState } from 'react';
import { api } from '../api';

const ACTION_LABELS: Record<string, string> = {
  login: 'تسجيل دخول',
  login_failed: 'محاولة دخول فاشلة',
  logout: 'تسجيل خروج',
  setup: 'تهيئة أول حساب',
  user_create: 'إنشاء مستخدم',
  user_update: 'تعديل مستخدم',
  permission_change: 'تعديل صلاحية',
  settings_update: 'تعديل إعدادات',
  post_delete: 'حذف محتوى',
  basecamp_resync: 'إعادة مزامنة بيسكامب',
  report_run: 'توليد تقرير',
};

function formatRiyadh(iso: string): string {
  try {
    return new Intl.DateTimeFormat('ar-SA-u-nu-latn', { timeZone: 'Asia/Riyadh', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

// سجل التدقيق: من فعل ماذا ومتى — للمدير العام فقط
export default function Audit() {
  const [entries, setEntries] = useState<any[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [action, setAction] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);

  function load() {
    setLoading(true);
    const params = new URLSearchParams();
    if (action) params.set('action', action);
    if (q) params.set('q', q);
    api.get('/audit?' + params.toString())
      .then((d) => { setEntries(d.entries || []); setActions(d.actions || []); })
      .finally(() => setLoading(false));
  }
  useEffect(load, [action]);

  return (
    <div>
      <h1 className="page-title">سجل التدقيق</h1>
      <p className="page-sub">من فعل ماذا ومتى — الإجراءات الإدارية والحساسة على المنصة</p>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ gap: 16, alignItems: 'flex-end' }}>
          <div className="field" style={{ margin: 0, minWidth: 200 }}>
            <label>نوع الإجراء</label>
            <select className="select" value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="">كل الإجراءات</option>
              {actions.map((a) => <option key={a} value={a}>{ACTION_LABELS[a] || a}</option>)}
            </select>
          </div>
          <div className="field" style={{ margin: 0, minWidth: 200 }}>
            <label>اسم الفاعل</label>
            <form onSubmit={(e) => { e.preventDefault(); load(); }}>
              <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث باسم المستخدم…" />
            </form>
          </div>
          <button className="btn ghost" onClick={load}>بحث</button>
        </div>
      </div>

      <div className="card">
        {loading && <p className="muted">جارٍ التحميل…</p>}
        {!loading && (
          <table className="table">
            <thead><tr><th>الفاعل</th><th>الإجراء</th><th>الكيان</th><th>التفاصيل</th><th>الوقت</th></tr></thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>{e.actor_name || '—'}</td>
                  <td>{ACTION_LABELS[e.action] || e.action}</td>
                  <td className="muted">{e.entity_type ? `${e.entity_type}${e.entity_id ? ` #${String(e.entity_id).slice(0, 8)}` : ''}` : '—'}</td>
                  <td className="muted">{e.details || '—'}</td>
                  <td className="muted">{formatRiyadh(e.created_at)}</td>
                </tr>
              ))}
              {entries.length === 0 && <tr><td colSpan={5} className="muted">لا توجد سجلات</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
