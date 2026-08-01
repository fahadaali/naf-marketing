/* ============================================================
   مفردات المؤشرات في الواجهة.

   كل ما هنا منقولٌ عن `naf-terms.md` §١٣ و`naf-icons.md`. لا يُخترع اسمٌ
   ولا وحدةٌ ولا حالةٌ في شاشة — والاسم العربي للمؤشر نفسه يأتي من الخادم
   (`metric_definitions.name_ar`) لا من هنا، فهو مسجَّل في القاعدة.
   ============================================================ */

export type MetricUnit =
  | 'count' | 'percentage' | 'currency' | 'ratio'
  | 'days' | 'hours' | 'minutes' | 'seconds'
  | 'rank' | 'score' | 'rating';

export type MetricClass = 'vanity' | 'operational' | 'north_star';
export type ValueSource = 'auto' | 'integration' | 'manual';
export type TargetDirection = 'higher_better' | 'lower_better' | 'range';
export type TargetStatus = 'on_target' | 'near_target' | 'off_target' | 'no_target';
export type Trend = 'up' | 'down' | 'flat' | 'no_baseline';

/** أسماء الطبقات في التبويبات — بترتيب الدليل، من الأعلى ظهوراً إلى الأعمق أثراً. */
export const LAYERS: { key: string; label: string }[] = [
  { key: 'board', label: 'اللوحة المختصرة' },
  { key: 'reach', label: 'الوصول والظهور' },
  { key: 'engagement', label: 'التفاعل والمحتوى' },
  { key: 'web', label: 'الموقع والبحث' },
  { key: 'funnel', label: 'التحويل ومسار البيع' },
  { key: 'cost', label: 'التكلفة والعائد' },
  { key: 'retention', label: 'الاحتفاظ والنمو' },
  { key: 'audience', label: 'الجمهور والاستهداف' },
  { key: 'email', label: 'البريد والتواصل' },
  { key: 'attribution', label: 'الإسناد والقياس' },
  { key: 'operations', label: 'التشغيل وجودة البيانات' },
  { key: 'catalogue', label: 'دليل المؤشرات' },
];

export const CLASS_LABELS: Record<MetricClass, string> = {
  north_star: 'مؤشر قيادي',
  operational: 'مؤشر تشغيل',
  vanity: 'مؤشر غرور',
};

export const SOURCE_LABELS: Record<ValueSource, string> = {
  auto: 'محتسب',
  integration: 'من تكامل',
  manual: 'مُدخَل',
};

export const CADENCE_LABELS: Record<string, string> = {
  weekly: 'أسبوعياً',
  monthly: 'شهرياً',
  quarterly: 'ربعياً',
  annual: 'سنوياً',
};

export const PERIOD_LABELS: Record<string, string> = {
  weekly: 'هذا الأسبوع',
  monthly: 'هذا الشهر',
  quarterly: 'هذا الربع',
  annual: 'هذه السنة',
};

export const TARGET_STATUS_LABELS: Record<TargetStatus, string> = {
  on_target: 'ضمن المستهدف',
  near_target: 'قريب من المستهدف',
  off_target: 'دون المستهدف',
  no_target: 'لا مستهدف',
};

/** رموز الشارات في `styles.css` — العائلات نفسها المسجّلة للحالات. */
export const TARGET_STATUS_BADGE: Record<TargetStatus, string> = {
  on_target: 'green',
  near_target: 'amber',
  off_target: 'red',
  no_target: 'gray',
};

export const TREND_LABELS: Record<Trend, string> = {
  up: 'ارتفاع',
  down: 'انخفاض',
  flat: 'ثبات',
  no_baseline: 'لا مقارنة',
};

/** المرجعية الثالثة والقرار والمراجعة — `naf-terms.md` §١٣. */
export const REFERENCE_LABELS = {
  target: 'المستهدف',
  benchmark: 'المعيار القطاعي',
  decision: 'القرار المحتمل',
  review_due: 'مستحقّ المراجعة',
  reviewed_at: 'آخر مراجعة',
  heatmap_open: 'فتح خريطة الحرارة',
} as const;

export const INTEGRATION_LABELS: Record<string, string> = {
  crm: 'منصة إدارة الشركة',
  web_analytics: 'تحليلات الموقع',
  search_console: 'أدوات مشرفي المواقع',
  business_profile: 'الملف التجاري',
  ads: 'منصات الإعلان',
  messaging: 'قنوات المراسلة',
  call_tracking: 'تتبّع المكالمات',
  listening: 'رصد الذكر والمشاعر',
};

export const SYNC_STATUS_LABELS: Record<string, string> = {
  never_synced: 'لم يُسحب بعد',
  ok: 'مربوط',
  sync_failed: 'تعذّر السحب',
};

/** أسماء الأيام — لبُعد «التفاعل حسب التوقيت» المخزَّن `يوم-ساعة` رقمين. */
const DAY_NAMES = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

/** مراحل مسار البيع الستّ — بأسمائها وترتيبها المسجَّلين، لا تُختصر ولا يُزاد عليها. */
export const FUNNEL_STAGES: { key: string; label: string }[] = [
  { key: 'visitor_lead', label: 'زائر ← محتمل' },
  { key: 'lead_qualified', label: 'محتمل ← مؤهل' },
  { key: 'qualified_meeting', label: 'مؤهل ← اجتماع' },
  { key: 'meeting_proposal', label: 'اجتماع ← عرض' },
  { key: 'proposal_contract', label: 'عرض ← تعاقد' },
  { key: 'qualified_contract', label: 'مؤهل ← تعاقد' },
];

/**
 * يترجم قيمة البُعد إلى نصٍّ يُقرأ.
 *
 * وأكثرُها يُعرض كما هو — اسمُ مصدرٍ أو كلمةٌ مفتاحية أو مدينة كتبها المصدر
 * الخارجي. والمترجَم هو ما خُزّن رمزاً عمداً كي لا يصير تغييرُ تسميةٍ هجرةَ
 * بيانات.
 */
export function dimensionLabel(dimKey: string, dimValue: string): string {
  if (dimKey === 'time_slot') {
    const [day, hour] = dimValue.split('-');
    const name = DAY_NAMES[Number(day)] ?? day;
    // الوقت بنظام ٢٤ ساعة معزولاً اتجاهياً — قاعدة التنسيق في naf-terms §٥
    return `${name} ⁨${hour}:00⁩`;
  }
  if (dimKey === 'stage') {
    return FUNNEL_STAGES.find((s) => s.key === dimValue)?.label ?? dimValue;
  }
  return dimValue;
}

/**
 * حالة الرقم أمام مستهدفه.
 *
 * و«قريب من المستهدف» داخل عُشر المسافة — لا رأيٌ في الرقم بل مسافةٌ تُقاس.
 * والحدّ واحدٌ في كل المؤشرات كي لا يصير لكل شاشة تعريفُ «قريب».
 */
export function targetStatus(
  value: number | null,
  target: number | null,
  direction: TargetDirection,
  min: number | null,
  max: number | null,
): TargetStatus {
  if (value === null) return 'no_target';

  if (direction === 'range') {
    if (min === null && max === null) return 'no_target';
    const lo = min ?? -Infinity;
    const hi = max ?? Infinity;
    if (value >= lo && value <= hi) return 'on_target';
    const span = (Number.isFinite(hi) ? hi : lo) - (Number.isFinite(lo) ? lo : hi) || Math.abs(value) || 1;
    const distance = value < lo ? lo - value : value - hi;
    return distance <= Math.abs(span) * 0.1 ? 'near_target' : 'off_target';
  }

  if (target === null) return 'no_target';
  const met = direction === 'lower_better' ? value <= target : value >= target;
  if (met) return 'on_target';
  const gap = Math.abs(value - target) / (Math.abs(target) || 1);
  return gap <= 0.1 ? 'near_target' : 'off_target';
}

/** حركة الرقم عن الفترة السابقة — وصفٌ للحركة لا حكمٌ عليها. */
export function trendOf(value: number | null, previous: number | null): Trend {
  if (value === null || previous === null) return 'no_baseline';
  if (previous === 0) return value === 0 ? 'flat' : 'up';
  const change = (value - previous) / Math.abs(previous);
  if (Math.abs(change) < 0.01) return 'flat';
  return change > 0 ? 'up' : 'down';
}

/** نسبة التغيّر عن الفترة السابقة، أو `null` حين لا مقارنة. */
export function trendPercent(value: number | null, previous: number | null): number | null {
  if (value === null || previous === null || previous === 0) return null;
  return Math.round(((value - previous) / Math.abs(previous)) * 1000) / 10;
}

/**
 * أهي حركةٌ في صالح المؤشر؟
 *
 * انخفاض تكلفة الاكتساب مكسب وانخفاض المؤهلين خسارة، والسهم واحد. فاللون
 * يتبع اتجاه المستهدف المسجّل لا اتجاه السهم — و`null` حين لا حركة أصلاً.
 */
export function trendIsGood(trend: Trend, direction: TargetDirection): boolean | null {
  if (trend === 'flat' || trend === 'no_baseline') return null;
  if (direction === 'range') return null;
  const rising = trend === 'up';
  return direction === 'lower_better' ? !rising : rising;
}

/** لاحقة الوحدة كما تُقرأ بعد الرقم. المبلغ لا لاحقة له — الرمز جزءٌ منه. */
export const UNIT_SUFFIX: Record<MetricUnit, string> = {
  count: '',
  percentage: '%',
  currency: '',
  ratio: ':1',
  days: ' يوماً',
  hours: ' ساعة',
  minutes: ' دقيقة',
  seconds: ' ثانية',
  rank: '',
  score: '',
  rating: '',
};
