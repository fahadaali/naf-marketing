import type { Env } from '../types';

/* ═══ حصص المزامنة بحسب خطة كلاودفلير ═══

   المجانية: خمسون طلباً خارجياً في الاستدعاء الواحد. والمدفوعة: عشرة آلاف
   طلبٍ خارجي، وألف استعلامٍ لـD1، وثلاثون ثانيةً من المعالج للمهمة المجدولة
   كل دقيقتين، وخمس عشرة دقيقةً من الوقت. والحصص هنا دون ذلك كلّه بكثير،
   وهذا هو الاحتياط:

   ١) الحدّ الفعلي ألفُ استعلامٍ لـD1 لا عشرةُ آلاف طلب: كل نداءٍ لمزوّد النشر
      يجرّ استعلامين إلى خمسة — قيست: من ٢٧٦ إلى ٦٦٠ لمئةٍ وثمانية وثلاثين
      نداءً بحسب ازدحام المنشورات. فمئةٌ وخمسون تبقى دون الألف في المعتاد،
      والنادر الذي يتجاوزه يسقط فيُنزل الحصص كما في (٤).
   ٢) لكل دورةٍ سقفٌ من الوقت تقف عنده: الخطّاف يعمل بعد الردّ على المزوّد
      وله ثلاثون ثانيةً لا أكثر، والسحب اليدوي ينتظره المستخدم، والمجدولة
      تنتهي قبل أن تبدأ المهمة التي تليها في جدول `cron.ts`.
   ٣) المزوّد إن طلب التمهّل (٤٢٩) وقفت الدورة وأكملت التي بعدها — لا تُلحّ.
   ٤) الخطة تُقرأ من `WORKERS_PLAN`، وبغيابها تُفترض المجانية. ودورةٌ مجدولة
      بدأت ولم تتمّ بعد خمس عشرة دقيقة أسقطها حدٌّ ما — فتعود الحصص إلى
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
 * بدءُ دورةٍ مجدولة: علامةٌ تمحوها الدورة حين تتمّ (`endScheduledRun`). وعلامةٌ
 * باقيةٌ بعد خمس عشرة دقيقة دورةٌ سقطت — أسقطها حدٌّ ما، وأكثرُه حدُّ استعلامات
 * D1، وهو يمنعها حتى من محو علامتها. فلا تعرف الساقطةُ أنها سقطت، وتعرفه التي
 * بعدها: فتنزل الحصص إلى المجانية يوماً، وهذه الدورة أوّلُ ما ينزل.
 *
 * والمجدولة وحدها تُراقَب، ولكلّ مهمةٍ علامتها. كان الرصد بقفلٍ وتقريرٍ
 * مشتركين، فخطّافٌ أو سحبٌ يدويّ يبدأ بعد دورةٍ مجدولة وينتهي قبلها يترك القفل
 * أحدثَ من التقرير — فيُقرأ سقوطاً وتنزل الحصص يوماً بلا سبب. والخطّاف واليدوي
 * يُقطعان كذلك لأسبابٍ لا صلة لها بالحدود: طلبٌ أُغلق، أو عملٌ جاوز ثلاثين
 * ثانيةً بعد الردّ.
 */
export async function beginScheduledRun(env: Env, job: string): Promise<string> {
  const key = `run_open:${job}`;
  const open = await getSetting(env, key);
  if (open && Date.now() - Date.parse(open) >= MAX_RUN_MS && declaredPlan(env) === 'paid') {
    await setSetting(env, FALLBACK_KEY, new Date(Date.now() + 86_400_000).toISOString());
  }
  const mark = new Date().toISOString();
  await setSetting(env, key, mark);
  return mark;
}

/** تمامُ الدورة المجدولة: تمحو علامتها — إن بقيت علامتها هي. */
export async function endScheduledRun(env: Env, job: string, mark: string): Promise<void> {
  await env.DB.prepare("UPDATE settings SET value = '' WHERE key = ? AND value = ?").bind(`run_open:${job}`, mark).run();
}
