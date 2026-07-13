import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, formatRiyadh } from '../api';
import { platformLabel } from '../platforms';

// تقويم محتوى موحّد بتوقيت الرياض (AST) لعرض مواعيد النشر المجدولة.
export default function Calendar() {
  const navigate = useNavigate();
  const [schedules, setSchedules] = useState<any[]>([]);
  const [cursor, setCursor] = useState(() => new Date());

  useEffect(() => {
    api.get('/schedules').then((d) => setSchedules(d.schedules));
  }, []);

  const { cells, monthLabel } = useMemo(() => buildMonth(cursor, schedules), [cursor, schedules]);

  return (
    <div>
      <div className="row" style={{ marginBottom: 16 }}>
        <h1 className="page-title">التقويم</h1>
        <div className="spacer" />
        <button className="btn ghost sm" onClick={() => setCursor(addMonths(cursor, -1))}>‹ السابق</button>
        <strong style={{ minWidth: 140, textAlign: 'center' }}>{monthLabel}</strong>
        <button className="btn ghost sm" onClick={() => setCursor(addMonths(cursor, 1))}>التالي ›</button>
      </div>

      <div className="card">
        <div className="cal-grid" style={{ marginBottom: 6 }}>
          {['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'].map((d) => (
            <div className="cal-head" key={d}>{d}</div>
          ))}
        </div>
        <div className="cal-grid">
          {cells.map((cell, i) => (
            <div key={i} className={`cal-cell ${cell.other ? 'other' : ''}`}>
              <div className="cal-day">{cell.day}</div>
              {cell.events.map((e: any) => (
                <div key={e.id} className="cal-event" title={`${e.title} — ${formatRiyadh(e.scheduled_at)}`} onClick={() => navigate(`/editor/${e.post_id}`)}>
                  {platformLabel(e.platform)}: {e.title}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function addMonths(d: Date, n: number) {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
}

// نبني الشبكة بحسب اليوم في توقيت الرياض
function riyadhParts(iso: string) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' });
  const [y, m, d] = fmt.format(new Date(iso)).split('-').map(Number);
  return { y, m, d };
}

function buildMonth(cursor: Date, schedules: any[]) {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const first = new Date(year, month, 1);
  const startDay = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const byDay: Record<string, any[]> = {};
  for (const s of schedules) {
    const p = riyadhParts(s.scheduled_at);
    if (p.y === year && p.m === month + 1) {
      (byDay[p.d] ||= []).push(s);
    }
  }

  const cells: { day: number | string; other: boolean; events: any[] }[] = [];
  for (let i = 0; i < startDay; i++) cells.push({ day: '', other: true, events: [] });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, other: false, events: byDay[d] || [] });
  while (cells.length % 7 !== 0) cells.push({ day: '', other: true, events: [] });

  const monthLabel = new Intl.DateTimeFormat('ar', { month: 'long', year: 'numeric' }).format(first);
  return { cells, monthLabel };
}
