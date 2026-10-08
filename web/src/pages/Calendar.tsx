import { ChevronRight, ChevronLeft, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, formatRiyadh, displayStatus, STATUS_LABELS } from '../api';
import { useAuth } from '../auth';
import StatusBadge from '../components/StatusBadge';
import PlanItemModal from '../components/PlanItemModal';
import { platformLabel, platformsOf, PlatformIcons, usePlatformLabels } from '../platforms';
import { formatDate, formatMonth, isolate } from '../lib/format';
import {
  type YearMonth, type DayCard, riyadhToday, monthOf, shiftMonth, monthBounds, monthCells, localDateOf,
  groupByPostDay, groupByPlannedDay, dayDate,
} from '../planning';

type Layer = 'plan' | 'schedule';
const LAYER_KEY = 'naf-calendar-layer';

/* تقويم المحتوى بتوقيت الرياض (AST)، بطبقتين:

   «مواعيد النشر» ما جُدول بساعته على منصاته — كما كان التقويم من قبل، وهي
   الافتراضية. و«خطة المحتوى» ما خُطّط له يومٌ مستهدف: أفكارٌ ومسوداتٌ وما اعتُمد
   ونُشر، ومنها تُضاف فكرةٌ في يومها. والطبقتان نصٌّ بلا أيقونة: `Calendar`
   و`CalendarClock` و`CalendarRange` مسجّلةٌ لمعانٍ أخرى تجاور هذا المبدّل. */
export default function Calendar() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [layer, setLayer] = useState<Layer>(() => (localStorage.getItem(LAYER_KEY) === 'plan' ? 'plan' : 'schedule'));
  useEffect(() => { localStorage.setItem(LAYER_KEY, layer); }, [layer]);

  const [schedules, setSchedules] = useState<any[]>([]);
  const [planned, setPlanned] = useState<any[]>([]);
  const [truncated, setTruncated] = useState(false);
  // «لا أفكار» تُقال بعد وصول الردّ لا أثناءه — وإلا ومضت على كل شهرٍ قبل خطّته
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  /* الشهر رقمان لا تاريخٌ كامل: `setMonth` على ٣١ يناير يطويه إلى مارس
     فيتخطّى الزرّ «التالي» فبراير. ويبدأ من شهر اليوم في الرياض. */
  const [ym, setYm] = useState<YearMonth>(() => monthOf(riyadhToday()));
  const [reload, setReload] = useState(0);

  /* مواعيد الشهر المعروض وحده. كانت تُجلب أقدمَ خمس مئة موعدٍ مرّةً واحدة،
     فلمّا تجاوز السجلّ خمس مئة خرجت الأشهر القادمة من التقويم بلا إشارة. */
  useEffect(() => {
    setErr('');
    const { fromIso, toIso, first, last } = monthBounds(ym);
    if (layer === 'schedule') {
      const q = new URLSearchParams({ from: fromIso, to: toIso });
      api.get(`/schedules?${q}`).then((d) => setSchedules(d.schedules)).catch((e: any) => setErr(e.message));
    } else {
      const q = new URLSearchParams({ planned: '1', planned_from: first, planned_to: last });
      setLoadingPlan(true);
      api.get(`/posts?${q}`)
        .then((d) => { setPlanned(d.posts || []); setTruncated(!!d.truncated); })
        .catch((e: any) => setErr(e.message))
        .finally(() => setLoadingPlan(false));
    }
  }, [ym, layer, reload]);

  const today = riyadhToday();
  /* المحتوى الواحد بطاقةٌ واحدة في يومه بشعارات منصاته. كانت المواعيد صفّاً لكل
     منصة، فمحتوى على ثلاث منصات يظهر ثلاث بطاقات متكرّرة العنوان. */
  const cells = useMemo(() => {
    const byDay = groupByPostDay(schedules);
    const planByDay = groupByPlannedDay(planned);
    return monthCells(ym).map((c) => ({
      ...c,
      events: (c.ymd && byDay[c.ymd]) || [],
      plans: (c.ymd && planByDay[c.ymd]) || [],
    }));
  }, [ym, schedules, planned]);
  const monthLabel = formatMonth(localDateOf(ym));
  const labels = usePlatformLabels();
  const canAdd = layer === 'plan' && can('draft.edit');

  return (
    <div>
      <div className="row" style={{ marginBottom: 16 }}>
        <h1 className="page-title">التقويم</h1>
        <div className="seg">
          <button type="button" className={layer === 'plan' ? 'on' : ''} aria-pressed={layer === 'plan'} onClick={() => setLayer('plan')}>خطة المحتوى</button>
          <button type="button" className={layer === 'schedule' ? 'on' : ''} aria-pressed={layer === 'schedule'} onClick={() => setLayer('schedule')}>مواعيد النشر</button>
        </div>
        {layer === 'plan' && (
          <span className="muted cal-count"><bdi>{planned.length}</bdi> عنصراً في هذا الشهر</span>
        )}
        <div className="spacer" />
        {msg && <span className="ok">{msg}</span>}
        {err && <span className="err">{err}</span>}
        <button className="btn ghost sm" onClick={() => setYm(shiftMonth(ym, -1))}><ChevronRight size={20} /> السابق</button>
        <strong style={{ minWidth: 140, textAlign: 'center' }}>{monthLabel}</strong>
        <button className="btn ghost sm" onClick={() => setYm(shiftMonth(ym, 1))}>التالي <ChevronLeft size={20} /></button>
      </div>

      <div className="card">
        {layer === 'plan' && truncated && <p className="muted cal-note">النطاق أوسع من أن يُعرض كاملاً. ضيّق النطاق الزمني.</p>}
        {layer === 'plan' && !err && !loadingPlan && planned.length === 0 && <p className="muted cal-note">لا أفكار في هذا الشهر بعد. أضف أول فكرة.</p>}
        <div className="cal-scroll">
          <div className="cal-grid" style={{ marginBottom: 6 }}>
            {['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'].map((d) => (
              <div className="cal-head" key={d}>{d}</div>
            ))}
          </div>
          <div className="cal-grid">
            {cells.map((cell, i) => (
              <div key={cell.ymd ?? `pad-${i}`} className={`cal-cell ${cell.day === null ? 'other' : ''}`}>
                <div className="cal-day-row">
                  <div className="cal-day">{cell.day ?? ''}</div>
                  {/* الإضافة في يومٍ قادم وحده: خطّةٌ ليومٍ مضى لا تُنشأ — تُعدَّل */}
                  {canAdd && cell.ymd && cell.ymd >= today && (
                    <button
                      type="button"
                      className="cal-add"
                      title={addLabel(cell.ymd)}
                      aria-label={addLabel(cell.ymd)}
                      onClick={() => { setMsg(''); setAdding(cell.ymd); }}
                    >
                      <Plus size={16} />
                    </button>
                  )}
                </div>
                {layer === 'schedule' && cell.events.map((e) => (
                  <button type="button" key={e.key} className="cal-event" title={cardLabel(e, labels)} aria-label={cardLabel(e, labels)} onClick={() => navigate(`/editor/${e.post_id}`)}>
                    <PlatformIcons platforms={e.platforms} custom={labels} />
                    <span className="cal-event-title">{e.title}</span>
                  </button>
                ))}
                {layer === 'plan' && cell.plans.map((p) => {
                  const ds = displayStatus(p);
                  const label = `${p.title} — ${STATUS_LABELS[ds] || ds}`;
                  return (
                    <button type="button" key={p.id} className="cal-event plan" title={label} aria-label={label} onClick={() => navigate(`/editor/${p.id}`)}>
                      <span className="row platform-row cal-plan-head">
                        <StatusBadge status={ds} size={13} iconOnly />
                        <PlatformIcons platforms={platformsOf(p)} custom={labels} />
                      </span>
                      <span className="cal-event-title">{p.title}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {adding && (
        <PlanItemModal
          day={adding}
          onClose={() => setAdding(null)}
          onCreated={() => { setAdding(null); setMsg('تمت إضافة الفكرة'); setReload((n) => n + 1); }}
        />
      )}
    </div>
  );
}

/** تسمية زرّ الإضافة في يومٍ لقارئ الشاشة وتلميحه — naf-terms «نصوص خطة المحتوى». */
function addLabel(ymd: string): string {
  return `إضافة فكرة في ${isolate(formatDate(dayDate(ymd)))}`;
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
