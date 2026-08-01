import { useEffect, useState } from 'react';
import { CircleAlert, CircleHelp, Link2, Link2Off, RefreshCw, Save, Upload } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api, formatRiyadh } from '../api';
import { useAuth } from '../auth';
import { INTEGRATION_LABELS, SYNC_STATUS_LABELS } from '../metrics';

/* مصادر المؤشرات — ثمانيةٌ تُعرض كلُّها ولو لم تُربط.

   من لا يرى المصدر يظنّ المؤشر مستحيلاً. فالمصدر المعطّل يظهر «غير مربوط»،
   ورسالةُ عطله تحمل سببَ المزوّد ووقتَ آخر سحبٍ نجح — فمن يقرأها يعرف عمر
   الرقم المعروض تحته. ورقمٌ قديمٌ يُعرض بلا هذا السطر أسوأ من رقمٍ غائب.

   ولا مفتاح سرّي في هذه الشاشة إطلاقاً: الأسرار عبر `wrangler secret`،
   وما هنا معرّفُ حسابٍ وعنوانُ مصدر. والشاشة تعرض جاهزية السرّ لا قيمته. */

type Integration = {
  key: string;
  is_enabled: boolean;
  config: Record<string, unknown>;
  fields: { key: string; label: string; placeholder?: string }[];
  secret_name: string | null;
  secret_ready: boolean;
  last_sync_at: string | null;
  last_sync_status: string;
  last_error: string | null;
  last_ok_at: string | null;
};

const STATUS_ICON: Record<string, LucideIcon> = {
  ok: Link2,
  never_synced: CircleHelp,
  sync_failed: CircleAlert,
};

const STATUS_BADGE: Record<string, string> = {
  ok: 'green',
  never_synced: 'gray',
  sync_failed: 'red',
};

function StateChip({ i }: { i: Integration }) {
  if (!i.is_enabled) {
    return <span className="badge gray"><Link2Off size={13} /> غير مربوط</span>;
  }
  const Icon = STATUS_ICON[i.last_sync_status] ?? CircleHelp;
  return (
    <span className={`badge ${STATUS_BADGE[i.last_sync_status] ?? 'gray'}`}>
      <Icon size={13} />
      {SYNC_STATUS_LABELS[i.last_sync_status] ?? i.last_sync_status}
    </span>
  );
}

export default function MetricSources() {
  const { can } = useAuth();
  const canLink = can('integrations.manage');
  const canSync = can('metrics.manage');

  const [rows, setRows] = useState<Integration[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [contract, setContract] = useState('');

  function load() {
    api.get('/integrations').then((d) => {
      setRows(d.integrations || []);
      setContract(d.contract || '');
      const next: Record<string, Record<string, string>> = {};
      for (const i of d.integrations || []) {
        next[i.key] = {};
        for (const f of i.fields) next[i.key][f.key] = String(i.config?.[f.key] ?? '');
      }
      setDrafts(next);
    }).catch((e) => setMsg(e.message));
  }
  useEffect(load, []);

  async function save(key: string, patch: { is_enabled?: boolean; config?: Record<string, string> }) {
    setBusy(key); setMsg('');
    try {
      await api.put(`/integrations/${key}`, patch);
      setMsg('تم الحفظ');
      load();
    } catch (e: any) { setMsg(e.message); } finally { setBusy(''); }
  }

  async function sync(key: string) {
    setBusy(key); setMsg('جارٍ السحب…');
    try {
      await api.post(`/integrations/${key}/sync`);
      setMsg('تم السحب');
      load();
    } catch (e: any) { setMsg(e.message); load(); } finally { setBusy(''); }
  }

  /** رفع ملفّ تصدير منصة إدارة المكتب — المسار الذي يعمل بلا مفتاح خدمة. */
  async function importCrm(file: File) {
    setBusy('crm'); setMsg('جارٍ القراءة…');
    try {
      const payload = JSON.parse(await file.text());
      const d = await api.post('/integrations/crm/import', payload);
      setMsg(`تم الاستيراد: ${d.leads} محتملاً و${d.clients} عميلاً و${d.cases} قضية.`);
      load();
    } catch (e: any) {
      setMsg(e?.message || 'الملف ليس JSON صالحاً. ارفع ملف التصدير كما نزّلته.');
    } finally { setBusy(''); }
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="row">
        <h3 style={{ margin: 0 }}>مصادر المؤشرات</h3>
        <div className="spacer" />
        {msg && <span className="ok">{msg}</span>}
      </div>
      <p className="muted" style={{ fontSize: 'var(--text-xs)' }}>
        من هنا تصل أرقام الطبقات التي لا تملكها المنصة. والمفاتيح السرّية عبر أسرار كلاودفلير — لا تُكتب هنا.
      </p>

      {rows.map((i) => (
        <div key={i.key} className="card" style={{ marginTop: 12 }}>
          <div className="row">
            <strong>{INTEGRATION_LABELS[i.key] ?? i.key}</strong>
            <StateChip i={i} />
            <div className="spacer" />
            {canLink && (
              <label className="muted" style={{ fontSize: 'var(--text-xs)', display: 'inline-flex', gap: 6, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={i.is_enabled}
                  disabled={busy === i.key}
                  onChange={(e) => save(i.key, { is_enabled: e.target.checked })}
                />
                مربوط
              </label>
            )}
            {canSync && i.is_enabled && (
              <button className="btn sm ghost" disabled={busy === i.key} onClick={() => sync(i.key)}>
                <RefreshCw size={20} /> سحب الآن
              </button>
            )}
          </div>

          {i.secret_name && (
            <p className="muted" style={{ fontSize: 'var(--text-xs)', margin: '6px 0 0' }}>
              السرّ <bdi>{i.secret_name}</bdi> — {i.secret_ready ? 'مضبوط' : 'غير مضبوط'}
            </p>
          )}

          {/* عمر الرقم: آخر سحبٍ نجح، وسببُ العطل إن وقع */}
          {i.is_enabled && (
            <p className="muted" style={{ fontSize: 'var(--text-xs)', margin: '4px 0 0' }}>
              {i.last_ok_at
                ? <>آخر سحبٍ ناجح <bdi>{formatRiyadh(i.last_ok_at)}</bdi></>
                : 'لم يُسحب بعد'}
              {i.last_sync_status === 'sync_failed' && i.last_error && <> — {i.last_error}</>}
            </p>
          )}

          {canLink && i.fields.length > 0 && (
            <div className="row" style={{ alignItems: 'flex-end', gap: 12, marginTop: 10 }}>
              {i.fields.map((f) => (
                <div className="field" key={f.key} style={{ margin: 0, minWidth: 180 }}>
                  <label htmlFor={`${i.key}-${f.key}`}>{f.label}</label>
                  <input
                    id={`${i.key}-${f.key}`}
                    className="input"
                    placeholder={f.placeholder}
                    value={drafts[i.key]?.[f.key] ?? ''}
                    onChange={(e) => setDrafts({ ...drafts, [i.key]: { ...drafts[i.key], [f.key]: e.target.value } })}
                  />
                </div>
              ))}
              <button className="btn sm" disabled={busy === i.key} onClick={() => save(i.key, { config: drafts[i.key] })}>
                <Save size={20} /> حفظ
              </button>
            </div>
          )}

          {i.key === 'crm' && canSync && (
            <div style={{ marginTop: 10 }}>
              <p className="muted" style={{ fontSize: 'var(--text-xs)', margin: '0 0 6px' }}>
                أو ارفع ملف التصدير من منصة إدارة المكتب — يعمل دون مفتاح خدمة.
              </p>
              <label className="btn sm ghost" style={{ cursor: 'pointer' }}>
                <Upload size={20} /> رفع ملف التصدير
                <input
                  type="file"
                  accept="application/json,.json"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) importCrm(file);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
          )}
        </div>
      ))}

      {contract && (
        <p className="muted" style={{ fontSize: 'var(--text-xs)', marginTop: 12 }}>
          المصادر التي لا واجهة موحّدة لها تُنادى بعقدٍ واحد، وردّها: <bdi>{contract}</bdi>
        </p>
      )}
    </div>
  );
}
