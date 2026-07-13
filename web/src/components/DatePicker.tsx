import { useEffect, useRef, useState } from 'react';
import { ChevronRight, ChevronLeft, CalendarDays, Clock } from 'lucide-react';

// منتقي تواريخ عصري (شبكة تقويم) — نطاق «من/إلى» ومنتقي تاريخ+وقت.

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYMD = (s: string) => (s ? new Date(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10))) : null);
const WEEK = ['أحد', 'إثن', 'ثلا', 'أرب', 'خمي', 'جمع', 'سبت'];

function monthLabel(d: Date) {
  return new Intl.DateTimeFormat('ar', { month: 'long', year: 'numeric' }).format(d);
}
export function fmtAr(s: string) {
  const d = parseYMD(s);
  return d ? new Intl.DateTimeFormat('ar', { day: 'numeric', month: 'short', year: 'numeric' }).format(d) : '';
}

function useOutside(cb: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) cb();
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  });
  return ref;
}

function MonthGrid({
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
  const y = month.getFullYear();
  const m = month.getMonth();
  const first = new Date(y, m, 1);
  const startDay = first.getDay();
  const daysIn = new Date(y, m + 1, 0).getDate();
  const today = ymd(new Date());

  const cells: { s?: string; day?: number; other?: boolean }[] = [];
  for (let i = 0; i < startDay; i++) cells.push({ other: true });
  for (let d = 1; d <= daysIn; d++) cells.push({ s: ymd(new Date(y, m, d)), day: d });

  return (
    <div className="dp-cal">
      <div className="dp-head">
        <button type="button" className="dp-nav" onClick={() => setMonth(new Date(y, m - 1, 1))}><ChevronRight size={16} /></button>
        <b>{monthLabel(month)}</b>
        <button type="button" className="dp-nav" onClick={() => setMonth(new Date(y, m + 1, 1))}><ChevronLeft size={16} /></button>
      </div>
      <div className="dp-week">{WEEK.map((w) => <span key={w}>{w}</span>)}</div>
      <div className="dp-days">
        {cells.map((c, i) => {
          if (!c.s) return <span key={i} />;
          const sel = c.s === start || c.s === end;
          const inR = start && end && c.s > start && c.s < end;
          const cls = ['dp-day', sel ? 'sel' : '', inR ? 'inrange' : '', c.s === today ? 'today' : ''].filter(Boolean).join(' ');
          return (
            <button key={i} type="button" className={cls} onClick={() => onPick(c.s!)}>{c.day}</button>
          );
        })}
      </div>
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
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState<Date>(() => parseYMD(from) || new Date());
  const ref = useOutside(() => setOpen(false));

  function pick(s: string) {
    if (!from || (from && to)) {
      onChange(s, '');
    } else {
      let a = from, b = s;
      if (b < a) [a, b] = [b, a];
      onChange(a, b);
      setOpen(false);
    }
  }

  const presets: [string, () => void][] = [
    ['اليوم', () => { const t = ymd(new Date()); onChange(t, t); setOpen(false); }],
    ['آخر ٧ أيام', () => { const e = new Date(); const s = new Date(); s.setDate(s.getDate() - 6); onChange(ymd(s), ymd(e)); setOpen(false); }],
    ['آخر ٣٠ يوماً', () => { const e = new Date(); const s = new Date(); s.setDate(s.getDate() - 29); onChange(ymd(s), ymd(e)); setOpen(false); }],
    ['هذا الشهر', () => { const n = new Date(); onChange(ymd(new Date(n.getFullYear(), n.getMonth(), 1)), ymd(new Date(n.getFullYear(), n.getMonth() + 1, 0))); setOpen(false); }],
    ['مسح', () => { onChange('', ''); setOpen(false); }],
  ];

  return (
    <div className="menu-wrap" ref={ref} style={{ display: 'inline-block' }}>
      <div className="dp-trigger" onClick={() => setOpen((v) => !v)}>
        <CalendarDays size={16} />
        {from && to ? <span>{fmtAr(from)} — {fmtAr(to)}</span> : from ? <span>{fmtAr(from)} — …</span> : <span className="ph">{placeholder}</span>}
      </div>
      {open && (
        <div className="dp-pop">
          <div className="dp-presets">{presets.map(([l, f]) => <button key={l} type="button" onClick={f}>{l}</button>)}</div>
          <MonthGrid month={month} setMonth={setMonth} start={from} end={to} onPick={pick} />
        </div>
      )}
    </div>
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
  const [open, setOpen] = useState(false);
  const datePart = value ? value.slice(0, 10) : '';
  const timePart = value ? value.slice(11, 16) : '12:00';
  const [month, setMonth] = useState<Date>(() => parseYMD(datePart) || new Date());
  const ref = useOutside(() => setOpen(false));

  function pickDate(s: string) {
    onChange(`${s}T${timePart || '12:00'}`);
  }
  function setTime(t: string) {
    onChange(`${datePart || ymd(new Date())}T${t}`);
  }

  const panel = (
    <>
      <MonthGrid month={month} setMonth={setMonth} start={datePart} end="" onPick={pickDate} />
      <div className="dp-time">
        <label style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))', display: 'block', marginBottom: 4 }}>الوقت</label>
        <div className="row" style={{ gap: 8 }}>
          <Clock size={16} />
          <input className="input" style={{ width: 130 }} type="time" value={timePart} onChange={(e) => setTime(e.target.value)} />
        </div>
      </div>
    </>
  );

  if (inline) return <div className="dp-inline">{panel}</div>;

  const label = value
    ? new Intl.DateTimeFormat('ar', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(`${value}:00`))
    : 'اختر التاريخ والوقت';

  return (
    <div className="menu-wrap" ref={ref} style={{ display: 'inline-block' }}>
      <div className="dp-trigger" onClick={() => setOpen((v) => !v)}>
        <CalendarDays size={16} />
        <span className={value ? '' : 'ph'}>{label}</span>
      </div>
      {open && <div className="dp-pop" style={{ flexDirection: 'column' }}>{panel}</div>}
    </div>
  );
}
