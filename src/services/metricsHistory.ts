import type { Env } from '../types';
import { computeAuto } from './metrics';
import { PERIOD_KINDS, periodOf, previousPeriod, type Period, type PeriodKind } from './period';
import { nowIso } from '../util';

/* ═══ احتساب الفترات الماضية ═══

   الليل يحتسب الفترة الجارية والسابقة لكل نوع. وما قبلهما كان يبقى على ما
   احتُسب يوم كان جارياً — أو بلا قيمةٍ أصلاً إن سبق ربطَ مصدره — فالسنة
   الماضية تُفتح فارغة، ولا تنفعها أرقامٌ وصلت بعدها من سحب السجلّ.

   فيُعاد احتسابُ ما قبل السابقة على دفعات: فترتان في كل ساعة، ما لم يُحتسب
   قطّ أوّلاً ثم أقدمُها احتساباً — فتدور على الفترات التسع والعشرين كل خمس
   عشرة ساعةً تقريباً. واثنتان لأن الفترة الواحدة تكتب نحو مئتي استعلام،
   وللاستدعاء ألفُ استعلامٍ لـD1 — قيست ثلاثٌ بستمئةٍ وعشرين، والهامشُ احتياط.
   وفترةٌ يتعذّر احتسابها تُعدّ محاولةً فتنتقل إلى آخر الدور: لا تبقى أوّلَه
   تأخذ مكانها في كل دفعة.

   والاحتساب وحده، بلا سحب المصادر الخارجية: سحبُ فترةٍ قديمة يُسجَّل حالةً
   للمصدر، ومصدرٌ لا يحفظ إلا أشهراً قليلة يصير «تعذّر السحب» وهو سليم. وما
   وصل منها يوم كانت فتراته جاريةً محفوظٌ لا يمسّه الاحتساب. */

/** كم فترةً قبل السابقة يُعاد احتسابها لكل نوع — سنةٌ من الأسابيع والأشهر والأرباع وما قبلها. */
const DEPTH: Record<PeriodKind, number> = { weekly: 12, monthly: 12, quarterly: 4, annual: 1 };
const PER_RUN = 2;
const STATE_KEY = 'metrics_history';

const keyOf = (p: Period) => `${p.kind}:${p.start}`;

/** الفترات التي يدور عليها الاحتساب — ما قبل السابقة، بعمق `DEPTH` لكل نوع. */
export function pastPeriods(at: Date = new Date()): Period[] {
  const out: Period[] = [];
  for (const kind of PERIOD_KINDS) {
    // السابقة يحتسبها الليل مع الجارية
    let p = previousPeriod(periodOf(kind, at));
    for (let i = 0; i < DEPTH[kind]; i++) {
      p = previousPeriod(p);
      out.push(p);
    }
  }
  return out;
}

async function readState(env: Env): Promise<Record<string, string>> {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(STATE_KEY).first<{ value: string }>();
  try {
    const v = row?.value ? JSON.parse(row.value) : {};
    return v && typeof v === 'object' ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** يحتسب دفعةً من الفترات الماضية ويعيد ما احتسبه. فترةٌ تفشل لا تمنع أختها. */
export async function recomputePastPeriods(env: Env, at: Date = new Date()): Promise<Period[]> {
  const state = await readState(env);
  const periods = pastPeriods(at);
  const due = [...periods].sort((a, b) => (state[keyOf(a)] ?? '').localeCompare(state[keyOf(b)] ?? '')).slice(0, PER_RUN);

  const done: Period[] = [];
  for (const p of due) {
    try {
      await computeAuto(env, p);
      done.push(p);
    } catch { /* تُعاد في دورها التالي */ }
    state[keyOf(p)] = nowIso();
  }

  // ما خرج من النافذة لا يبقى في الحالة
  const keep = new Set(periods.map(keyOf));
  const next = Object.fromEntries(Object.entries(state).filter(([k]) => keep.has(k)));
  await env.DB.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).bind(STATE_KEY, JSON.stringify(next)).run();
  return done;
}
