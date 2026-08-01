import type { Env } from './types';
import { refreshAllFeeds } from './services/rss';
import { pullAnalytics } from './services/analytics';
import { uploadWeeklyReport, uploadMonthlyReport } from './services/report';
import { syncComments } from './services/commentsSync';
import { checkStaleContent } from './services/alerts';
import { syncCardCommentsSafe } from './services/basecampSync';
import { runDuePublishes } from './services/publish';
import { sendQueuedBatch, syncNewsletterAnalytics } from './services/newsletterSend';
import { syncAllSources } from './services/metricSync';
import { syncCrm } from './services/crmSync';
import { computeAuto } from './services/metrics';
import { periodOf, previousPeriod } from './services/period';

/**
 * سحبُ المصادر واحتسابُ المؤشرات — مرّةً في اليوم.
 *
 * والفترة الجارية والسابقة معاً: مصدرٌ خارجيّ يُثبّت أرقام يومٍ بعد انقضائه
 * بساعات — تحليلات الموقع تُراجع أرقامها ليومين — فاحتسابُ الجارية وحدها
 * يترك آخر يومٍ في الشهر المنصرم على قيمةٍ ناقصة إلى الأبد.
 *
 * وأنواع الفترات الثلاث تُحتسب كلُّها: اللوحة الأسبوعية تقرأ الأسبوع،
 * وأكثر الطبقات شهريّ، والاحتفاظ والقيمة العمرية ربعيّة. وترْكُ نوعٍ بلا
 * احتساب يجعل تبويبَه فارغاً بلا سبب ظاهر.
 */
async function runMetricsDaily(env: Env): Promise<void> {
  for (const kind of ['weekly', 'monthly', 'quarterly'] as const) {
    const current = periodOf(kind);
    const previous = previousPeriod(current);
    for (const p of [previous, current]) {
      // السحب أوّلاً ثم الاحتساب: مؤشرات مشتقّة تقرأ ما وصل للتوّ
      await Promise.allSettled([syncAllSources(env, p), syncCrm(env)]);
      try {
        await computeAuto(env, p);
      } catch { /* فترةٌ تفشل لا تمنع أختها */ }
    }
  }
}

// معالج المهام المجدولة — مشغّل cron واحد فقط في wrangler.toml: "*/2 * * * *"
// (حساب Cloudflare محدود بـ ٥ مهام cron إجمالاً، فدمجنا كل شيء في مشغّل واحد ونتحكّم بالتوقيت هنا)
//   • كل دورة (كل دقيقتين): نشر المواعيد المستحقّة + دفعة من النشرة البريدية +
//     مزامنة تعليقات بطاقات بيسكامب — شبه فورية.
//   • بداية كل ساعة (الدقيقة 0): جلب RSS + سحب التحليلات + تعليقات المنصات + تنبيهات التأخر.
//   • السبت ٢١:٠٠ بتوقيت الرياض (١٨:٠٠ UTC): التقرير الأسبوعي يُرفع إلى بيسكامب.
//   • أول الشهر ٢١:٠٠ بتوقيت الرياض (١٨:٠٠ UTC): التقرير الشهري يُرفع إلى بيسكامب.
// كل المهام idempotent (النشر محميّ بقفل ذرّي pending → processing فلا يتكرر).
export async function handleScheduled(_event: ScheduledController, env: Env): Promise<void> {
  const now = new Date();
  const minute = now.getUTCMinutes();
  const hour = now.getUTCHours();
  const day = now.getUTCDay(); // 6 = السبت
  const date = now.getUTCDate(); // 1 = أول الشهر

  // شبه فوري في كل دورة (كل دقيقتين): نشر ما حان موعده، ثم تعليقات بيسكامب.
  // مستقلّان — فشل أحدهما لا يمنع الآخر.
  await Promise.allSettled([runDuePublishes(env), sendQueuedBatch(env), syncCardCommentsSafe(env)]);

  // المهام الساعية: عند بداية الساعة فقط (نافذة الدقيقتين 0..1) كي لا تتكرر كل دقيقتين
  if (minute < 2) {
    await Promise.allSettled([
      refreshAllFeeds(env),
      pullAnalytics(env),
      syncComments(env),
      syncNewsletterAnalytics(env),
      checkStaleContent(env),
    ]);

    /* سحب المؤشرات واحتسابها عند ٠١:٠٠ UTC (≈ ٠٤:٠٠ بتوقيت الرياض) — قبل
       أوّل من يفتح اللوحة، وبعد أن تُثبّت المصادر الخارجية أرقام أمس. */
    if (hour === 1) {
      try { await runMetricsDaily(env); } catch { /* لا تعطّل بقية المهام */ }
    }

    // التقارير عند الساعة ١٨:٠٠ UTC (≈ ٢١:٠٠ بتوقيت الرياض)
    if (hour === 18) {
      if (day === 6) {
        try { await uploadWeeklyReport(env); } catch { /* لا تعطّل بقية المهام */ }
      }
      if (date === 1) {
        try { await uploadMonthlyReport(env); } catch { /* لا تعطّل بقية المهام */ }
      }
    }
  }
}
