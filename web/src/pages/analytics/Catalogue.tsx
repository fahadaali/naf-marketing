import { useEffect, useState } from 'react';
import { CalendarCheck, Compass, Gauge, Megaphone, Save } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api, formatRiyadh } from '../../api';
import { formatNumber } from '../../lib/format';
import { Money } from '../../components/Money';
import {
  CADENCE_LABELS, CLASS_LABELS, INTEGRATION_LABELS, LAYERS, REFERENCE_LABELS, SOURCE_LABELS, UNIT_SUFFIX,
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
  benchmark_value: number | null; benchmark_note: string | null;
  decision: string | null; reviewed_at: string | null;
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
                <th>الدورية</th><th>المستهدف</th><th>المعيار القطاعي</th>
                <th>القرار المحتمل</th>{canManage && <th />}
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
                    <td title={d.benchmark_note ?? undefined}>
                      {d.benchmark_value === null
                        ? <span className="muted">—</span>
                        : <bdi>{formatNumber(d.benchmark_value)}{UNIT_SUFFIX[d.unit]}</bdi>}
                    </td>
                    {/* الدليل: لا تقس ما لا تنوي التصرف بناءً عليه. والخانة
                        الفارغة هنا سؤالٌ مطروح لا نقصٌ في العرض. */}
                    <td className="muted">{d.decision ?? '—'}</td>
                    {canManage && (
                      <td>
                        <button type="button" className="btn sm ghost" onClick={() => setPicked(d)}>تسجيل</button>
                      </td>
                    )}
                  </tr>
                );
              })}
              {shown.length === 0 && (
                <tr><td colSpan={canManage ? 9 : 8} className="muted">لا مؤشر في هذه الطبقة بعد.</td></tr>
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
  const [benchmark, setBenchmark] = useState(def.benchmark_value === null ? '' : String(def.benchmark_value));
  const [decision, setDecision] = useState(def.decision ?? '');
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
        benchmark_value: benchmark === '' ? null : Number(benchmark),
        benchmark_note: def.benchmark_note,
        decision: decision.trim() === '' ? null : decision.trim(),
      });
      setMsg('تم تسجيل المستهدف');
      onSaved();
    } catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  }

  /** يُسقط وسم الاستحقاق حتى تمرّ دورية المؤشر — المراجعة فعلٌ يُسجَّل. */
  async function markReviewed() {
    setBusy(true);
    try {
      await api.post(`/metrics/definitions/${def.key}/reviewed`);
      setMsg('تم تسجيل المراجعة');
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

      {/* المرجعية ثلاث: مقارنةٌ زمنية تُحسب، ومستهدفٌ نلتزم به، ومعيارٌ
          عليه القطاع. والقرار رابعٌ يسأل السؤال قبل أن يُجمع الرقم. */}
      <div className="row" style={{ alignItems: 'flex-end', gap: 12, marginTop: 12 }}>
        <div className="field" style={{ margin: 0, maxWidth: 140 }}>
          <label htmlFor="mv-target">{REFERENCE_LABELS.target}</label>
          <input id="mv-target" className="input" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
        </div>
        <div className="field" style={{ margin: 0, maxWidth: 160 }}>
          <label htmlFor="mv-benchmark">{REFERENCE_LABELS.benchmark}</label>
          <input id="mv-benchmark" className="input" inputMode="decimal" value={benchmark} onChange={(e) => setBenchmark(e.target.value)} />
        </div>
        <div className="field" style={{ margin: 0, flex: 1, minWidth: 200 }}>
          <label htmlFor="mv-decision">{REFERENCE_LABELS.decision}</label>
          <input id="mv-decision" className="input" value={decision} onChange={(e) => setDecision(e.target.value)} />
        </div>
        <button className="btn ghost" disabled={busy} onClick={saveTarget}><Save size={20} /> حفظ المرجعية</button>
      </div>

      <div className="row" style={{ gap: 12, marginTop: 12 }}>
        <span className="muted" style={{ fontSize: 'var(--text-xs)' }}>
          {REFERENCE_LABELS.reviewed_at}:{' '}
          {def.reviewed_at ? <bdi>{formatRiyadh(def.reviewed_at)}</bdi> : 'لم يُراجع بعد'}
        </span>
        <button className="btn sm ghost" disabled={busy} onClick={markReviewed}>
          <CalendarCheck size={20} /> تسجيل المراجعة
        </button>
        <div className="spacer" />
        {msg && <span className="ok">{msg}</span>}
      </div>
    </div>
  );
}
