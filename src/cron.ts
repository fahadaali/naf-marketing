import type { Env } from './types';
import { refreshAllFeeds } from './services/rss';
import { pullAnalytics } from './services/analytics';
import { uploadWeeklyReport, uploadMonthlyReport } from './services/report';
import { syncComments } from './services/commentsSync';
import { checkStaleContent } from './services/alerts';
import { syncCardCommentsSafe } from './services/basecampSync';
import { runDuePublishes } from './services/publish';

// معالج المهام المجدولة — مشغّل cron واحد فقط في wrangler.toml: "*/2 * * * *"
// (حساب Cloudflare محدود بـ ٥ مهام cron إجمالاً، فدمجنا كل شيء في مشغّل واحد ونتحكّم بالتوقيت هنا)
//   • كل دورة (كل دقيقتين): نشر المواعيد المستحقّة + مزامنة تعليقات بطاقات بيسكامب — شبه فورية.
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
  await Promise.allSettled([runDuePublishes(env), syncCardCommentsSafe(env)]);

  // المهام الساعية: عند بداية الساعة فقط (نافذة الدقيقتين 0..1) كي لا تتكرر كل دقيقتين
  if (minute < 2) {
    await Promise.allSettled([
      refreshAllFeeds(env),
      pullAnalytics(env),
      syncComments(env),
      checkStaleContent(env),
    ]);

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
