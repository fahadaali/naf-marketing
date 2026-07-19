import type { Env } from './types';
import { refreshAllFeeds } from './services/rss';
import { pullAnalytics } from './services/analytics';
import { uploadWeeklyReport } from './services/report';
import { syncComments } from './services/commentsSync';
import { checkStaleContent } from './services/alerts';
import { syncCardCommentsSafe } from './services/basecampSync';
import { uploadMonthlyReport } from './services/report';

// معالج المهام المجدولة. cron المُعرّفة في wrangler.toml:
//   "17 * * * *" → جلب RSS + سحب التحليلات + التعليقات (كل ساعة) + تعليقات بطاقات بيسكامب + تنبيهات التأخر
//   "0 18 * * 6" → التقرير الأسبوعي (السبت ٩:٠٠م بتوقيت الرياض = ١٨:٠٠ UTC) يُرفع إلى بيسكامب
//   "0 18 1 * *" → التقرير الشهري (اليوم الأول من الشهر ٩:٠٠م بتوقيت الرياض) يُرفع إلى بيسكامب
// النشر يدوي عبر زر «نشر الآن». المهام idempotent.
export async function handleScheduled(event: ScheduledController, env: Env): Promise<void> {
  if (event.cron === '0 18 * * 6') {
    try {
      await uploadWeeklyReport(env);
    } catch { /* تُتجاهل — لا تعطّل بقية المهام */ }
    return;
  }
  if (event.cron === '0 18 1 * *') {
    try {
      await uploadMonthlyReport(env);
    } catch { /* تُتجاهل — لا تعطّل بقية المهام */ }
    return;
  }
  await Promise.allSettled([
    refreshAllFeeds(env),
    pullAnalytics(env),
    syncComments(env),
    checkStaleContent(env),
    syncCardCommentsSafe(env),
  ]);
}
