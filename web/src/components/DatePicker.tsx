import { useState } from 'react';
import { ChevronRight, ChevronLeft, Calendar, Clock } from 'lucide-react';
import { Popover } from './Popover';
import { formatDate, formatMonth, formatDateTime } from '../lib/format';

// منتقي تواريخ عصري (شبكة تقويم) — نطاق «من/إلى» ومنتقي تاريخ+وقت.
// التنقّل: النقر على العنوان يفتح شبكة الأشهر، ثم شبكة السنوات، للوصول السريع.

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYMD = (s: string) => (s ? new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10))) : null);
const WEEK = ['أحد', 'إثن', 'ثلا', 'أرب', 'خمي', 'جمع', 'سبت'];
// أسماء الأشهر لشبكة اختيار الشهر — تسميات واجهة لا صيغة تاريخ.
// عرض قيمة تاريخ يمرّ من lib/format حصراً (CLAUDE.md §8).
const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

function fmtAr(s: string) {
  const d = parseYMD(s);
  return d ? formatDate(d) : '';
}

// شبكة التقويم مع أوضاع: أيام / أشهر / سنوات
function CalGrid({
  month,
  setMonth,
  start,
  end,
  onPick,
}: {
  month: Date;
  setMonth: (d: Date) => void;
  start: string;
  end: string;
  onPick: (s: string) => void;
}) {
  const [mode, setMode] = useState<'days' | 'months' | 'years'>('days');
  const y = month.getFullYear();
  const m = month.getMonth();
  const today = ymd(new Date());

  const prev = () => setMonth(mode === 'days' ? new Date(y, m - 1, 1) : mode === 'months' ? new Date(y - 1, m, 1) : new Date(y - 12, m, 1));
  const next = () => setMonth(mode === 'days' ? new Date(y, m + 1, 1) : mode === 'months' ? new Date(y + 1, m, 1) : new Date(y + 12, m, 1));
  const y0 = Math.floor(y / 12) * 12;
  const title = mode === 'days' ? formatMonth(month) : mode === 'months' ? String(y) : `${y0} – ${y0 + 11}`;
  const cycle = () => setMode((mo) => (mo === 'days' ? 'months' : mo === 'months' ? 'years' : 'years'));

  const first = new Date(y, m, 1);
  const startDay = first.getDay();
  const daysIn = new Date(y, m + 1, 0).getDate();
  const cells: { s?: string; day?: number }[] = [];
  for (let i = 0; i < startDay; i++) cells.push({});
  for (let d = 1; d <= daysIn; d++) cells.push({ s: ymd(new Date(y, m, d)), day: d });

  return (
    <div className="dp-cal">
      <div className="dp-head">
        <button type="button" className="dp-nav" onClick={prev}><ChevronRight size={20} /></button>
        <button type="button" className="dp-title" onClick={cycle}>{title}</button>
        <button type="button" className="dp-nav" onClick={next}><ChevronLeft size={20} /></button>
      </div>

      {mode === 'days' && (
        <>
          <div className="dp-week">{WEEK.map((w) => <span key={w}>{w}</span>)}</div>
          <div className="dp-days">
            {cells.map((c, i) => {
              if (!c.s) return <span key={i} />;
              const sel = c.s === start || c.s === end;
              const inR = start && end && c.s > start && c.s < end;
              const cls = ['dp-day', sel ? 'sel' : '', inR ? 'inrange' : '', c.s === today ? 'today' : ''].filter(Boolean).join(' ');
              return <button key={i} type="button" className={cls} onClick={() => onPick(c.s!)}>{c.day}</button>;
            })}
          </div>
        </>
      )}

      {mode === 'months' && (
        <div className="dp-mg">
          {MONTHS_AR.map((name, i) => (
            <button key={i} type="button" className={i === m ? 'sel' : ''} onClick={() => { setMonth(new Date(y, i, 1)); setMode('days'); }}>{name}</button>
          ))}
        </div>
      )}

      {mode === 'years' && (
        <div className="dp-mg">
          {Array.from({ length: 12 }, (_, i) => y0 + i).map((yr) => (
            <button key={yr} type="button" className={yr === y ? 'sel' : ''} onClick={() => { setMonth(new Date(yr, m, 1)); setMode('months'); }}>{yr}</button>
          ))}
        </div>
      )}
    </div>
  );
}

// ===== منتقي النطاق (من/إلى) =====
export function DateRangePicker({
  from,
  to,
  onChange,
  placeholder = 'كل التواريخ',
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  placeholder?: string;
}) {
  const [month, setMonth] = useState<Date>(() => parseYMD(from) || new Date());

  return (
    <Popover
      render={({ toggle }) => (
        <button type="button" className="dp-trigger" onClick={toggle}>
          <Calendar size={16} />
          {from && to ? <span>{fmtAr(from)} — {fmtAr(to)}</span> : from ? <span>{fmtAr(from)} — …</span> : <span className="ph">{placeholder}</span>}
        </button>
      )}
    >
      {({ close }) => {
        const pick = (s: string) => {
          if (!from || (from && to)) onChange(s, '');
          else { let a = from, b = s; if (b < a) [a, b] = [b, a]; onChange(a, b); close(); }
        };
        const presets: [string, () => void][] = [
          ['اليوم', () => { const t = ymd(new Date()); onChange(t, t); close(); }],
          ['آخر 7 أيام', () => { const e = new Date(); const s = new Date(); s.setDate(s.getDate() - 6); onChange(ymd(s), ymd(e)); close(); }],
          ['آخر 30 يوماً', () => { const e = new Date(); const s = new Date(); s.setDate(s.getDate() - 29); onChange(ymd(s), ymd(e)); close(); }],
          ['هذا الشهر', () => { const n = new Date(); onChange(ymd(new Date(n.getFullYear(), n.getMonth(), 1)), ymd(new Date(n.getFullYear(), n.getMonth() + 1, 0))); close(); }],
          ['مسح', () => { onChange('', ''); close(); }],
        ];
        return (
          <div className="dp-pop">
            <div className="dp-presets">{presets.map(([l, f]) => <button key={l} type="button" onClick={f}>{l}</button>)}</div>
            <CalGrid month={month} setMonth={setMonth} start={from} end={to} onPick={pick} />
          </div>
        );
      }}
    </Popover>
  );
}

// ===== منتقي تاريخ + وقت (للجدولة) =====
export function DateTimePicker({
  value,
  onChange,
  inline = false,
}: {
  value: string; // 'YYYY-MM-DDTHH:mm'
  onChange: (v: string) => void;
  inline?: boolean;
}) {
  const datePart = value ? value.slice(0, 10) : '';
  const timePart = value ? value.slice(11, 16) : '12:00';
  const [month, setMonth] = useState<Date>(() => parseYMD(datePart) || new Date());

  const panel = (
    <>
      <CalGrid month={month} setMonth={setMonth} start={datePart} end="" onPick={(s) => onChange(`${s}T${timePart || '12:00'}`)} />
      <div className="dp-time">
        <label style={{ fontSize: 12, color: 'var(--muted-foreground)', display: 'block', marginBottom: 4 }}>الوقت</label>
        <div className="row" style={{ gap: 8 }}>
          <Clock size={16} />
          <input className="input" style={{ width: 130 }} type="time" value={timePart} onChange={(e) => onChange(`${datePart || ymd(new Date())}T${e.target.value}`)} />
        </div>
      </div>
    </>
  );

  if (inline) return <div className="dp-inline">{panel}</div>;

  const label = value ? formatDateTime(new Date(`${value}:00`)) : 'اختر التاريخ والوقت';

  return (
    <Popover
      render={({ toggle }) => (
        <button type="button" className="dp-trigger" onClick={toggle}>
          <Calendar size={16} />
          <span className={value ? '' : 'ph'}>{label}</span>
        </button>
      )}
    >
      {() => <div className="dp-pop" style={{ flexDirection: 'column' }}>{panel}</div>}
    </Popover>
  );
}
