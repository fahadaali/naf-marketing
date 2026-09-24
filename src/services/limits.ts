import type { Env } from '../types';

/* ═══ حصص المزامنة بحسب خطة كلاودفلير ═══

   المجانية: خمسون طلباً خارجياً في الاستدعاء الواحد. والمدفوعة: عشرة آلاف
   طلبٍ خارجي، وألف استعلامٍ لـD1، وثلاثون ثانيةً من المعالج للمهمة المجدولة
   كل دقيقتين، وخمس عشرة دقيقةً من الوقت. والحصص هنا دون ذلك كلّه بكثير،
   وهذا هو الاحتياط:

   ١) الحدّ الفعلي ألفُ استعلامٍ لـD1 لا عشرةُ آلاف طلب: كل نداءٍ لمزوّد النشر
      يجرّ ثلاثة استعلاماتٍ أو أربعة. فمئةٌ وخمسون نداءً تبقى دون ستمئة.
   ٢) لكل دورةٍ سقفٌ من الوقت تقف عنده: الخطّاف يعمل بعد الردّ على المزوّد
      وله ثلاثون ثانيةً لا أكثر، والسحب اليدوي ينتظره المستخدم، والمجدولة
      تنتهي قبل أن تبدأ المهمة التي تليها في جدول `cron.ts`.
   ٣) المزوّد إن طلب التمهّل (٤٢٩) وقفت الدورة وأكملت التي بعدها — لا تُلحّ.
   ٤) الخطة تُقرأ من `WORKERS_PLAN`، وبغيابها تُفترض المجانية. ودورةٌ بدأت ولم
      تكتب تقريرها بعد خمس عشرة دقيقة أسقطها حدٌّ ما — فتعود الحصص إلى
      المجانية يوماً كاملاً ثم تُجرَّب المدفوعة من جديد. */

export type Plan = 'free' | 'paid';
/** `history` سحبُ السجلّ القديم — مجدولٌ كذلك، وسقفُ وقته أقصر كي ينتهي قبل الدورة المعتادة التي تليه. */
export type Trigger = 'cron' | 'webhook' | 'manual' | 'history';

const CALLS: Record<Plan, Record<Trigger, number>> = {
  free: { cron: 40, webhook: 30, manual: 45, history: 40 },
  paid: { cron: 150, webhook: 30, manual: 60, history: 150 },
};

/** سقف الوقت بالثواني — واحدٌ في الخطتين: الخطّاف والانتظار لا يتغيّران بالخطة. */
const SECONDS: Record<Trigger, number> = { cron: 8 * 60, webhook: 20, manual: 45, history: 5 * 60 };

/** أقصى عمر دورةٍ مجدولة في كلاودفلير — بعده لا تكون جاريةً بل ساقطة. */
const MAX_RUN_MS = 15 * 60_000;
const FALLBACK_KEY = 'plan_fallback_until';

async function getSetting(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).bind(key, value).run();
}

export function declaredPlan(env: Env): Plan {
  return String(env.WORKERS_PLAN ?? '').trim().toLowerCase() === 'paid' ? 'paid' : 'free';
}

export type RunLimits = {
  calls: number;
  /** لحظةٌ (ms) لا يُنادى بعدها. */
  deadline: number;
  plan: Plan;
  /** الخطة مدفوعة والحصص مجانية — لأن دورةً سقطت في آخر يوم. */
  fallback: boolean;
};

/** حصّة دورةٍ واحدة: عدد نداءاتها وسقف وقتها. */
export async function runLimits(env: Env, trigger: Trigger): Promise<RunLimits> {
  const declared = declaredPlan(env);
  let fallback = false;
  if (declared === 'paid') {
    const until = await getSetting(env, FALLBACK_KEY);
    fallback = !!until && Date.parse(until) > Date.now();
  }
  const plan: Plan = fallback ? 'free' : declared;
  return { calls: CALLS[plan][trigger], deadline: Date.now() + SECONDS[trigger] * 1000, plan: declared, fallback };
}

/**
 * دورةٌ بدأت (قفلها بعد تقريرها الأخير) ولم تكتب تقريرها بعد خمس عشرة دقيقة:
 * أسقطها حدٌّ ما — وأكثرُه حدُّ استعلامات D1، وهو يمنع حتى كتابة التقرير. فلا
 * تعرف الدورةُ الساقطة أنها سقطت، وتعرفه التي بعدها: فتنزل الحصص إلى
 * المجانية يوماً. يُنادى قبل أن تكتب الدورة الجديدة قفلها.
 */
export async function noteDeadRun(env: Env, lockAt: string | null, reportAt: string | null): Promise<boolean> {
  if (!lockAt) return false;
  const started = Date.parse(lockAt);
  if (!Number.isFinite(started)) return false;
  const reported = reportAt ? Date.parse(reportAt) : 0;
  if (started <= reported + 1000) return false;
  if (Date.now() - started < MAX_RUN_MS) return false;
  if (declaredPlan(env) !== 'paid') return false;
  await setSetting(env, FALLBACK_KEY, new Date(Date.now() + 86_400_000).toISOString());
  return true;
}
