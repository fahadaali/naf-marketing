import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { api } from '../../api';
import { formatNumber } from '../../lib/format';
import { Money } from '../../components/Money';
import { SOURCE_LABELS } from '../../metrics';
import { PlatformIcon, platformLabel } from '../../platforms';

/* الإنفاق الإعلاني — تقف عليه الطبقة الخامسة كلها.

   بلا إنفاق مسجَّل لا تكلفة نقرة ولا تكلفة عميل ولا عائد على الإنفاق. ويصل
   من تكامل إعلاني مربوط أو يُدخَل هنا، وعمود «المصدر» يقول أيّهما. */

type SpendRow = {
  id: string; platform: string; campaign_id: string; amount: number;
  impressions: number; clicks: number; conversions: number;
  source: string; entered_by_name: string | null;
};

export default function Spend({ canManage, period, start, onSaved }: {
  canManage: boolean; period: string; start: string; onSaved: () => void;
}) {
  const [rows, setRows] = useState<SpendRow[]>([]);
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [form, setForm] = useState({ platform: '', amount: '', impressions: '', clicks: '' });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  function load() {
    api.get(`/metrics/spend?period=${period}&start=${start}`)
      .then((d) => setRows(d.spend || []))
      .catch((e) => setMsg(e.message));
  }
  useEffect(load, [period, start]);
  useEffect(() => {
    api.get('/settings').then((d) => {
      const list: string[] = d.settings?.enabled_platforms || [];
      setPlatforms(list);
      setForm((f) => (f.platform ? f : { ...f, platform: list[0] ?? '' }));
      // الصمت قرار: قائمةُ منصاتٍ لحقل اختيار — والقراءة الأساسية أعلاه تُبلّغ
    }).catch(() => {});
  }, []);

  const total = rows.reduce((s, r) => s + (r.amount || 0), 0);

  async function save() {
    const amount = Number(form.amount);
    if (!form.platform) { setMsg('اختر المنصة.'); return; }
    if (!Number.isFinite(amount) || amount < 0) { setMsg('المبلغ يجب أن يكون رقماً موجباً.'); return; }
    setBusy(true);
    try {
      await api.post('/metrics/spend', {
        period, start, platform: form.platform, amount,
        impressions: Number(form.impressions) || 0,
        clicks: Number(form.clicks) || 0,
      });
      setMsg('تم الحفظ');
      setForm({ ...form, amount: '', impressions: '', clicks: '' });
      load();
      onSaved();
    } catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="row">
        <h4 style={{ margin: 0 }}>الإنفاق الإعلاني</h4>
        <div className="spacer" />
        {rows.length > 0 && (
          <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
            الإجمالي <Money value={total} />
          </span>
        )}
      </div>

      <div className="table-scroll" style={{ marginTop: 12 }}>
        <table className="table">
          <thead>
            <tr><th>المنصة</th><th>المبلغ</th><th>الظهور</th><th>النقرات</th><th>المصدر</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <PlatformIcon platform={r.platform} size={16} /> {platformLabel(r.platform)}
                  </span>
                </td>
                <td><Money value={r.amount} /></td>
                <td><bdi>{formatNumber(r.impressions)}</bdi></td>
                <td><bdi>{formatNumber(r.clicks)}</bdi></td>
                <td className="muted">
                  {SOURCE_LABELS[r.source as keyof typeof SOURCE_LABELS] ?? r.source}
                  {r.entered_by_name ? ` — ${r.entered_by_name}` : ''}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="muted">لا إنفاق مسجّل لهذه الفترة. سجّله أو اربط مصدره.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {canManage && (
        <div className="row" style={{ alignItems: 'flex-end', gap: 12, marginTop: 12 }}>
          <div className="field" style={{ margin: 0, minWidth: 150 }}>
            <label htmlFor="sp-platform">المنصة</label>
            <select id="sp-platform" className="select" value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}>
              {platforms.map((p) => <option key={p} value={p}>{platformLabel(p)}</option>)}
              <option value="google">جوجل</option>
              <option value="other">أخرى</option>
            </select>
          </div>
          <div className="field" style={{ margin: 0, maxWidth: 140 }}>
            <label htmlFor="sp-amount">المبلغ</label>
            <input id="sp-amount" className="input" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </div>
          <div className="field" style={{ margin: 0, maxWidth: 140 }}>
            <label htmlFor="sp-impressions">الظهور</label>
            <input id="sp-impressions" className="input" inputMode="numeric" value={form.impressions} onChange={(e) => setForm({ ...form, impressions: e.target.value })} />
          </div>
          <div className="field" style={{ margin: 0, maxWidth: 140 }}>
            <label htmlFor="sp-clicks">النقرات</label>
            <input id="sp-clicks" className="input" inputMode="numeric" value={form.clicks} onChange={(e) => setForm({ ...form, clicks: e.target.value })} />
          </div>
          <button className="btn" disabled={busy} onClick={save}><Save size={20} /> حفظ</button>
          <div className="spacer" />
          {msg && <span className="ok">{msg}</span>}
        </div>
      )}
    </div>
  );
}
