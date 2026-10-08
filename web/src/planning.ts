/* خطة المحتوى في الواجهة — دوالّ صافية بلا React، تُختبر من `test/` كما
   تُختبر `campaigns.ts`.

   الأيام هنا نصوصٌ بتقويم الرياض ('YYYY-MM-DD') والشهر رقمان، ولا يمرّ شيءٌ
   منها بـ`new Date('YYYY-MM-DD')` المحلّي ولا بـ`setMonth`: الأول يُقرأ منتصفَ
   ليلٍ بتوقيت غرينتش فيصير اليوم السابق غربَ غرينتش، والثاني يطوي ٣١ يناير
   إلى مارس فيتخطّى التقويم فبراير. والحساب بـ`Date.UTC` وحده، والرياض +03:00
   ثابتةٌ بلا توقيتٍ صيفي. */

import { sortPlatforms } from './platformKeys';
import { parsePlatforms } from './campaigns';
import { toLatinDigits } from './lib/digits';
import { formatDate } from './lib/format';

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

/** يومٌ بعد `n` يوماً (أو قبلها بسالب)، بحساب UTC فلا يتأثّر بتوقيت الجهاز. */
export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** أحدُ الأسبوع الذي فيه اليوم — الأسبوع يبدأ بالأحد كشبكة التقويم. */
export function weekStart(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return addDays(ymd, -new Date(Date.UTC(y, m - 1, d)).getUTCDay());
}

/** اليوم نفسه بعد `n` شهراً، ويُقصّ إلى آخر الشهر حين لا يوجد (٣١ ← ٢٨). */
function addMonths(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const target = shiftMonth({ year: y, month: m }, n);
  return `${target.year}-${pad(target.month)}-${pad(Math.min(d, daysInMonth(target)))}`;
}

/**
 * الاختصاران الأماميّان في منتقي النطاق (naf-terms «الفترة المعروضة»)، وبدايتهما
 * اليوم — عكس الخمسة الخلفية التي نهايتها اليوم:
 * «الشهر القادم» أوّلُه إلى آخره، و«خلال 3 أشهر» من اليوم إلى ما قبل يومه بعد
 * ثلاثة أشهر — كما أن «آخر 12 شهراً» اثنا عشر شهراً تنتهي اليوم.
 */
export function forwardRange(kind: 'next_month' | 'within_3_months', today: string): { from: string; to: string } {
  if (kind === 'next_month') {
    const { first, last } = monthBounds(shiftMonth(monthOf(today), 1));
    return { from: first, to: last };
  }
  return { from: today, to: addDays(addMonths(today, 3), -1) };
}

export type WeekRow = { start: string; end: string; counts: Record<string, number>; total: number };

/** أقصى ما يُعرض من أسابيع — ما زاد يُقال «النطاق أوسع من أن يُعرض كاملاً». */
export const PIVOT_MAX_WEEKS = 60;

/**
 * «حجم العمل»: المحتوى المخطَّط أسبوعاً بأسبوع (الأحد–السبت)، وفي كل أسبوع عددُه
 * بحسب ما يُرجعه `keysOf` — مسؤولٌ أو منصةٌ أو شكلٌ أو سلسلةٌ أو حالة.
 *
 * - المفتاح الفارغ '' خانةُ «بلا …»، وصفٌّ بلا مفاتيح يُعدّ فيها.
 * - العنصر متعدّد المفاتيح (المنصات) يُعدّ في كل مفتاح، ومرةً واحدة في الإجمالي.
 * - الأسابيع متّصلة من أوّل النطاق إلى آخره، والفارغ منها صفٌّ بأصفار: أسبوعٌ
 *   بلا خطة معلومةٌ لمن يوزّع العمل لا فراغٌ يُطوى.
 * - النطاق `range` إن جاء حدَّ الأسابيع، وإلا فأوّلُ يومٍ مخطَّط وآخرُه.
 */
export function pivotWeeks<T extends { planned_on?: string | null }>(
  rows: T[],
  keysOf: (row: T) => string[],
  range: { from?: string; to?: string } = {},
): { weeks: WeekRow[]; keys: string[]; truncated: boolean } {
  const inRange = rows.filter((r): r is T & { planned_on: string } =>
    !!r.planned_on && (!range.from || r.planned_on >= range.from) && (!range.to || r.planned_on <= range.to));
  const days = inRange.map((r) => r.planned_on).sort();
  const from = range.from || days[0];
  const to = range.to || days[days.length - 1];
  if (!from || !to || from > to) return { weeks: [], keys: [], truncated: false };

  const weeks: WeekRow[] = [];
  const index = new Map<string, WeekRow>();
  let truncated = false;
  for (let start = weekStart(from); start <= to; start = addDays(start, 7)) {
    if (weeks.length === PIVOT_MAX_WEEKS) { truncated = true; break; }
    const w = { start, end: addDays(start, 6), counts: {}, total: 0 };
    weeks.push(w);
    index.set(start, w);
  }

  const keys = new Set<string>();
  for (const r of inRange) {
    const w = index.get(weekStart(r.planned_on));
    if (!w) continue; // ما بعد الأسابيع المعروضة حين يُقطع النطاق
    const ks = [...new Set(keysOf(r))];
    for (const k of ks.length ? ks : ['']) {
      w.counts[k] = (w.counts[k] || 0) + 1;
      keys.add(k);
    }
    w.total += 1;
  }
  return { weeks, keys: [...keys], truncated };
}

/* ═══ الاستيراد ═══

   ملفُّ خطةٍ يُكتب في Excel بأسماء الأعمدة العربية المسجّلة (naf-terms «نصوص خطة
   المحتوى» ← شرح الاستيراد)، أو بمفاتيحها اللاتينية كما يُصدّرها JSON. والقيم
   أسماءٌ لا معرّفات — «إكس» و«قصة» واسم المسؤول — تُطابَق بخيارات المنصة، وما لا
   يُطابَق يُترك فارغاً ويُعدّ ليُقال. */

export type ImportField =
  | 'title' | 'body' | 'format' | 'planned_on' | 'planned_platforms' | 'assignee' | 'pillar' | 'brief' | 'campaign';
export type ImportRow = Partial<Record<ImportField, string>>;

/**
 * رؤوس الأعمدة المقبولة ← حقولها. تُقارَن بلا تشكيلٍ ولا حالة أحرف. عناوين «قالب
 * الاستيراد» المختصرة (naf-terms v1.62.0) وأسماء الحقول الكاملة معاً، وأسماءٌ
 * قديمة كـ«محور المحتوى» كي يُقرأ ملفٌّ صُدّر قبل الاستبدال.
 */
const IMPORT_HEADERS: Record<string, ImportField> = {
  title: 'title', 'العنوان': 'title',
  body: 'body', content: 'body', 'المحتوى': 'body', 'النص': 'body',
  format: 'format', 'الشكل': 'format',
  planned_on: 'planned_on', 'التاريخ': 'planned_on', 'يوم النشر المستهدف': 'planned_on',
  planned_platforms: 'planned_platforms', 'المنصات': 'planned_platforms', 'منصات التواصل': 'planned_platforms',
  assignee: 'assignee', assignee_id: 'assignee', 'مسؤول التنفيذ': 'assignee',
  pillar: 'pillar', 'السلسلة': 'pillar', 'محور المحتوى': 'pillar',
  brief: 'brief', 'الفكرة': 'brief', 'ملخص الفكرة': 'brief',
  campaign: 'campaign', campaign_id: 'campaign', 'الحملة': 'campaign',
};

// التشكيل والتطويل لا يغيّران الاسم: «ملخّص» و«ملخص» رأسٌ واحد
const headerKey = (h: string) => h.replace(/[ً-ْـ]/g, '').trim().toLowerCase();

/** صفوف جدولٍ (أوّلها الرؤوس) ← صفوف استيراد. وبلا عمود عنوانٍ فالعمود الأول عنوان. */
export function rowsFromTable(table: string[][]): ImportRow[] {
  if (table.length < 2) return [];
  const fields = table[0].map((h) => IMPORT_HEADERS[headerKey(h)]);
  const titleless = !fields.includes('title');
  return table.slice(1)
    .filter((r) => r.some((c) => c.trim()))
    .map((r) => {
      const row: ImportRow = {};
      r.forEach((cell, i) => {
        const f = fields[i] ?? (titleless && i === 0 ? 'title' : undefined);
        if (f && cell.trim() && row[f] === undefined) row[f] = cell.trim();
      });
      return row;
    });
}

export type ImportContext = {
  platforms: { key: string; label: string }[];
  assignees: { id: string; name: string }[];
  pillars: string[];
  campaigns: { id: string; name: string }[];
  formats: Record<string, string>; // المفتاح ← التسمية
};

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** أيام Excel التسلسلية تبدأ من ٣٠ ديسمبر ١٨٩٩ (بعد خطأ ١٩٠٠ الكبيسة الموروث). */
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

/**
 * يومٌ كما يُكتب في ملف الاستيراد ← 'YYYY-MM-DD'، أو `null` إن لم يُقرأ:
 * 2026/10/31 و2026-10-31 (صيغة التصدير)، و31/10/2026 (يومٌ ثم شهر كما يُكتب
 * عندنا)، بأرقامٍ غربية أو هندية، وبوقتٍ ملحقٍ يُهمل — وما يحفظه Excel رقماً
 * تسلسلياً حين يتعرّف التاريخ في الخلية.
 */
export function importDay(v: string): string | null {
  const t = toLatinDigits(v).trim().replace(/[T\s].*$/, '');
  let y: number, mo: number, d: number;
  let m = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/.exec(t);
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t))) { d = +m[1]; mo = +m[2]; y = +m[3]; }
  else if (/^\d{5}(\.\d+)?$/.test(t)) {
    // من ١٩٥٤ إلى ٢١١٩ — رقمٌ خارجها ليس تاريخاً كتبه أحد في خطة محتوى
    const serial = Math.floor(Number(t));
    if (serial < 20000 || serial > 80000) return null;
    return new Date(EXCEL_EPOCH + serial * 86_400_000).toISOString().slice(0, 10);
  } else return null;
  const ymd = `${y}-${pad(mo)}-${pad(d)}`;
  // 2026-02-30 لا يُطوى إلى مارس
  return addDays(ymd, 0) === ymd ? ymd : null;
}

/**
 * صفّ استيراد ← عنصرٌ يقبله `POST /posts/import`، وعددُ ما لم يُطابَق من قيمه.
 * كل قيمةٍ لم تُطابَق تُترك فارغة وتُعدّ مرّة؛ والمنصات قيمةً قيمة.
 */
export function mapImportRow(row: ImportRow, ctx: ImportContext): { item: Record<string, unknown>; unmatched: number } {
  let unmatched = 0;
  const item: Record<string, unknown> = { title: row.title || '', body: row.body || '' };

  if (row.format) {
    const key = Object.keys(ctx.formats).find((k) => same(k, row.format!) || same(ctx.formats[k], row.format!));
    if (key) item.format = key; else unmatched++;
  }
  if (row.planned_on) {
    const day = importDay(row.planned_on);
    if (day) item.planned_on = day; else unmatched++;
  }
  if (row.planned_platforms) {
    const keys: string[] = [];
    for (const v of row.planned_platforms.split(/[،,;]/).map((x) => x.trim()).filter(Boolean)) {
      const p = ctx.platforms.find((x) => same(x.key, v) || same(x.label, v));
      if (p) { if (!keys.includes(p.key)) keys.push(p.key); } else unmatched++;
    }
    if (keys.length) item.planned_platforms = keys;
  }
  if (row.assignee) {
    const a = ctx.assignees.find((x) => x.id === row.assignee || same(x.name, row.assignee!));
    if (a) item.assignee_id = a.id; else unmatched++;
  }
  if (row.pillar) {
    const p = ctx.pillars.find((x) => same(x, row.pillar!));
    if (p) item.pillar = p; else unmatched++;
  }
  if (row.campaign) {
    const c = ctx.campaigns.find((x) => x.id === row.campaign || same(x.name, row.campaign!));
    if (c) item.campaign_id = c.id; else unmatched++;
  }
  if (row.brief) item.brief = row.brief;
  return { item, unmatched };
}

/** اليوم كما يُكتب في ملف التصدير — صيغة `naf-format` نفسها (2026/10/31)، وهي ما يقبله الاستيراد. */
export function exportDay(ymd: string | null | undefined): string {
  return ymd ? formatDate(dayDate(ymd)) : '';
}

/** حقول خطة المحتوى كما تحرّرها الشاشة: '' للفارغ، ومصفوفةٌ للمنصات. */
export type PlanDraft = {
  planned_on: string; // 'YYYY-MM-DD' أو '' = بلا يوم محدّد
  planned_platforms: string[];
  format: string;
  assignee_id: string; // '' = بلا مسؤول
  pillar: string; // '' = بلا سلسلة
  campaign_id: string; // '' = بدون حملة
  brief: string;
};

export const EMPTY_PLAN: PlanDraft = {
  planned_on: '', planned_platforms: [], format: 'text', assignee_id: '', pillar: '', campaign_id: '', brief: '',
};

/** حقول الخطة من صفّ المحتوى كما يُرجعه الخادم. */
export function planFromPost(p: Record<string, any>): PlanDraft {
  return {
    planned_on: typeof p.planned_on === 'string' ? p.planned_on : '',
    planned_platforms: parsePlatforms(p.planned_platforms),
    format: typeof p.format === 'string' && p.format ? p.format : p.content_type || 'text',
    assignee_id: p.assignee_id || '',
    pillar: p.pillar || '',
    campaign_id: p.campaign_id || '',
    brief: p.brief || '',
  };
}

/** ما يُرسَل إلى الخادم: الفارغ `null` يمسح الحقل، والشكل يقرّر النوع هناك. */
export function planPayload(d: PlanDraft) {
  return {
    planned_on: d.planned_on || null,
    planned_platforms: d.planned_platforms.length ? d.planned_platforms : null,
    format: d.format,
    assignee_id: d.assignee_id || null,
    pillar: d.pillar.trim() || null,
    campaign_id: d.campaign_id || null,
    brief: d.brief.trim() || null,
  };
}

/** تاريخٌ محلّيّ ليومٍ 'YYYY-MM-DD'، لدوالّ `naf-format` التي تقرأ بالتوقيت المحلّي. */
export function dayDate(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** حدّ طول اسم السلسلة — يطابق `PILLAR_MAX` في `src/services/planning.ts`. */
export const PILLAR_MAX = 80;

/**
 * السلاسل من الإعدادات (`content_pillars`، والمفتاح باقٍ من اسمها القديم «محاور المحتوى»): نصوصٌ مقصوصةٌ بلا فراغ ولا
 * تكرار، بترتيبها. وما ليس مصفوفةً — إعدادٌ لم يُحفظ بعد أو مشوَّه — لا سلاسل.
 */
export function pillarsFrom(settings: { content_pillars?: unknown } | null | undefined): string[] {
  const raw = settings?.content_pillars;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const s = v.trim().slice(0, PILLAR_MAX);
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/**
 * المحتوى المخطَّط مجمّعاً بيومه المستهدف، بترتيب الخادم (اليوم ثم الإنشاء).
 * وما لا يومَ له لا يدخل التقويم — يبقى في الجدول («بلا يوم محدّد»).
 */
export function groupByPlannedDay<T extends { planned_on?: string | null }>(posts: T[]): Record<string, T[]> {
  const byDay: Record<string, T[]> = {};
  for (const p of posts) {
    if (!p.planned_on) continue;
    (byDay[p.planned_on] ||= []).push(p);
  }
  return byDay;
}

/** صفّ موعدٍ كما يُرجعه `GET /schedules`: محتوى × منصة. */
export type ScheduleRow = { id: string; post_id: string; platform: string; scheduled_at: string; title?: string };

/** بطاقة المحتوى في يومه: منصاته وأوقاتها، لا بطاقةٌ لكل منصة. */
export type DayCard = {
  key: string;
  post_id: string;
  title: string;
  /** أبكر موعدٍ للمحتوى في يومه — به تُرتَّب البطاقات. */
  first_at: string;
  platforms: string[];
  slots: { platform: string; at: string }[];
};

/**
 * المواعيد مجمّعةً بالمحتوى ويومه بتقويم الرياض: محتوى على ثلاث منصات بطاقةٌ
 * واحدة بشعاراتها الثلاثة لا ثلاث بطاقات. ومحتوى نُقل موعدُ إحدى منصاته إلى يومٍ
 * آخر يظهر في اليومين، كلٌّ بمنصاته فيه.
 */
export function groupByPostDay(rows: ScheduleRow[]): Record<string, DayCard[]> {
  const cards = new Map<string, DayCard & { day: string }>();
  for (const r of rows) {
    const day = riyadhYmd(r.scheduled_at);
    const key = `${r.post_id}|${day}`;
    let c = cards.get(key);
    if (!c) {
      c = { key, day, post_id: r.post_id, title: r.title || '', first_at: r.scheduled_at, platforms: [], slots: [] };
      cards.set(key, c);
    }
    c.slots.push({ platform: r.platform, at: r.scheduled_at });
    if (Date.parse(r.scheduled_at) < Date.parse(c.first_at)) c.first_at = r.scheduled_at;
  }
  const byDay: Record<string, DayCard[]> = {};
  for (const { day, ...c } of cards.values()) {
    c.slots.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    c.platforms = sortPlatforms(c.slots.map((s) => s.platform));
    (byDay[day] ||= []).push(c);
  }
  for (const list of Object.values(byDay)) list.sort((a, b) => Date.parse(a.first_at) - Date.parse(b.first_at));
  return byDay;
}
