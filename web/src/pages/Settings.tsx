import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api, ROLE_LABELS, formatRiyadh } from '../api';
import { useAuth } from '../auth';
import Modal from '../components/Modal';
import { KNOWN_PLATFORMS, PLATFORM_META, PlatformIcon, platformLabel } from '../platforms';

export default function Settings() {
  const { can } = useAuth();
  const tabs = [
    can('users.manage') && { id: 'users', label: 'المستخدمون' },
    can('permissions.manage') && { id: 'permissions', label: 'الصلاحيات' },
    can('settings.manage') && { id: 'feeds', label: 'خلاصات RSS' },
    can('settings.manage') && { id: 'platforms', label: 'المنصات والمزوّد' },
    can('settings.manage') && { id: 'integrations', label: 'التكاملات' },
  ].filter(Boolean) as { id: string; label: string }[];

  const [tab, setTab] = useState(tabs[0]?.id || 'users');

  return (
    <div>
      <h1 className="page-title">الإعدادات والمستخدمون</h1>
      <div className="row" style={{ marginBottom: 16 }}>
        {tabs.map((t) => (
          <button key={t.id} className={`btn sm ${tab === t.id ? '' : 'ghost'}`} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>
      {tab === 'users' && <Users />}
      {tab === 'permissions' && <Permissions />}
      {tab === 'feeds' && <Feeds />}
      {tab === 'platforms' && <Platforms />}
      {tab === 'integrations' && <Integrations />}
    </div>
  );
}

/* ===== المستخدمون ===== */
function Users() {
  const [users, setUsers] = useState<any[]>([]);
  const [show, setShow] = useState(false);
  function load() { api.get('/users').then((d) => setUsers(d.users)); }
  useEffect(load, []);

  async function toggle(u: any) {
    await api.patch(`/users/${u.id}`, { is_active: !u.is_active });
    load();
  }
  async function changeRole(u: any, role: string) {
    await api.patch(`/users/${u.id}`, { role_name: role });
    load();
  }

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>المستخدمون</h3>
        <div className="spacer" />
        <button className="btn sm" onClick={() => setShow(true)}><Plus size={15} /> مستخدم</button>
      </div>
      <table className="table">
        <thead><tr><th>الاسم</th><th>البريد</th><th>الدور</th><th>الحالة</th><th></th></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.name}</td>
              <td className="muted">{u.email}</td>
              <td>
                <select className="select" style={{ width: 150 }} value={u.role_name} onChange={(e) => changeRole(u, e.target.value)}>
                  {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </td>
              <td><span className={`badge ${u.is_active ? 'green' : 'red'}`}>{u.is_active ? 'نشط' : 'معطّل'}</span></td>
              <td><button className="btn ghost sm" onClick={() => toggle(u)}>{u.is_active ? 'تعطيل' : 'تفعيل'}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {show && <NewUser onClose={() => setShow(false)} onSaved={() => { setShow(false); load(); }} />}
    </div>
  );
}

function NewUser({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: '', email: '', password: '', role_name: 'writer' });
  const [err, setErr] = useState('');
  async function save() {
    setErr('');
    try { await api.post('/users', f); onSaved(); } catch (e: any) { setErr(e.message); }
  }
  return (
    <Modal title="مستخدم جديد" onClose={onClose}>
      <div className="field"><label>الاسم</label><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
      <div className="field"><label>البريد</label><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
      <div className="field"><label>كلمة المرور (٨ أحرف فأكثر)</label><input className="input" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></div>
      <div className="field">
        <label>الدور</label>
        <select className="select" value={f.role_name} onChange={(e) => setF({ ...f, role_name: e.target.value })}>
          {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {err && <p className="err">{err}</p>}
      <button className="btn" onClick={save}>حفظ</button>
    </Modal>
  );
}

/* ===== مصفوفة الصلاحيات ===== */
function Permissions() {
  const [rows, setRows] = useState<any[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const roles = ['writer', 'marketing_manager', 'general_manager'];

  function load() {
    api.get('/permissions').then((d) => { setRows(d.permissions); setLabels(d.labels); });
  }
  useEffect(load, []);

  const keys = Array.from(new Set(rows.map((r) => r.permission_key)));
  const val = (role: string, key: string) => rows.find((r) => r.role_name === role && r.permission_key === key)?.allowed === 1;

  async function toggle(role: string, key: string, current: boolean) {
    await api.patch('/permissions', { role_name: role, permission_key: key, allowed: !current });
    load();
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>مصفوفة الصلاحيات</h3>
      <p className="muted" style={{ fontSize: 13 }}>التعديل يسري فوراً على كل العمليات (يُتحقق منه على الخادم).</p>
      <table className="table">
        <thead><tr><th>الصلاحية</th>{roles.map((r) => <th key={r} style={{ textAlign: 'center' }}>{ROLE_LABELS[r]}</th>)}</tr></thead>
        <tbody>
          {keys.map((key) => (
            <tr key={key}>
              <td>{labels[key] || key}</td>
              {roles.map((role) => {
                const v = val(role, key);
                return (
                  <td key={role} style={{ textAlign: 'center' }}>
                    <input type="checkbox" checked={v} onChange={() => toggle(role, key, v)} style={{ width: 18, height: 18, cursor: 'pointer' }} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ===== خلاصات RSS ===== */
function Feeds() {
  const [feeds, setFeeds] = useState<any[]>([]);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  function load() { api.get('/rss/feeds').then((d) => setFeeds(d.feeds)); }
  useEffect(load, []);

  async function add() {
    setErr(''); setMsg('');
    try {
      const d = await api.post('/rss/feeds', { url, title });
      setUrl(''); setTitle('');
      if (d.result?.error) {
        setErr(`أُضيفت الخلاصة لكن تعذّر جلبها: ${d.result.error}`);
      } else {
        setMsg(`أُضيفت الخلاصة وجُلب منها ${d.result?.added ?? 0} خبراً.`);
      }
      load();
    } catch (e: any) { setErr(e.message); }
  }
  async function del(id: string) { await api.del(`/rss/feeds/${id}`); load(); }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>خلاصات RSS</h3>
      <div className="row" style={{ marginBottom: 12 }}>
        <input className="input" style={{ flex: 2 }} placeholder="رابط الخلاصة https://..." value={url} onChange={(e) => setUrl(e.target.value)} />
        <input className="input" style={{ flex: 1 }} placeholder="عنوان (اختياري)" value={title} onChange={(e) => setTitle(e.target.value)} />
        <button className="btn" onClick={add}><Plus size={15} /> إضافة</button>
      </div>
      {err && <p className="err">{err}</p>}
      {msg && <p className="ok">{msg}</p>}
      <table className="table">
        <thead><tr><th>العنوان</th><th>الرابط</th><th>أُضيفت</th><th></th></tr></thead>
        <tbody>
          {feeds.map((f) => (
            <tr key={f.id}>
              <td>{f.title}</td>
              <td className="muted" style={{ fontSize: 12 }}>{f.url}</td>
              <td className="muted">{formatRiyadh(f.created_at)}</td>
              <td><button className="btn danger sm" onClick={() => del(f.id)} title="حذف"><Trash2 size={14} /></button></td>
            </tr>
          ))}
          {feeds.length === 0 && <tr><td colSpan={4} className="muted">لا توجد خلاصات</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/* ===== المنصات والمزوّد ===== */
function Platforms() {
  const [enabled, setEnabled] = useState<string[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [provider, setProvider] = useState('mock');
  const [msg, setMsg] = useState('');
  const [customKey, setCustomKey] = useState('');
  const [customLabel, setCustomLabel] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get('/settings').then((d) => {
      setEnabled(d.settings?.enabled_platforms || []);
      setLabels(d.settings?.platform_labels || {});
      setProvider(d.settings?.provider_name || 'mock');
    });
  }, []);

  function toggle(key: string) {
    setEnabled((s) => (s.includes(key) ? s.filter((x) => x !== key) : [...s, key]));
  }

  function addCustom() {
    setErr('');
    const key = customKey.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!key) return setErr('أدخل معرّفاً لاتينياً للمنصة (مثل: medium)');
    if (enabled.includes(key) || KNOWN_PLATFORMS.includes(key)) return setErr('المنصة موجودة مسبقاً');
    setEnabled((s) => [...s, key]);
    if (customLabel.trim()) setLabels((l) => ({ ...l, [key]: customLabel.trim() }));
    setCustomKey('');
    setCustomLabel('');
  }

  function removeCustom(key: string) {
    setEnabled((s) => s.filter((x) => x !== key));
    setLabels((l) => {
      const n = { ...l };
      delete n[key];
      return n;
    });
  }

  async function save() {
    setMsg('');
    await api.put('/settings', { enabled_platforms: enabled, platform_labels: labels, provider_name: provider });
    setMsg('تم الحفظ');
  }

  const customEnabled = enabled.filter((k) => !KNOWN_PLATFORMS.includes(k));

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>المنصات والمزوّد</h3>

      <div className="field">
        <label>المنصات المعروفة (فعّل/عطّل)</label>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
          {KNOWN_PLATFORMS.map((p) => {
            const on = enabled.includes(p);
            return (
              <button
                key={p}
                type="button"
                onClick={() => toggle(p)}
                className="card"
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', cursor: 'pointer',
                  borderColor: on ? 'hsl(var(--primary))' : 'hsl(var(--border))',
                  background: on ? 'hsl(var(--primary-soft))' : 'hsl(var(--card))',
                }}
              >
                <PlatformIcon platform={p} size={26} />
                <span style={{ fontWeight: 600, fontSize: 13 }}>{PLATFORM_META[p].label}</span>
                <div className="spacer" />
                <span className={`badge ${on ? 'green' : 'gray'}`}>{on ? 'مفعّلة' : 'معطّلة'}</span>
              </button>
            );
          })}
        </div>
      </div>

      {customEnabled.length > 0 && (
        <div className="field">
          <label>منصات مخصّصة</label>
          <div className="row">
            {customEnabled.map((k) => (
              <span key={k} className="badge gray" style={{ gap: 8, padding: '6px 10px' }}>
                <PlatformIcon platform={k} size={18} /> {platformLabel(k, labels)}
                <Trash2 size={13} style={{ cursor: 'pointer' }} onClick={() => removeCustom(k)} />
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="field">
        <label>إضافة منصة مخصّصة</label>
        <div className="row">
          <input className="input" style={{ flex: 1 }} placeholder="المعرّف (لاتيني، مثل: medium)" value={customKey} onChange={(e) => setCustomKey(e.target.value)} />
          <input className="input" style={{ flex: 1 }} placeholder="الاسم بالعربية" value={customLabel} onChange={(e) => setCustomLabel(e.target.value)} />
          <button className="btn ghost" onClick={addCustom}><Plus size={15} /> إضافة</button>
        </div>
        {err && <p className="err" style={{ marginTop: 6 }}>{err}</p>}
      </div>

      <div className="field">
        <label>مزوّد النشر الموحّد</label>
        <select className="select" style={{ maxWidth: 260 }} value={provider} onChange={(e) => setProvider(e.target.value)}>
          <option value="mock">Mock (تجريبي)</option>
          <option value="ayrshare">Ayrshare</option>
          <option value="zernio">Zernio</option>
          <option value="late">Late</option>
        </select>
        <p className="muted" style={{ fontSize: 12 }}>مفتاح المزوّد يُضبط عبر Cloudflare Secrets (PROVIDER_API_KEY) ولا يُدار من هنا.</p>
      </div>
      {msg && <p className="ok">{msg}</p>}
      <button className="btn" onClick={save}>حفظ الإعدادات</button>
    </div>
  );
}

/* ===== التكاملات (بيسكامب — مركز المعرفة) ===== */
function Integrations() {
  const [status, setStatus] = useState<any>(null);
  const [accountId, setAccountId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [mgmtId, setMgmtId] = useState('');
  const [msg, setMsg] = useState('');

  function load() {
    api.get('/basecamp/status').then(setStatus).catch(() => setStatus({ configured: false }));
    api.get('/settings').then((d) => {
      setAccountId(d.settings?.basecamp_account_id || '');
      setProjectId(d.settings?.basecamp_project_id || '');
      setMgmtId(d.settings?.basecamp_mgmt_project_id || '');
    });
  }
  useEffect(load, []);

  async function save() {
    setMsg('');
    await api.put('/settings', { basecamp_account_id: accountId, basecamp_project_id: projectId, basecamp_mgmt_project_id: mgmtId });
    setMsg('تم الحفظ');
    load();
  }

  async function resync() {
    setMsg('جارٍ إعادة المزامنة…');
    try { const r = await api.post('/basecamp/resync'); setMsg(`تمت جدولة مزامنة ${r.queued} عنصراً`); }
    catch (e: any) { setMsg(e.message); }
  }
  async function runReport() {
    setMsg('جارٍ رفع التقرير…');
    try { const r = await api.post('/basecamp/report/run'); setMsg(r.ok ? 'تم رفع التقرير إلى بيسكامب' : `تعذّر: ${r.reason}`); }
    catch (e: any) { setMsg(e.message); }
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>تكامل بيسكامب — «مركز المعرفة»</h3>
      <p className="muted" style={{ fontSize: 13 }}>
        اربط مشروع «مركز المعرفة» في بيسكامب لتوليد المحتوى من ملفاته. المفاتيح السرية (client id/secret/refresh token)
        تُضبط عبر Cloudflare Secrets؛ هنا تضبط معرّف الحساب والمشروع فقط.
      </p>

      <div className="card" style={{ background: 'hsl(var(--muted) / 0.4)', marginBottom: 16 }}>
        <div className="row">
          <span>حالة الاتصال بالمفاتيح السرية:</span>
          <span className={`badge ${status?.configured ? 'green' : 'red'}`}>
            {status?.configured ? 'مضبوطة' : 'غير مضبوطة'}
          </span>
        </div>
        {!status?.configured && (
          <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
            اضبط الأسرار: BASECAMP_CLIENT_ID، BASECAMP_CLIENT_SECRET، BASECAMP_REFRESH_TOKEN عبر Wrangler/لوحة Cloudflare.
            يمكنك الحصول على refresh token عبر فتح <code>/api/basecamp/oauth/start</code> بعد ضبط client id/secret.
          </p>
        )}
      </div>

      <div className="grid cols-2">
        <div className="field">
          <label>معرّف حساب بيسكامب (Account ID)</label>
          <input className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder="مثال: 5912345" />
        </div>
        <div className="field">
          <label>معرّف مشروع «مركز المعرفة» (للقراءة/التوليد)</label>
          <input className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)} placeholder="مثال: 34567890" />
        </div>
      </div>

      <div className="field">
        <label>معرّف مشروع «إدارة التسويق» (للمزامنة والتقارير)</label>
        <input className="input" value={mgmtId} onChange={(e) => setMgmtId(e.target.value)} placeholder="مثال: 34567899" />
        <p className="muted" style={{ fontSize: 12 }}>
          يُزامَن كل محتوى كبطاقة مهمة تتحرك عبر مراحل الاعتماد، وتاريخ استحقاقها = تاريخ النشر، وتُسند لأعضاء المشروع.
          ويُرفع تقرير أداء أسبوعي (Excel) كل سبت ٩:٠٠م في مجلد «تقارير الأداء الأسبوعية (آلي)».
        </p>
      </div>

      {msg && <p className="ok">{msg}</p>}
      <div className="row">
        <button className="btn" onClick={save}>حفظ إعدادات بيسكامب</button>
        <button className="btn ghost" onClick={resync} disabled={!status?.mgmt_set}>إعادة مزامنة المحتوى</button>
        <button className="btn ghost" onClick={runReport} disabled={!status?.mgmt_set}>رفع التقرير الآن</button>
        <a className="btn ghost" href="/api/basecamp/report/download">تنزيل التقرير (معاينة)</a>
      </div>
    </div>
  );
}
