import { useEffect, useState, type ReactNode } from 'react';
import { ChevronRight, ChevronLeft, Calendar, Clock } from 'lucide-react';
import { Popover } from './Popover';
import { formatDate, formatMonth, formatDateTime } from '../lib/format';
import { parseTime24, toLatinDigits } from '../lib/digits';
import { forwardRange, monthBounds, monthOf, riyadhToday } from '../planning';

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
        <button type="button" className="dp-nav" onClick={prev} aria-label="السابق"><ChevronRight size={20} className="chev-dir" /></button>
        <button type="button" className="dp-title" onClick={cycle}>{title}</button>
        <button type="button" className="dp-nav" onClick={next} aria-label="التالي"><ChevronLeft size={20} className="chev-dir" /></button>
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
  presets: direction = 'past',
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  placeholder?: string;
  /** «past» الاختصارات التي نهايتها اليوم، و«future» الأماميّة التي بدايتها اليوم —
      ليوم النشر المستهدف، وهو يومٌ قادم في الغالب. */
  presets?: 'past' | 'future';
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
        /* الاختصارات مسجّلةٌ في «الفترة المعروضة» (naf-terms §١٣)، ونهايتُها اليوم
           والعدد فيها معزول الاتجاه كأيّ رقم. و«آخر 12 شهراً» لا «آخر سنة»: الثانية
           تُقرأ السنةَ التقويمية الماضية. */
        const lastDays = (n: number) => { const e = new Date(); const s = new Date(); s.setDate(s.getDate() - (n - 1)); onChange(ymd(s), ymd(e)); close(); };
        // الأماميّان بتقويم الرياض كاليوم المستهدف نفسه — naf-terms «الفترة المعروضة»
        const ahead = (kind: 'next_month' | 'within_3_months') => { const r = forwardRange(kind, riyadhToday()); onChange(r.from, r.to); close(); };
        const presets: [string, ReactNode, () => void][] = direction === 'future' ? [
          ['next', 'الشهر القادم', () => ahead('next_month')],
          ['3m', <>خلال <bdi>3</bdi> أشهر</>, () => ahead('within_3_months')],
          ['month', 'هذا الشهر', () => { const { first, last } = monthBounds(monthOf(riyadhToday())); onChange(first, last); close(); }],
          ['clear', 'مسح', () => { onChange('', ''); close(); }],
        ] : [
          ['today', 'اليوم', () => { const t = ymd(new Date()); onChange(t, t); close(); }],
          ['7d', <>آخر <bdi>7</bdi> أيام</>, () => lastDays(7)],
          ['30d', <>آخر <bdi>30</bdi> يوماً</>, () => lastDays(30)],
          ['month', 'هذا الشهر', () => { const n = new Date(); onChange(ymd(new Date(n.getFullYear(), n.getMonth(), 1)), ymd(new Date(n.getFullYear(), n.getMonth() + 1, 0))); close(); }],
          ['12m', <>آخر <bdi>12</bdi> شهراً</>, () => { const e = new Date(); onChange(ymd(new Date(e.getFullYear(), e.getMonth() - 12, e.getDate() + 1)), ymd(e)); close(); }],
          ['clear', 'مسح', () => { onChange('', ''); close(); }],
        ];
        return (
          <div className="dp-pop">
            <div className="dp-presets">{presets.map(([k, l, f]) => <button key={k} type="button" onClick={f}>{l}</button>)}</div>
            <CalGrid month={month} setMonth={setMonth} start={from} end={to} onPick={pick} />
          </div>
        );
      }}
    </Popover>
  );
}

// ===== منتقي يومٍ واحد (يوم النشر المستهدف) =====
// الشبكة نفسها التي يستعملها النطاق والجدولة؛ والفراغ قيمةٌ مقصودة («بلا يوم محدّد»)
// يعود إليها «مسح».
export function DayPicker({
  value,
  onChange,
  placeholder,
  id,
  disabled = false,
}: {
  value: string; // 'YYYY-MM-DD' أو ''
  onChange: (v: string) => void;
  placeholder: string;
  id?: string;
  disabled?: boolean;
}) {
  const [month, setMonth] = useState<Date>(() => parseYMD(value) || new Date());

  return (
    <Popover
      render={({ toggle }) => (
        <button type="button" id={id} className="dp-trigger" onClick={toggle} disabled={disabled}>
          <Calendar size={16} />
          {value ? <bdi>{fmtAr(value)}</bdi> : <span className="ph">{placeholder}</span>}
        </button>
      )}
    >
      {({ close }) => (
        <div className="dp-pop dp-day-pop">
          <CalGrid month={month} setMonth={setMonth} start={value} end="" onPick={(s) => { onChange(s); close(); }} />
          {value && (
            <div className="dp-presets">
              <button type="button" onClick={() => { onChange(''); close(); }}>مسح</button>
            </div>
          )}
        </div>
      )}
    </Popover>
  );
}

/* حقل الوقت نصّاً لا `type="time"`: ذاك لا يقبل الأرقام الهندية، ويعرض
   ١٢ ساعة بحسب لغة الجهاز. وما يُكتب يُحوَّل إلى الغربية في الحقل نفسه وهو
   يُكتب، ويُعتمد متى صار وقتاً صحيحاً؛ وما لا يصير وقتاً يرجع عند الخروج من
   الحقل إلى آخر وقتٍ صحيح. */
function TimeInput({ value, onChange }: { value: string; onChange: (t: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      className="input"
      style={{ width: 130 }}
      type="text"
      inputMode="numeric"
      dir="ltr"
      autoComplete="off"
      placeholder="14:30"
      value={text}
      onChange={(e) => {
        const typed = toLatinDigits(e.target.value);
        setText(typed);
        const t = parseTime24(typed);
        if (t && /^\d{1,2}[:.]\d{2}$/.test(typed.trim())) onChange(t);
      }}
      onBlur={() => {
        const t = parseTime24(text);
        if (t) {
          setText(t);
          if (t !== value) onChange(t);
        } else {
          setText(value);
        }
      }}
    />
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
        <label style={{ fontSize: 'var(--text-xs)', color: 'var(--muted-foreground)', display: 'block', marginBottom: 4 }}>الوقت</label>
        <div className="row" style={{ gap: 8 }}>
          <Clock size={16} />
          <TimeInput value={timePart} onChange={(t) => onChange(`${datePart || ymd(new Date())}T${t}`)} />
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
