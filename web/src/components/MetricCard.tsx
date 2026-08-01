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

function TrendChip({ m }: { m: MetricReading }) {
  const trend = trendOf(m.value, m.previous);
  const Icon = TREND_ICON[trend];
  if (!Icon) return <span className="muted metric-trend">{TREND_LABELS.no_baseline}</span>;

  const good = trendIsGood(trend, m.target_direction);
  const change = trendPercent(m.value, m.previous);
  // اللون يتبع اتجاه المستهدف لا اتجاه السهم — والمحايد بلا لون
  const tone = good === null ? '' : good ? ' is-good' : ' is-bad';

  return (
    <span className={`metric-trend${tone}`} title={TREND_LABELS[trend]}>
      <Icon size={14} aria-hidden="true" />
      <span className="sr-only">{TREND_LABELS[trend]}</span>
      {change !== null && <bdi>{Math.abs(change)}%</bdi>}
    </span>
  );
}

export default function MetricCard({ m, onPick }: { m: MetricReading; onPick?: (m: MetricReading) => void }) {
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
        {hasValue && <TrendChip m={m} />}
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
            القطاع وذاك ما نلتزم به، ومكتبٌ يبلغ مستهدفه وهو دون القطاع بلغ
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
