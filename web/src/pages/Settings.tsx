import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api, ROLE_LABELS, formatRiyadh } from '../api';
import { useAuth } from '../auth';
import Modal from '../components/Modal';
import { KNOWN_PLATFORMS, PLATFORM_META, PlatformIcon, platformLabel, DEFAULT_PLATFORM_PROMPTS } from '../platforms';
import { DEFAULT_TONES, type Tone } from '../tones';

export default function Settings() {
  const { can } = useAuth();
  const tabs = [
    can('users.manage') && { id: 'users', label: 'المستخدمون' },
    can('permissions.manage') && { id: 'permissions', label: 'الصلاحيات' },
    can('settings.manage') && { id: 'feeds', label: 'خلاصات RSS' },
    can('settings.manage') && { id: 'platforms', label: 'المنصات والمزوّد' },
    can('settings.manage') && { id: 'ai', label: 'الذكاء الاصطناعي' },
    can('settings.manage') && { id: 'integrations', label: 'التكاملات' },
    can('settings.manage') && { id: 'notifications', label: 'الإشعارات' },
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
      {tab === 'ai' && <><AITones /><div style={{ height: 16 }} /><PlatformPrompts /><div style={{ height: 16 }} /><AIMediaProviders /></>}
      {tab === 'integrations' && <Integrations />}
      {tab === 'notifications' && <NotificationSettings />}
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
  // ربط حسابات Buffer: خريطة (منصة → معرّف حساب Buffer) + قائمة الحسابات المجلوبة
  const [bufferProfiles, setBufferProfiles] = useState<Record<string, string>>({});
  const [bufferAccounts, setBufferAccounts] = useState<{ id: string; service: string; username: string }[]>([]);
  const [bufferMsg, setBufferMsg] = useState('');
  const [bufferLoading, setBufferLoading] = useState(false);

  useEffect(() => {
    api.get('/settings').then((d) => {
      setEnabled(d.settings?.enabled_platforms || []);
      setLabels(d.settings?.platform_labels || {});
      setProvider(d.settings?.provider_name || 'mock');
      setBufferProfiles(d.settings?.buffer_profiles || {});
    });
  }, []);

  async function fetchBufferAccounts() {
    setBufferMsg('');
    setBufferLoading(true);
    try {
      const d = await api.get('/buffer/profiles');
      setBufferAccounts(d.profiles || []);
      if (!d.profiles?.length) setBufferMsg('لا توجد حسابات مربوطة في Buffer بعد.');
    } catch (e: any) {
      setBufferMsg(e.message || 'تعذّر جلب حسابات Buffer');
    } finally {
      setBufferLoading(false);
    }
  }

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
    await api.put('/settings', {
      enabled_platforms: enabled,
      platform_labels: labels,
      provider_name: provider,
      buffer_profiles: bufferProfiles,
    });
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
          <option value="buffer">Buffer</option>
          <option value="ayrshare">Ayrshare</option>
          <option value="zernio">Zernio</option>
          <option value="late">Late</option>
        </select>
        <p className="muted" style={{ fontSize: 12 }}>مفتاح المزوّد يُضبط عبر Cloudflare Secrets (PROVIDER_API_KEY) ولا يُدار من هنا.</p>
      </div>

      {provider === 'buffer' && (
        <div className="card" style={{ background: 'hsl(var(--muted) / 0.4)', marginBottom: 12 }}>
          <div className="row" style={{ marginBottom: 8 }}>
            <strong style={{ fontSize: 14 }}>ربط حسابات Buffer</strong>
            <div className="spacer" />
            <button className="btn ghost sm" onClick={fetchBufferAccounts} disabled={bufferLoading}>
              {bufferLoading ? 'جارٍ الجلب…' : 'جلب حسابات Buffer'}
            </button>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
            Buffer ينشر إلى حسابات مربوطة لديه. اجلب حساباتك ثم اربط كل منصة مفعّلة بالحساب المقابل في Buffer.
            يتطلب ضبط <code>PROVIDER_API_KEY</code> (رمز وصول Buffer) عبر Cloudflare Secrets أولاً.
          </p>
          {bufferMsg && <p className="muted" style={{ fontSize: 12 }}>{bufferMsg}</p>}
          {enabled.length === 0 && <p className="muted" style={{ fontSize: 12 }}>فعّل منصةً واحدة على الأقل أعلاه أولاً.</p>}
          {enabled.map((p) => (
            <div key={p} className="row" style={{ gap: 10, marginBottom: 8, alignItems: 'center' }}>
              <span style={{ minWidth: 120, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <PlatformIcon platform={p} size={18} /> {platformLabel(p, labels)}
              </span>
              <select
                className="select"
                style={{ maxWidth: 320 }}
                value={bufferProfiles[p] || ''}
                onChange={(e) => setBufferProfiles((m) => ({ ...m, [p]: e.target.value }))}
              >
                <option value="">— بدون ربط —</option>
                {bufferAccounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.service} — {a.username}</option>
                ))}
                {/* أبقِ القيمة المحفوظة ظاهرة حتى قبل جلب القائمة */}
                {bufferProfiles[p] && !bufferAccounts.some((a) => a.id === bufferProfiles[p]) && (
                  <option value={bufferProfiles[p]}>{bufferProfiles[p]} (محفوظ)</option>
                )}
              </select>
            </div>
          ))}
        </div>
      )}

      {msg && <p className="ok">{msg}</p>}
      <button className="btn" onClick={save}>حفظ الإعدادات</button>
    </div>
  );
}

/* ===== نبرات الذكاء الاصطناعي (البرومبت لكل نبرة) ===== */
function AITones() {
  const [tones, setTones] = useState<Tone[]>([]);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [newKey, setNewKey] = useState('');
  const [newLabel, setNewLabel] = useState('');

  useEffect(() => {
    api.get('/settings').then((d) => {
      const t = d.settings?.ai_tones;
      setTones(Array.isArray(t) && t.length ? t : DEFAULT_TONES);
    });
  }, []);

  function update(i: number, field: keyof Tone, value: string) {
    setTones((ts) => ts.map((t, idx) => (idx === i ? { ...t, [field]: value } : t)));
  }
  function remove(i: number) {
    setTones((ts) => ts.filter((_, idx) => idx !== i));
  }
  function add() {
    setErr('');
    const key = newKey.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!key) return setErr('أدخل معرّفاً لاتينياً للنبرة (مثل: humorous)');
    if (tones.some((t) => t.key === key)) return setErr('النبرة موجودة مسبقاً');
    setTones((ts) => [...ts, { key, label: newLabel.trim() || key, prompt: '' }]);
    setNewKey(''); setNewLabel('');
  }
  async function save() {
    setMsg(''); setErr('');
    if (!tones.length) return setErr('أبقِ نبرة واحدة على الأقل');
    if (tones.some((t) => !t.prompt.trim())) return setErr('اكتب برومبت لكل نبرة');
    await api.put('/settings', { ai_tones: tones });
    setMsg('تم حفظ النبرات');
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>نبرات الذكاء الاصطناعي</h3>
      <p className="muted" style={{ fontSize: 13 }}>
        لكل نبرة برومبت يُرسَل لوكيل الذكاء الاصطناعي عند التوليد. عدّل النص أو أضف/احذف نبرات حسب حاجتك.
      </p>

      {tones.map((t, i) => (
        <div className="card" key={i} style={{ marginBottom: 12, background: 'hsl(var(--muted) / 0.35)' }}>
          <div className="row" style={{ marginBottom: 8 }}>
            <div className="field" style={{ margin: 0, width: 220 }}>
              <label>الاسم المعروض</label>
              <input className="input" value={t.label} onChange={(e) => update(i, 'label', e.target.value)} />
            </div>
            <div className="field" style={{ margin: 0, width: 160 }}>
              <label>المعرّف</label>
              <input className="input" value={t.key} disabled />
            </div>
            <div className="spacer" />
            <button className="btn danger sm" onClick={() => remove(i)} title="حذف النبرة"><Trash2 size={14} /></button>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>البرومبت (توجيه النبرة للذكاء الاصطناعي)</label>
            <textarea className="textarea" style={{ minHeight: 90 }} value={t.prompt} onChange={(e) => update(i, 'prompt', e.target.value)} />
          </div>
        </div>
      ))}

      <div className="field">
        <label>إضافة نبرة جديدة</label>
        <div className="row">
          <input className="input" style={{ flex: 1 }} placeholder="المعرّف (لاتيني)" value={newKey} onChange={(e) => setNewKey(e.target.value)} />
          <input className="input" style={{ flex: 1 }} placeholder="الاسم بالعربية" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
          <button className="btn ghost" onClick={add}><Plus size={15} /> إضافة</button>
        </div>
      </div>

      {err && <p className="err">{err}</p>}
      {msg && <p className="ok">{msg}</p>}
      <button className="btn" onClick={save}>حفظ النبرات</button>
    </div>
  );
}

/* ===== توجيهات المنصات للتوليد ===== */
function PlatformPrompts() {
  const [enabled, setEnabled] = useState<string[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [prompts, setPrompts] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api.get('/settings').then((d) => {
      const en: string[] = d.settings?.enabled_platforms || [];
      const saved: Record<string, string> = d.settings?.platform_prompts || {};
      setEnabled(en);
      setLabels(d.settings?.platform_labels || {});
      const init: Record<string, string> = {};
      for (const k of en) init[k] = saved[k] ?? DEFAULT_PLATFORM_PROMPTS[k] ?? '';
      setPrompts(init);
    });
  }, []);

  async function save() {
    setMsg('');
    await api.put('/settings', { platform_prompts: prompts });
    setMsg('تم حفظ توجيهات المنصات');
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>توجيهات المنصات للتوليد</h3>
      <p className="muted" style={{ fontSize: 13 }}>
        توجيه خاص لكل منصة يُرسَل لوكيل الذكاء الاصطناعي مع النبرة عند التوليد (مثل حد الأحرف للإكس أو الوسوم لإنستغرام).
      </p>
      {enabled.length === 0 && <p className="muted">فعّل منصات من تبويب «المنصات والمزوّد» أولاً.</p>}
      {enabled.map((k) => (
        <div className="field" key={k}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <PlatformIcon platform={k} size={20} /> {platformLabel(k, labels)}
          </label>
          <textarea
            className="textarea"
            style={{ minHeight: 70 }}
            value={prompts[k] || ''}
            onChange={(e) => setPrompts((p) => ({ ...p, [k]: e.target.value }))}
          />
        </div>
      ))}
      {msg && <p className="ok">{msg}</p>}
      {enabled.length > 0 && <button className="btn" onClick={save}>حفظ توجيهات المنصات</button>}
    </div>
  );
}

/* ===== توليد الوسائط بالذكاء الاصطناعي (صور/فيديو) ===== */
function AIMediaProviders() {
  const [imageProvider, setImageProvider] = useState('mock');
  const [videoProvider, setVideoProvider] = useState('mock');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api.get('/settings').then((d) => {
      setImageProvider(d.settings?.image_provider || 'mock');
      setVideoProvider(d.settings?.video_provider || 'mock');
    });
  }, []);

  async function save() {
    setMsg('');
    await api.put('/settings', { image_provider: imageProvider, video_provider: videoProvider });
    setMsg('تم الحفظ');
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>توليد الصور والفيديو بالذكاء الاصطناعي</h3>
      <p className="muted" style={{ fontSize: 13 }}>
        اختر مزوّد التوليد؛ مفاتيحه تُضبط عبر Cloudflare Secrets (<code>IMAGE_PROVIDER_API_KEY</code>، <code>VIDEO_PROVIDER_API_KEY</code>) ولا تُدار من هنا.
      </p>
      <div className="grid cols-2">
        <div className="field">
          <label>مزوّد الصور</label>
          <select className="select" value={imageProvider} onChange={(e) => setImageProvider(e.target.value)}>
            <option value="mock">Mock (تجريبي — صورة تدرّج لوني)</option>
            <option value="openai">OpenAI (Images API)</option>
          </select>
        </div>
        <div className="field">
          <label>مزوّد الفيديو</label>
          <select className="select" value={videoProvider} onChange={(e) => setVideoProvider(e.target.value)}>
            <option value="mock">Mock (تجريبي — للتحقق من الربط فقط)</option>
            <option value="runway">Runway ML</option>
          </select>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        مزوّد الفيديو التجريبي (Mock) يُثبت أن الربط جاهز لكنه لا يُنتج فيديو حقيقياً — اختر Runway (أو مزوّداً آخر لاحقاً) وأضف مفتاحه لتفعيل التوليد الفعلي.
      </p>
      {msg && <p className="ok">{msg}</p>}
      <button className="btn" onClick={save}>حفظ إعدادات التوليد</button>
    </div>
  );
}

/* ===== إعدادات الإشعارات البريدية ===== */
function NotificationSettings() {
  const [provider, setProvider] = useState('mock');
  const [from, setFrom] = useState('');
  const [staleDays, setStaleDays] = useState('3');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api.get('/settings').then((d) => {
      setProvider(d.settings?.email_provider || 'mock');
      setFrom(d.settings?.email_from || '');
      setStaleDays(d.settings?.stale_alert_days || '3');
    });
  }, []);

  async function save() {
    setMsg('');
    await api.put('/settings', { email_provider: provider, email_from: from, stale_alert_days: staleDays });
    setMsg('تم الحفظ');
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>الإشعارات</h3>
      <p className="muted" style={{ fontSize: 13 }}>
        الإشعارات داخل التطبيق (جرس الإشعارات) مفعّلة دائماً — تصل تلقائياً عند وصول محتوى لدورك في الاعتماد،
        عند رفض محتواك، أو عند فشل نشر مجدول. الإشعار البريدي اختياري ويحتاج مزوّداً.
      </p>
      <div className="grid cols-2">
        <div className="field">
          <label>مزوّد البريد</label>
          <select className="select" value={provider} onChange={(e) => setProvider(e.target.value)}>
            <option value="mock">بلا بريد (داخل التطبيق فقط)</option>
            <option value="resend">Resend</option>
          </select>
        </div>
        <div className="field">
          <label>عنوان المرسل (From)</label>
          <input className="input" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="notifications@naflaw.sa" />
        </div>
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        مفتاح Resend يُضبط عبر Cloudflare Secrets (<code>EMAIL_PROVIDER_API_KEY</code>) ولا يُدار من هنا.
      </p>
      <div className="field" style={{ maxWidth: 240 }}>
        <label>تنبيه المحتوى المتأخر بعد (أيام)</label>
        <input
          className="input"
          type="number"
          min={1}
          value={staleDays}
          onChange={(e) => setStaleDays(e.target.value)}
        />
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        إن بقي محتوى في مرحلة المراجعة أو الاعتماد النهائي دون حركة لهذه المدة، يُرسل تنبيه تلقائي للمسؤولين عن تلك المرحلة.
      </p>
      {msg && <p className="ok">{msg}</p>}
      <button className="btn" onClick={save}>حفظ إعدادات الإشعارات</button>
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
  const [reportPeriod, setReportPeriod] = useState<'week' | 'month'>('week');
  const [reportFormat, setReportFormat] = useState<'xlsx' | 'csv'>('xlsx');

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
    try { const r = await api.post(`/basecamp/report/run?period=${reportPeriod}`); setMsg(r.ok ? 'تم رفع التقرير إلى بيسكامب' : `تعذّر: ${r.reason}`); }
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
          يجب تفعيل أداة <b>«جدول البطاقات» (Card Table)</b> في المشروع. يُزامَن كل محتوى كـ<b>بطاقة</b> تنتقل عبر
          الأعمدة حسب مرحلة الاعتماد، وتاريخ استحقاقها = تاريخ النشر، وتُسند لأعضاء المشروع.
          أسماء الأعمدة المتوقّعة (تُنشأ تلقائياً إن غابت): المسودات، بانتظار اعتماد قسم التسويق، بانتظار اعتماد المدير العام،
          معتمد، مجدول للنشر، منشور، مرفوض، مؤرشف.
          ويُرفع تقرير أداء أسبوعي (Excel) كل سبت ٩:٠٠م في مجلد «تقارير الأداء الأسبوعية (آلي)»،
          وتقرير شهري في اليوم الأول من كل شهر في مجلد «تقارير الأداء الشهرية (آلي)».
          تعليقات بطاقات بيسكامب تُستورد تلقائياً كملاحظات على المحتوى المقابل (يظهر ذلك في صفحة تحرير المحتوى).
        </p>
      </div>

      {msg && <p className="ok">{msg}</p>}
      <div className="row" style={{ marginBottom: 10 }}>
        <button className="btn" onClick={save}>حفظ إعدادات بيسكامب</button>
        <button className="btn ghost" onClick={resync} disabled={!status?.mgmt_set}>إعادة مزامنة المحتوى</button>
      </div>
      <div className="row" style={{ gap: 10, alignItems: 'flex-end' }}>
        <div className="field" style={{ margin: 0, minWidth: 120 }}>
          <label>فترة التقرير</label>
          <select className="select" value={reportPeriod} onChange={(e) => setReportPeriod(e.target.value as any)}>
            <option value="week">أسبوعي</option>
            <option value="month">شهري</option>
          </select>
        </div>
        <div className="field" style={{ margin: 0, minWidth: 120 }}>
          <label>صيغة التنزيل</label>
          <select className="select" value={reportFormat} onChange={(e) => setReportFormat(e.target.value as any)}>
            <option value="xlsx">Excel</option>
            <option value="csv">CSV</option>
          </select>
        </div>
        <button className="btn ghost" onClick={runReport} disabled={!status?.mgmt_set}>رفع التقرير الآن إلى بيسكامب</button>
        <a className="btn ghost" href={`/api/basecamp/report/download?period=${reportPeriod}&format=${reportFormat}`}>تنزيل التقرير (معاينة)</a>
      </div>
    </div>
  );
}
