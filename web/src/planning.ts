/* خطة المحتوى في الواجهة — دوالّ صافية بلا React، تُختبر من `test/` كما
   تُختبر `campaigns.ts`.

   الأيام هنا نصوصٌ بتقويم الرياض ('YYYY-MM-DD') والشهر رقمان، ولا يمرّ شيءٌ
   منها بـ`new Date('YYYY-MM-DD')` المحلّي ولا بـ`setMonth`: الأول يُقرأ منتصفَ
   ليلٍ بتوقيت غرينتش فيصير اليوم السابق غربَ غرينتش، والثاني يطوي ٣١ يناير
   إلى مارس فيتخطّى التقويم فبراير. والحساب بـ`Date.UTC` وحده، والرياض +03:00
   ثابتةٌ بلا توقيتٍ صيفي. */

import { sortPlatforms } from './platformKeys';
import { parsePlatforms } from './campaigns';

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

/** حقول خطة المحتوى كما تحرّرها الشاشة: '' للفارغ، ومصفوفةٌ للمنصات. */
export type PlanDraft = {
  planned_on: string; // 'YYYY-MM-DD' أو '' = بلا يوم محدّد
  planned_platforms: string[];
  format: string;
  assignee_id: string; // '' = بلا مسؤول
  pillar: string; // '' = بلا محور
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

/** حدّ طول المحور — يطابق `PILLAR_MAX` في `src/services/planning.ts`. */
export const PILLAR_MAX = 80;

/**
 * محاور المحتوى من الإعدادات (`content_pillars`): نصوصٌ مقصوصةٌ بلا فراغ ولا
 * تكرار، بترتيبها. وما ليس مصفوفةً — إعدادٌ لم يُحفظ بعد أو مشوَّه — لا محاور.
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
