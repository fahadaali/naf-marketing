import type { Env } from './types';
import { refreshAllFeeds } from './services/rss';
import { pullAnalytics } from './services/analytics';
import { uploadWeeklyReport, uploadMonthlyReport } from './services/report';
import { syncComments } from './services/commentsSync';
import { checkStaleContent } from './services/alerts';
import { syncCardCommentsSafe } from './services/basecampSync';
import { runDuePublishes } from './services/publish';
import { queueDueNewsletters, sendQueuedBatch, syncNewsletterAnalytics } from './services/newsletterSend';
import { syncAllSources } from './services/metricSync';
import { syncCrm } from './services/crmSync';
import { computeAuto } from './services/metrics';
import { recomputePastPeriods } from './services/metricsHistory';
import { periodOf, previousPeriod, type PeriodKind } from './services/period';

/**
 * سحبُ المصادر واحتسابُ المؤشرات لنوع فترةٍ واحد — الجارية والسابقة معاً.
 *
 * والسابقة معها لأن مصدراً خارجيّاً يُثبّت أرقام يومٍ بعد انقضائه بساعات —
 * تحليلات الموقع تُراجع أرقامها ليومين — فاحتسابُ الجارية وحدها يترك آخر
 * يومٍ في الفترة المنصرمة على قيمةٍ ناقصة إلى الأبد.
 */
async function runMetricsFor(env: Env, kind: PeriodKind): Promise<void> {
  const current = periodOf(kind);
  for (const p of [previousPeriod(current), current]) {
    // السحب أوّلاً ثم الاحتساب: مؤشرات مشتقّة تقرأ ما وصل للتوّ
    await syncAllSources(env, p).catch(() => []);
    try {
      await computeAuto(env, p);
    } catch { /* فترةٌ تفشل لا تمنع أختها */ }
  }
}

/* ═══ كل مهمةٍ ثقيلة في دقيقتها ═══

   المشغّل واحد كل دقيقتين (في `wrangler.toml`) — حساب كلاودفلير محدود بخمس
   مهامّ مجدولة. وكل استدعاءٍ له حصّته من الطلبات الخارجية: خمسون في الخطة
   المجانية. وكانت المهام الساعية كلُّها تجري في استدعاءٍ واحد عند الدقيقة
   صفر — الأخبار والتحليلات وصندوق التعليقات معاً — بعد مزامنة بطاقات
   بيسكامب ودفعةٍ من النشرة البريدية في الاستدعاء نفسه. فتنفد الحصّة في
   منتصفها، ويسقط ما بعدها صامتاً، ويتبدّل الساقط من ساعةٍ إلى ساعة: أرقامٌ
   تظهر مرّةً وتغيب أخرى، وتعليقاتٌ لا تصل.

   فلكلّ مهمةٍ ثقيلة دقيقتُها، وفي دقيقتها لا يجري معها ما يستهلك الحصّة:
   بطاقات بيسكامب ودفعة النشرة تنتظران دقيقتين. والوقت من `scheduledTime`
   لا من ساعة التنفيذ — استدعاءٌ تأخّر ثوانيَ لا ينتقل إلى دقيقةٍ أخرى.

   | متى (UTC)                    | ماذا                                          |
   |------------------------------|-----------------------------------------------|
   | كل دورة                      | نشر المستحقّ · دفعة النشرة · بطاقات بيسكامب     |
   | :00 كل ساعة                  | الأخبار · تنبيهات التأخّر · تحليلات النشرة        |
   | :02 كل ساعة                  | لقطات المنشورات من مزوّد النشر                 |
   | :04 و:24 و:44                | صندوق التعليقات والرسائل                       |
   | :18 كل ساعة                  | سجلّ الصندوق القديم وردودُنا على قديمه         |
   | :38 كل ساعة                  | سجلّ المنشورات القديم وأرقامه                  |
   | :58 كل ساعة                  | احتساب فترتين ماضيتين                          |
   | ٠١:٠٨                        | مرآة منصة إدارة الشركة                          |
   | ٠١:١٠ · ١٢ · ١٤ · ١٦           | المصادر والاحتساب: أسبوع · شهر · ربع · سنة      |
   | ١٨:٠٦ السبت / أول الشهر        | التقرير الأسبوعي / الشهري إلى بيسكامب            |

   والسجلّ القديم في دقائقه الثلاث: خمس دقائق سقفُ كلٍّ منها (`limits.ts`)،
   فينتهي قبل الدورة المعتادة التي تليه. ولا يقع أيٌّ منها على دقائق الساعة
   الأولى المحجوزة — ‎:14 كانت مرشّحة، وفي ٠١:١٤ احتسابُ الربع.
*/

type Job =
  | 'feeds' | 'analytics' | 'inbox' | 'crm' | 'metrics' | 'reports'
  | 'inbox-history' | 'analytics-history' | 'metrics-history' | null;

const METRIC_SLOTS: Record<number, PeriodKind> = { 10: 'weekly', 12: 'monthly', 14: 'quarterly', 16: 'annual' };

/** المهمة الثقيلة لهذه الدقيقة — أو لا شيء. */
export function jobAt(at: Date): { job: Job; kind?: PeriodKind } {
  const minute = at.getUTCMinutes();
  const hour = at.getUTCHours();
  if (minute === 0 || minute === 1) return { job: 'feeds' };
  if (minute === 2 || minute === 3) return { job: 'analytics' };
  if ([4, 5, 24, 25, 44, 45].includes(minute)) return { job: 'inbox' };
  if (minute === 18 || minute === 19) return { job: 'inbox-history' };
  if (minute === 38 || minute === 39) return { job: 'analytics-history' };
  if (minute === 58 || minute === 59) return { job: 'metrics-history' };
  if (hour === 1 && (minute === 8 || minute === 9)) return { job: 'crm' };
  const even = minute - (minute % 2);
  if (hour === 1 && METRIC_SLOTS[even]) return { job: 'metrics', kind: METRIC_SLOTS[even] };
  if (hour === 18 && (minute === 6 || minute === 7)) return { job: 'reports' };
  return { job: null };
}

// معالج المهام المجدولة — كل المهام idempotent (النشر محميّ بقفل ذرّي pending → processing فلا يتكرر).
export async function handleScheduled(event: ScheduledController, env: Env): Promise<void> {
  const at = new Date(event?.scheduledTime || Date.now());
  const { job, kind } = jobAt(at);

  /* شبه فوري في كل دورة: نشر ما حان موعده. ودفعة النشرة وبطاقات بيسكامب
     في الدورات الخفيفة وحدها — تنتظران دقيقتين حين تجري مهمةٌ ثقيلة.

     queueDueNewsletters قبل sendQueuedBatch مقصود: النشرة التي حان موعدها
     تدخل الطابور ثم تُرسل أول دفعة منها في الدورة نفسها، لا بعد دقيقتين. */
  await Promise.allSettled([
    runDuePublishes(env),
    ...(job ? [] : [queueDueNewsletters(env).then(() => sendQueuedBatch(env)), syncCardCommentsSafe(env)]),
  ]);

  switch (job) {
    case 'feeds':
      await Promise.allSettled([refreshAllFeeds(env), syncNewsletterAnalytics(env), checkStaleContent(env)]);
      break;
    case 'analytics':
      await pullAnalytics(env, { trigger: 'cron' }).catch(() => 0);
      break;
    case 'inbox':
      await syncComments(env, { trigger: 'cron', skipIfRunningWithinMs: 90_000 }).catch(() => null);
      break;
    case 'inbox-history':
      await syncComments(env, { mode: 'history', skipIfRunningWithinMs: 90_000 }).catch(() => null);
      break;
    case 'analytics-history':
      await pullAnalytics(env, { mode: 'history' }).catch(() => 0);
      break;
    case 'metrics-history':
      await recomputePastPeriods(env).catch(() => []);
      break;
    case 'crm':
      await syncCrm(env).catch(() => null);
      break;
    case 'metrics':
      /* سحب المصادر واحتسابها بعد ٠١:٠٠ UTC (≈ ٠٤:٠٠ بتوقيت الرياض) — قبل
         أوّل من يفتح اللوحة، وبعد أن تُثبّت المصادر الخارجية أرقام أمس.
         ونوعٌ في كل دقيقة: الأسبوع والشهر والربع والسنة — والسنة كانت لا
         تُحتسب أصلاً فيبقى تبويبها فارغاً بلا سبب ظاهر. */
      if (kind) await runMetricsFor(env, kind);
      break;
    case 'reports':
      // التقارير عند ١٨:٠٦ UTC (≈ ٢١:٠٦ بتوقيت الرياض)
      if (at.getUTCDay() === 6) {
        try { await uploadWeeklyReport(env); } catch { /* لا تعطّل بقية المهام */ }
      }
      if (at.getUTCDate() === 1) {
        try { await uploadMonthlyReport(env); } catch { /* لا تعطّل بقية المهام */ }
      }
      break;
    default:
      break;
  }
}
