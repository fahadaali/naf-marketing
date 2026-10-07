/* خطة المحتوى في الواجهة — دوالّ صافية بلا React، تُختبر من `test/` كما
   تُختبر `campaigns.ts`.

   الأيام هنا نصوصٌ بتقويم الرياض ('YYYY-MM-DD') والشهر رقمان، ولا يمرّ شيءٌ
   منها بـ`new Date('YYYY-MM-DD')` المحلّي ولا بـ`setMonth`: الأول يُقرأ منتصفَ
   ليلٍ بتوقيت غرينتش فيصير اليوم السابق غربَ غرينتش، والثاني يطوي ٣١ يناير
   إلى مارس فيتخطّى التقويم فبراير. والحساب بـ`Date.UTC` وحده، والرياض +03:00
   ثابتةٌ بلا توقيتٍ صيفي. */

export type YearMonth = { year: number; month: number }; // الشهر ١–١٢

const pad = (n: number) => String(n).padStart(2, '0');

/** اليوم بتقويم الرياض: 'YYYY-MM-DD'، أيّاً كان توقيت الجهاز. */
export function riyadhYmd(value: Date | string | number = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(value));
}

export function riyadhToday(now: Date = new Date()): string {
  return riyadhYmd(now);
}

/** الشهر الذي فيه اليوم 'YYYY-MM-DD'. */
export function monthOf(ymd: string): YearMonth {
  const [year, month] = ymd.split('-').map(Number);
  return { year, month };
}

/** ينقل الشهر بلا يومٍ يُطوى: من يناير إلى فبراير أيّاً كان اليوم. */
export function shiftMonth({ year, month }: YearMonth, n: number): YearMonth {
  const i = year * 12 + (month - 1) + n;
  return { year: Math.floor(i / 12), month: (i % 12) + 1 };
}

export function daysInMonth({ year, month }: YearMonth): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** أوّل الشهر وآخره يوماً، ولحظتا بدايته وبداية تاليه بتوقيت الرياض. */
export function monthBounds(ym: YearMonth): { first: string; last: string; fromIso: string; toIso: string } {
  const next = shiftMonth(ym, 1);
  const first = `${ym.year}-${pad(ym.month)}-01`;
  return {
    first,
    last: `${ym.year}-${pad(ym.month)}-${pad(daysInMonth(ym))}`,
    fromIso: new Date(`${first}T00:00:00+03:00`).toISOString(),
    toIso: new Date(`${next.year}-${pad(next.month)}-01T00:00:00+03:00`).toISOString(),
  };
}

/**
 * خانات شبكة الشهر، أسبوعاً يبدأ بالأحد: فراغاتٌ قبل اليوم الأول ثم أيّامه
 * ثم فراغاتٌ تُتمّ الأسبوع الأخير. `ymd` لكل يومٍ ليُطابَق بما يقع فيه.
 */
export function monthCells(ym: YearMonth): { day: number | null; ymd: string | null }[] {
  const lead = new Date(Date.UTC(ym.year, ym.month - 1, 1)).getUTCDay();
  const cells: { day: number | null; ymd: string | null }[] = [];
  for (let i = 0; i < lead; i++) cells.push({ day: null, ymd: null });
  for (let d = 1; d <= daysInMonth(ym); d++) {
    cells.push({ day: d, ymd: `${ym.year}-${pad(ym.month)}-${pad(d)}` });
  }
  while (cells.length % 7 !== 0) cells.push({ day: null, ymd: null });
  return cells;
}

/** تاريخٌ محلّيّ يحمل اليوم نفسه، لدوالّ `naf-format` التي تقرأ بالتوقيت المحلّي. */
export function localDateOf({ year, month }: YearMonth, day = 1): Date {
  return new Date(year, month - 1, day);
}
