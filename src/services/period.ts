/* ============================================================
   الفترات — أسبوع وشهر وربع وسنة بتوقيت الرياض.

   كل ما في `metric_values` مؤرَّخ بـ`YYYY-MM-DD` محليّاً لا بـUTC. والسبب
   أن الفترة تُقرأ ولا تُحسب: «هذا الأسبوع» عند من يفتح اللوحة في الرياض
   يبدأ الأحد هناك لا الأحد في غرينتش. ولقطةٌ نُشرت الساعة ٠١:٠٠ بتوقيت
   الرياض تقع في اليوم السابق بـUTC، فحسابُ الأسبوع من UTC ينقلها إلى
   الأسبوع الماضي — ويُنقص أسبوعاً كاملاً ثلاث ساعات من أوّله وأخره.

   والرياض `UTC+3` بلا توقيت صيفي، فالإزاحة ثابتة ولا تحتاج جدول مناطق.
   ============================================================ */

/** إزاحة الرياض بالمللي ثانية — ثابتة، لا توقيت صيفي في السعودية. */
const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000;

export type PeriodKind = 'weekly' | 'monthly' | 'quarterly' | 'annual';

export type Period = {
  kind: PeriodKind;
  /** أول يوم في الفترة — `YYYY-MM-DD` بتوقيت الرياض */
  start: string;
  /** آخر يوم في الفترة شاملاً — `YYYY-MM-DD` بتوقيت الرياض */
  end: string;
};

export const PERIOD_KINDS: PeriodKind[] = ['weekly', 'monthly', 'quarterly', 'annual'];

export function isPeriodKind(value: unknown): value is PeriodKind {
  return typeof value === 'string' && (PERIOD_KINDS as string[]).includes(value);
}

/** لحظةٌ ما، منقولةً إلى ساعة الرياض كي تُقرأ أجزاؤها بـ`getUTC*`. */
function toRiyadh(at: Date | string | number): Date {
  const d = at instanceof Date ? at : new Date(at);
  return new Date(d.getTime() + RIYADH_OFFSET_MS);
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** `YYYY-MM-DD` من تاريخٍ سبق نقلُه إلى ساعة الرياض. */
function ymd(shifted: Date): string {
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** اليوم بتوقيت الرياض — `YYYY-MM-DD`. */
export function riyadhToday(at: Date | string | number = new Date()): string {
  return ymd(toRiyadh(at));
}

function fromYmd(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

function addDays(day: string, n: number): string {
  const d = fromYmd(day);
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
}

/**
 * الفترة التي تقع فيها لحظةٌ ما.
 *
 * والأسبوع يبدأ الأحد — أوّل أيام العمل في السعودية. وبدؤه الإثنين كما في
 * `ISO 8601` يقسم أسبوع العمل نصفين بين تقريرين، فيُقرأ التقرير الأسبوعي
 * وفيه ثلاثة أيام من أسبوعٍ ويومان من آخر.
 */
export function periodOf(kind: PeriodKind, at: Date | string | number = new Date()): Period {
  const r = toRiyadh(at);
  const y = r.getUTCFullYear();
  const m = r.getUTCMonth();

  if (kind === 'weekly') {
    const start = addDays(ymd(r), -r.getUTCDay()); // الأحد = 0
    return { kind, start, end: addDays(start, 6) };
  }
  if (kind === 'monthly') {
    const start = `${y}-${pad(m + 1)}-01`;
    return { kind, start, end: addDays(`${m === 11 ? y + 1 : y}-${pad(m === 11 ? 1 : m + 2)}-01`, -1) };
  }
  if (kind === 'quarterly') {
    const qm = Math.floor(m / 3) * 3;
    const start = `${y}-${pad(qm + 1)}-01`;
    const nextY = qm + 3 > 11 ? y + 1 : y;
    const nextM = (qm + 3) % 12;
    return { kind, start, end: addDays(`${nextY}-${pad(nextM + 1)}-01`, -1) };
  }
  return { kind, start: `${y}-01-01`, end: `${y}-12-31` };
}

/** الفترة السابقة لفترةٍ — أساسُ الاتجاه، ولا اتجاه بلا مقارنة. */
export function previousPeriod(p: Period): Period {
  return periodOf(p.kind, `${addDays(p.start, -1)}T12:00:00Z`);
}

/**
 * حدود الفترة كلحظتين `UTC` — للمقارنة مع الأعمدة المخزَّنة `ISO 8601 UTC`
 * (`sent_at` و`created_at` وأخواتهما). النهاية حصريّة: أوّلُ لحظةٍ بعد الفترة.
 */
export function periodBoundsUtc(p: Period): { from: string; to: string } {
  const from = new Date(fromYmd(p.start).getTime() - RIYADH_OFFSET_MS);
  const to = new Date(fromYmd(addDays(p.end, 1)).getTime() - RIYADH_OFFSET_MS);
  return { from: from.toISOString().replace(/\.\d{3}Z$/, 'Z'), to: to.toISOString().replace(/\.\d{3}Z$/, 'Z') };
}

/** عدد أيام الفترة — يُقسَم عليه لتحويل مجموعٍ إلى معدّل يومي. */
export function periodDays(p: Period): number {
  return Math.round((fromYmd(p.end).getTime() - fromYmd(p.start).getTime()) / 86_400_000) + 1;
}

/** يبني فترةً من مدخلاتٍ خارجية بعد التحقّق — أو `null` إن كانت غير صالحة. */
export function parsePeriod(kind: unknown, start: unknown): Period | null {
  if (!isPeriodKind(kind)) return null;
  if (typeof start !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return null;
  const at = new Date(`${start}T12:00:00Z`);
  if (Number.isNaN(at.getTime())) return null;
  // تُعاد بناءً على الحدود الصحيحة للنوع: من أرسل «الأربعاء» أسبوعاً يحصل على
  // أحد ذلك الأسبوع، فلا تُخزَّن فترتان لأسبوعٍ واحد بمفتاحين مختلفين.
  const p = periodOf(kind, at);
  return p;
}
