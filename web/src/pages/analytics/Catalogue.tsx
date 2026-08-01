import { useEffect, useState } from 'react';
import { Compass, Gauge, Megaphone, Save } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api } from '../../api';
import { formatNumber } from '../../lib/format';
import { Money } from '../../components/Money';
import {
  CADENCE_LABELS, CLASS_LABELS, INTEGRATION_LABELS, LAYERS, SOURCE_LABELS, UNIT_SUFFIX,
  type MetricClass, type MetricUnit,
} from '../../metrics';

/* دليل المؤشرات — كلُّ ما يُقاس، بمصدره ودوريته ومستهدفه.

   وهو الشاشة التي تُقرأ حين يُسأل «هل نقيس كذا؟». والمؤشر الذي لا مصدر له
   اليوم يظهر هنا بلا قيمة: ثغرةٌ معروفة مكتوبة، لا رقمٌ مفقود لا يعرف أحد
   أنه كان مطلوباً. */

const CLASS_ICON: Record<MetricClass, LucideIcon> = {
  north_star: Compass,
  operational: Gauge,
  vanity: Megaphone,
};

type Definition = {
  key: string; layer: string; name_ar: string; name_en: string; unit: MetricUnit;
  class: MetricClass; source: string; integration_key: string | null; cadence: string;
  dim_key: string; target_value: number | null; target_direction: string;
  target_min: number | null; target_max: number | null; board_rank: number | null;
};

function TargetText({ d }: { d: Definition }) {
  if (d.target_direction === 'range') {
    if (d.target_min === null && d.target_max === null) return <span className="muted">لا مستهدف</span>;
    return <bdi>{d.target_min ?? '—'} – {d.target_max ?? '—'}</bdi>;
  }
  if (d.target_value === null) return <span className="muted">لا مستهدف</span>;
  if (d.unit === 'currency') return <Money value={d.target_value} />;
  return <bdi>{formatNumber(d.target_value)}{UNIT_SUFFIX[d.unit]}</bdi>;
}

export default function Catalogue({ canManage, period, start, onChanged }: {
  canManage: boolean;
  period: string;
  start: string;
  onChanged: () => void;
}) {
  const [defs, setDefs] = useState<Definition[]>([]);
  const [layer, setLayer] = useState('');
  const [picked, setPicked] = useState<Definition | null>(null);
  const [msg, setMsg] = useState('');

  function load() {
    api.get('/metrics/definitions').then((d) => setDefs(d.definitions || [])).catch((e) => setMsg(e.message));
  }
  useEffect(load, []);

  const shown = layer ? defs.filter((d) => d.layer === layer) : defs;
  const layerLabel = (key: string) => LAYERS.find((l) => l.key === key)?.label ?? key;

  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ alignItems: 'flex-end', gap: 16 }}>
          <div className="field" style={{ margin: 0, minWidth: 200 }}>
            <label htmlFor="cat-layer">الطبقة</label>
            <select id="cat-layer" className="select" value={layer} onChange={(e) => setLayer(e.target.value)}>
              <option value="">كل الطبقات</option>
              {LAYERS.filter((l) => l.key !== 'board' && l.key !== 'catalogue').map((l) => (
                <option key={l.key} value={l.key}>{l.label}</option>
              ))}
            </select>
          </div>
          <div className="spacer" />
          <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
            <bdi>{formatNumber(shown.length)}</bdi> مؤشراً
          </span>
        </div>
      </div>

      {msg && <p className="muted">{msg}</p>}

      <div className="card">
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>المؤشر</th><th>الطبقة</th><th>الفئة</th><th>المصدر</th>
                <th>الدورية</th><th>المستهدف</th>{canManage && <th />}
              </tr>
            </thead>
            <tbody>
              {shown.map((d) => {
                const Icon = CLASS_ICON[d.class];
                return (
                  <tr key={d.key}>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        {d.board_rank !== null && <span className="count-pill"><bdi>{d.board_rank}</bdi></span>}
                        {d.name_ar}
                      </span>
                    </td>
                    <td className="muted">{layerLabel(d.layer)}</td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <Icon size={14} aria-hidden="true" />
                        {CLASS_LABELS[d.class]}
                      </span>
                    </td>
                    <td className="muted">
                      {SOURCE_LABELS[d.source as keyof typeof SOURCE_LABELS] ?? d.source}
                      {d.integration_key && ` — ${INTEGRATION_LABELS[d.integration_key] ?? d.integration_key}`}
                    </td>
                    <td className="muted">{CADENCE_LABELS[d.cadence] ?? d.cadence}</td>
                    <td><TargetText d={d} /></td>
                    {canManage && (
                      <td>
                        <button type="button" className="btn sm ghost" onClick={() => setPicked(d)}>تسجيل</button>
                      </td>
                    )}
                  </tr>
                );
              })}
              {shown.length === 0 && (
                <tr><td colSpan={canManage ? 7 : 6} className="muted">لا مؤشر في هذه الطبقة بعد.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {picked && (
        <RecordPanel
          def={picked}
          period={period}
          start={start}
          onClose={() => setPicked(null)}
          onSaved={() => { setPicked(null); load(); onChanged(); }}
        />
      )}
    </>
  );
}

/** تسجيل قيمةٍ ومستهدفٍ لمؤشر — القيمة تحمل اسم من أدخلها ووقته. */
function RecordPanel({ def, period, start, onClose, onSaved }: {
  def: Definition; period: string; start: string; onClose: () => void; onSaved: () => void;
}) {
  const [value, setValue] = useState('');
  const [dimValue, setDimValue] = useState('');
  const [note, setNote] = useState('');
  const [target, setTarget] = useState(def.target_value === null ? '' : String(def.target_value));
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function saveValue() {
    const n = Number(value);
    if (!Number.isFinite(n)) { setMsg('القيمة يجب أن تكون رقماً.'); return; }
    setBusy(true);
    try {
      await api.post('/metrics/values', {
        metric_key: def.key, period, start, value: n,
        dim_value: dimValue || undefined, note: note || undefined,
      });
      setMsg('تم تسجيل القيمة');
      onSaved();
    } catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  }

  async function saveTarget() {
    setBusy(true);
    try {
      await api.put(`/metrics/definitions/${def.key}/target`, {
        target_value: target === '' ? null : Number(target),
        target_direction: def.target_direction,
      });
      setMsg('تم تسجيل المستهدف');
      onSaved();
    } catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="row">
        <h4 style={{ margin: 0 }}>{def.name_ar}</h4>
        <div className="spacer" />
        <button type="button" className="btn sm ghost" onClick={onClose}>إغلاق</button>
      </div>

      <p className="muted" style={{ fontSize: 'var(--text-xs)' }}>
        الفترة المسجَّل فيها: <bdi>{start}</bdi> · {CADENCE_LABELS[period] ?? period}
      </p>

      <div className="row" style={{ alignItems: 'flex-end', gap: 12 }}>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="mv-value">القيمة</label>
          <input id="mv-value" className="input" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        {def.dim_key && (
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="mv-dim">{def.dim_key}</label>
            <input id="mv-dim" className="input" value={dimValue} onChange={(e) => setDimValue(e.target.value)} />
          </div>
        )}
        <div className="field" style={{ margin: 0, flex: 1, minWidth: 160 }}>
          <label htmlFor="mv-note">ملاحظة</label>
          <input id="mv-note" className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <button className="btn" disabled={busy} onClick={saveValue}><Save size={20} /> حفظ</button>
      </div>

      <div className="row" style={{ alignItems: 'flex-end', gap: 12, marginTop: 12 }}>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="mv-target">المستهدف</label>
          <input id="mv-target" className="input" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
        </div>
        <button className="btn ghost" disabled={busy} onClick={saveTarget}><Save size={20} /> حفظ المستهدف</button>
        <div className="spacer" />
        {msg && <span className="ok">{msg}</span>}
      </div>
    </div>
  );
}
