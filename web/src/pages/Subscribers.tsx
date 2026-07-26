import { formatNumber } from '../lib/format';
import { useEffect, useState } from 'react';
import { Plus, Upload, Trash2, UserMinus, UserCheck, Search } from 'lucide-react';
import { api, formatRiyadh } from '../api';

const STATUS_AR: Record<string, string> = {
  active: 'نشط', unsubscribed: 'ألغى الاشتراك', bounced: 'مرتدّ', pending: 'بانتظار التأكيد',
};
const STATUS_BADGE: Record<string, string> = {
  active: 'green', unsubscribed: 'gray', bounced: 'red', pending: 'blue',
};
const SOURCE_AR: Record<string, string> = {
  article_page: 'صفحة مقالة', manual: 'إضافة يدوية', import: 'استيراد',
};

// إدارة مشتركي النشرة البريدية — مع سجل الموافقة (مطلب نظامي)
export default function Subscribers() {
  const [rows, setRows] = useState<any[]>([]);
  const [counts, setCounts] = useState<any>({ total: 0, active: 0, unsubscribed: 0, bounced: 0 });
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState('');
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState('');

  function load() {
    const p = new URLSearchParams();
    if (status) p.set('status', status);
    if (q) p.set('q', q);
    api.get(`/subscribers?${p}`).then((d) => { setRows(d.subscribers || []); setCounts(d.counts || {}); })
      .catch((e) => setMsg(e.message));
  }
  useEffect(load, [status]);

  async function addOne() {
    const email = prompt('البريد الإلكتروني:');
    if (!email?.trim()) return;
    const name = prompt('الاسم (اختياري):') || '';
    try { await api.post('/subscribers', { email: email.trim(), name }); load(); }
    catch (e: any) { setMsg(e.message); }
  }

  async function doImport() {
    if (!importText.trim()) return;
    try {
      const d = await api.post('/subscribers/import', { text: importText });
      setMsg(`أُضيف ${d.added} · تُخطّي ${d.skipped}`);
      setImportText(''); setImporting(false); load();
    } catch (e: any) { setMsg(e.message); }
  }

  async function setStatusOf(id: string, s: string) {
    try { await api.patch(`/subscribers/${id}`, { status: s }); load(); }
    catch (e: any) { setMsg(e.message); }
  }

  async function remove(id: string) {
    if (!confirm('حذف هذا المشترك نهائياً؟')) return;
    try { await api.del(`/subscribers/${id}`); load(); }
    catch (e: any) { setMsg(e.message); }
  }

  return (
    <div>
      <div className="row" style={{ marginBottom: 16 }}>
        <div>
          <h1 className="page-title">المشتركون</h1>
          <p className="page-sub" style={{ margin: 0 }}>قائمة النشرة البريدية مع سجل الموافقة</p>
        </div>
        <div className="spacer" />
        {msg && <span className="ok">{msg}</span>}
        <button className="btn ghost" onClick={() => setImporting((v) => !v)}><Upload size={15} /> استيراد</button>
        <button className="btn" onClick={addOne}><Plus size={15} /> إضافة</button>
      </div>

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Stat label="الإجمالي" value={counts.total || 0} />
        <Stat label="نشط" value={counts.active || 0} />
        <Stat label="ألغى الاشتراك" value={counts.unsubscribed || 0} />
        <Stat label="مرتدّ" value={counts.bounced || 0} />
      </div>

      {importing && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h4 style={{ marginTop: 0 }}>استيراد مشتركين</h4>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
            سطر لكل مشترك بصيغة: <code>email@example.com, الاسم</code> — المكرّر يُتخطّى تلقائياً.
          </p>
          <textarea className="input" rows={6} value={importText} onChange={(e) => setImportText(e.target.value)}
                    placeholder={'ahmed@example.com, أحمد\nsara@example.com, سارة'} />
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn" onClick={doImport}>استيراد</button>
            <button className="btn ghost" onClick={() => setImporting(false)}>إلغاء</button>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row" style={{ gap: 8 }}>
          <div className="seg">
            <button className={status === '' ? 'on' : ''} onClick={() => setStatus('')}>الكل</button>
            <button className={status === 'active' ? 'on' : ''} onClick={() => setStatus('active')}>نشط</button>
            <button className={status === 'unsubscribed' ? 'on' : ''} onClick={() => setStatus('unsubscribed')}>ملغى</button>
          </div>
          <div className="spacer" />
          <input className="input" style={{ maxWidth: 260 }} placeholder="بحث بالبريد أو الاسم…"
                 value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} />
          <button className="btn ghost sm" onClick={load}><Search size={14} /></button>
        </div>
      </div>

      <div className="card">
        <table className="table">
          <thead>
            <tr><th>البريد</th><th>الاسم</th><th>الحالة</th><th>المصدر</th><th>تاريخ الموافقة</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td>{s.email}</td>
                <td>{s.name || '—'}</td>
                <td><span className={`badge ${STATUS_BADGE[s.status] || 'gray'}`}>{STATUS_AR[s.status] || s.status}</span></td>
                <td className="muted">{SOURCE_AR[s.consent_source] || s.consent_source || '—'}</td>
                <td className="muted">{s.consent_at ? formatRiyadh(s.consent_at) : '—'}</td>
                <td>
                  {s.status === 'active'
                    ? <button className="btn sm ghost" title="إلغاء الاشتراك" onClick={() => setStatusOf(s.id, 'unsubscribed')}><UserMinus size={13} /></button>
                    : <button className="btn sm ghost" title="إعادة التفعيل" onClick={() => setStatusOf(s.id, 'active')}><UserCheck size={13} /></button>}
                  <button className="btn sm ghost" title="حذف" onClick={() => remove(s.id)}><Trash2 size={13} /></button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="muted">لا يوجد مشتركون بعد.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="card stat">
      <div className="num">{formatNumber(value)}</div>
      <div className="label">{label}</div>
    </div>
  );
}
