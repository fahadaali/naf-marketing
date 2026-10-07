import { ChevronRight, ChevronLeft } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, formatRiyadh } from '../api';
import { platformLabel, PlatformIcons, usePlatformLabels } from '../platforms';
import { formatMonth } from '../lib/format';
import {
  type YearMonth, type DayCard, riyadhToday, monthOf, shiftMonth, monthBounds, monthCells, localDateOf, groupByPostDay,
} from '../planning';

// تقويم محتوى موحّد بتوقيت الرياض (AST) لعرض مواعيد النشر المجدولة.
export default function Calendar() {
  const navigate = useNavigate();
  const [schedules, setSchedules] = useState<any[]>([]);
  /* الشهر رقمان لا تاريخٌ كامل: `setMonth` على ٣١ يناير يطويه إلى مارس
     فيتخطّى الزرّ «التالي» فبراير. ويبدأ من شهر اليوم في الرياض. */
  const [ym, setYm] = useState<YearMonth>(() => monthOf(riyadhToday()));

  /* مواعيد الشهر المعروض وحده. كانت تُجلب أقدمَ خمس مئة موعدٍ مرّةً واحدة،
     فلمّا تجاوز السجلّ خمس مئة خرجت الأشهر القادمة من التقويم بلا إشارة. */
  useEffect(() => {
    const { fromIso, toIso } = monthBounds(ym);
    const q = new URLSearchParams({ from: fromIso, to: toIso });
    api.get(`/schedules?${q}`).then((d) => setSchedules(d.schedules));
  }, [ym]);

  /* المحتوى الواحد بطاقةٌ واحدة في يومه بشعارات منصاته. كانت المواعيد صفّاً لكل
     منصة، فمحتوى على ثلاث منصات يظهر ثلاث بطاقات متكرّرة العنوان. */
  const cells = useMemo(() => {
    const byDay = groupByPostDay(schedules);
    return monthCells(ym).map((c) => ({ ...c, events: (c.ymd && byDay[c.ymd]) || [] }));
  }, [ym, schedules]);
  const monthLabel = formatMonth(localDateOf(ym));
  const labels = usePlatformLabels();

  return (
    <div>
      <div className="row" style={{ marginBottom: 16 }}>
        <h1 className="page-title">التقويم</h1>
        <div className="spacer" />
        <button className="btn ghost sm" onClick={() => setYm(shiftMonth(ym, -1))}><ChevronRight size={20} /> السابق</button>
        <strong style={{ minWidth: 140, textAlign: 'center' }}>{monthLabel}</strong>
        <button className="btn ghost sm" onClick={() => setYm(shiftMonth(ym, 1))}>التالي <ChevronLeft size={20} /></button>
      </div>

      <div className="card">
        <div className="cal-scroll">
          <div className="cal-grid" style={{ marginBottom: 6 }}>
            {['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'].map((d) => (
              <div className="cal-head" key={d}>{d}</div>
            ))}
          </div>
          <div className="cal-grid">
            {cells.map((cell, i) => (
              <div key={cell.ymd ?? `pad-${i}`} className={`cal-cell ${cell.day === null ? 'other' : ''}`}>
                <div className="cal-day">{cell.day ?? ''}</div>
                {cell.events.map((e) => (
                  <button type="button" key={e.key} className="cal-event" title={cardLabel(e, labels)} aria-label={cardLabel(e, labels)} onClick={() => navigate(`/editor/${e.post_id}`)}>
                    <PlatformIcons platforms={e.platforms} custom={labels} />
                    <span className="cal-event-title">{e.title}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * ما تقوله البطاقة لقارئ الشاشة وفي التلميح: العنوان ثم منصاته بأوقاتها — والوقت
 * الواحد لكل المنصات يُذكر مرةً واحدة.
 */
function cardLabel(c: DayCard, labels?: Record<string, string>): string {
  const times = new Set(c.slots.map((s) => s.at));
  if (times.size === 1) {
    return `${c.title} — ${formatRiyadh(c.first_at)} — ${c.platforms.map((p) => platformLabel(p, labels)).join('، ')}`;
  }
  return `${c.title} — ${c.slots.map((s) => `${platformLabel(s.platform, labels)} ${formatRiyadh(s.at)}`).join('، ')}`;
}
