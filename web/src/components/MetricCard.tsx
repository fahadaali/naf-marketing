import { CalendarSync, Compass, Gauge, Megaphone, TrendingUp, TrendingDown, Equal, CircleCheck, CircleAlert, CircleHelp, TriangleAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { formatNumber } from '../lib/format';
import { Money } from './Money';
import {
  CLASS_LABELS, REFERENCE_LABELS, SOURCE_LABELS, TARGET_STATUS_BADGE, TARGET_STATUS_LABELS,
  TREND_LABELS, UNIT_SUFFIX, dimensionLabel, targetStatus, trendIsGood, trendOf, trendPercent,
  type MetricClass, type MetricUnit, type TargetDirection, type TargetStatus, type Trend, type ValueSource,
} from '../metrics';

/* بطاقة مؤشر — الرقم وفئته وحالته أمام مستهدفه واتجاهه معاً.

   الثلاثة ليست زينة حول الرقم بل شرطُ قراءته: «مئة ألف ظهور» و«عشرة عملاء
   مؤهلين» يظهران بالحجم نفسه، والثاني وحده يُترجم إلى إيراد. والرقم بلا
   مقارنة زمنية أو مستهدف لا يعني شيئاً — القاعدة الثالثة في ملاحظات الدليل.

   الأيقونات من `naf-icons.md` قسم «المؤشرات والتحليل». */

export type MetricReading = {
  key: string;
  layer: string;
  name_ar: string;
  unit: MetricUnit;
  class: MetricClass;
  source: string;
  integration_key: string | null;
  cadence: string;
  dim_key: string;
  target_value: number | null;
  target_direction: TargetDirection;
  target_min: number | null;
  target_max: number | null;
  board_rank: number | null;
  value: number | null;
  sample: number | null;
  value_source: ValueSource | null;
  updated_at: string | null;
  note: string | null;
  previous: number | null;
  benchmark_value: number | null;
  benchmark_note: string | null;
  decision: string | null;
  reviewed_at: string | null;
  review_due: boolean;
  breakdown: { dim_value: string; value: number; sample: number | null }[];
};

const CLASS_ICON: Record<MetricClass, LucideIcon> = {
  north_star: Compass,
  operational: Gauge,
  vanity: Megaphone,
};

const TARGET_ICON: Record<TargetStatus, LucideIcon> = {
  on_target: CircleCheck,
  near_target: TriangleAlert,
  off_target: CircleAlert,
  no_target: CircleHelp,
};

const TREND_ICON: Record<Trend, LucideIcon | null> = {
  up: TrendingUp,
  down: TrendingDown,
  flat: Equal,
  no_baseline: null,
};

/** الرقم بوحدته. المبلغ وحده يمرّ بـ`Money` — الرمز والعزل والأرقام منه. */
export function MetricValue({ value, unit }: { value: number; unit: MetricUnit }) {
  if (unit === 'currency') return <Money value={value} />;
  if (unit === 'rank') return <bdi>المركز {formatNumber(value)}</bdi>;
  const text = Number.isInteger(value) ? formatNumber(value) : String(value);
  return (
    <bdi>
      {text}
      {UNIT_SUFFIX[unit]}
    </bdi>
  );
}

function TargetChip({ m }: { m: MetricReading }) {
  const status = targetStatus(m.value, m.target_value, m.target_direction, m.target_min, m.target_max);
  const Icon = TARGET_ICON[status];
  return (
    <span className={`badge ${TARGET_STATUS_BADGE[status]}`}>
      <Icon size={13} />
      {TARGET_STATUS_LABELS[status]}
    </span>
  );
}

function TrendChip({ m, series }: { m: MetricReading; series?: number[] }) {
  const trend = trendOf(m.value, m.previous);
  const Icon = TREND_ICON[trend];
  if (!Icon) return <span className="muted metric-trend">{TREND_LABELS.no_baseline}</span>;

  const good = trendIsGood(trend, m.target_direction);
  const change = trendPercent(m.value, m.previous);
  // اللون يتبع اتجاه المستهدف لا اتجاه السهم — والمحايد بلا لون
  const tone = good === null ? '' : good ? ' is-good' : ' is-bad';

  return (
    <span className={`metric-trend${tone}`} title={TREND_LABELS[trend]}>
      {series && series.length > 1 && (
        <Sparkline
          points={series}
          label={`مسار ${m.name_ar} عبر آخر ${formatNumber(series.length)} فترة`}
        />
      )}
      <Icon size={14} aria-hidden="true" />
      <span className="sr-only">{TREND_LABELS[trend]}</span>
      {change !== null && <bdi>{Math.abs(change)}%</bdi>}
    </span>
  );
}

/**
 * خطّ الاتجاه — سلسلة المؤشر عبر فتراته.
 *
 * سهمُ `TrendChip` يقارن فترةً بالتي قبلها وحدها: رقمٌ صعد بعد ثلاث
 * نزلات يقرؤه القارئ صعوداً. والخطّ يقول أين هو من مساره.
 *
 * وهو رسمٌ واحد بلا محاور ولا شبكة — سلسلةٌ واحدة، فلا مفتاح ولا ألوان
 * تصنيفية: يأخذ لونه من `currentColor` الذي يضبطه الأب من اتجاه
 * المستهدف، فيتّحد مع السهم فوقه ولا يدخل لونٌ ثالث.
 *
 * والنقطة الأخيرة مُبرزة: عينُ القارئ تقع على «أين نحن الآن» أولاً.
 *
 * ولا مؤشّر تمرير: البطاقة نفسها زرٌّ يفتح تفصيل المؤشر، وطبقةُ تمرير
 * فوق رسمٍ بعرض ستين بكسلاً تنازع النقرة ولا تُقرأ. والقيم كاملةً في
 * التفصيل، وهي «العرض الجدولي» لهذا الرسم.
 */
function Sparkline({ points, label }: { points: number[]; label: string }) {
  // نقطتان حدُّ الخطّ: واحدةٌ ليست مساراً
  if (points.length < 2) return null;

  const W = 64;
  const H = 20;
  const PAD = 1.5; // نصفُ سُمك الخطّ، كي لا يُقصّ عند الحافة

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min;

  const x = (i: number) => (i / (points.length - 1)) * W;
  // سلسلةٌ مسطّحة تُرسم في الوسط لا على الحافة — القسمة على صفرٍ تعطي NaN
  const y = (v: number) => (span === 0 ? H / 2 : PAD + (1 - (v - min) / span) * (H - PAD * 2));

  const d = points.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const lastX = x(points.length - 1);
  const lastY = y(points[points.length - 1]);

  return (
    <svg
      className="metric-spark"
      viewBox={`0 0 ${W} ${H}`}
      width={W}
      height={H}
      role="img"
      aria-label={label}
      /* لا قلب في RTL: إحداثيات SVG مطلقة لا تتبع `direction`، وقواعد
         القلب في `naf-app-shell.css` تخصّ `.lucide-*` وحدها. ومحور
         الرسم زمنٌ يُقرأ من الأقدم إلى الأحدث في كل لغة — وقلبُه يجعل
         الخطّ الصاعد نازلاً. */
      preserveAspectRatio="none"
    >
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX.toFixed(1)} cy={lastY.toFixed(1)} r="2" fill="currentColor" />
    </svg>
  );
}

export default function MetricCard({
  m,
  onPick,
  series,
}: {
  m: MetricReading;
  onPick?: (m: MetricReading) => void;
  /** سلسلة المؤشر عبر فتراته — أقدمُها أوّلاً. تصل من نداءٍ واحد للوحة كلّها. */
  series?: number[];
}) {
  const ClassIcon = CLASS_ICON[m.class];
  const hasValue = m.value !== null;

  const body = (
    <>
      <div className="row metric-head">
        <span className="metric-class" title={CLASS_LABELS[m.class]}>
          <ClassIcon size={14} aria-hidden="true" />
          <span className="sr-only">{CLASS_LABELS[m.class]}</span>
        </span>
        <span className="metric-name">{m.name_ar}</span>
        <div className="spacer" />
        {hasValue && <TrendChip m={m} series={series} />}
      </div>

      {hasValue ? (
        <div className="metric-value">
          <MetricValue value={m.value as number} unit={m.unit} />
        </div>
      ) : (
        /* «لا قيمة مسجّلة» لا «لا توجد بيانات» — الشاشة الفارغة تدعو إلى فعل،
           وهذه تسمّي الفعلين المتاحين: التسجيل أو الربط. */
        <p className="metric-empty">
          {m.source === 'integration'
            ? 'لا مصدر مربوط لهذا المؤشر. اربط مصدره أو سجّل قيمته.'
            : 'لا قيمة مسجّلة لهذه الفترة. سجّلها أو اربط مصدرها.'}
        </p>
      )}

      <div className="row metric-foot">
        <TargetChip m={m} />
        {/* المعيار القطاعي — المرجعية الثالثة. غير المستهدف: هذا ما عليه
            القطاع وذاك ما نلتزم به، وشركةٌ تبلغ مستهدفه وهو دون القطاع بلغ
            ما وضعه لنفسه لا ما يكفي للمنافسة. */}
        {m.benchmark_value !== null && (
          <span className="muted" title={m.benchmark_note ?? undefined}>
            {REFERENCE_LABELS.benchmark} <bdi>{formatNumber(m.benchmark_value)}{UNIT_SUFFIX[m.unit]}</bdi>
          </span>
        )}
        {m.value_source && <span className="muted">{SOURCE_LABELS[m.value_source]}</span>}
        {m.sample !== null && m.sample > 0 && (
          <span className="muted">
            من <bdi>{formatNumber(m.sample)}</bdi>
          </span>
        )}
        {/* الدورية وحدها لا تُنبّه: مؤشرٌ ربعيٌّ لم يُراجع منذ سنة يبدو
            كأخيه المراجَع أمس. */}
        {m.review_due && (
          <span className="badge gray">
            <CalendarSync size={13} />
            {REFERENCE_LABELS.review_due}
          </span>
        )}
      </div>

      {/* لا تقس ما لا تنوي التصرف بناءً عليه — أوّل ملاحظات الدليل الختامية. */}
      {m.decision && <p className="metric-decision">{m.decision}</p>}

      {m.breakdown.length > 0 && (
        <ul className="metric-breakdown">
          {m.breakdown.slice(0, 6).map((b) => (
            <li key={b.dim_value}>
              <span>{dimensionLabel(m.dim_key, b.dim_value)}</span>
              <div className="spacer" />
              <span className="metric-breakdown-value">
                <MetricValue value={b.value} unit={m.unit} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );

  if (!onPick) return <div className="card metric-card">{body}</div>;
  return (
    <button type="button" className="card metric-card" onClick={() => onPick(m)}>
      {body}
    </button>
  );
}
