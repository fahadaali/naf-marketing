import type { Env } from './types';
import { runDueSchedules } from './services/publish';
import { refreshAllFeeds } from './services/rss';
import { pullAnalytics } from './services/analytics';

// معالج المهام المجدولة. cron المُعرّفة في wrangler.toml:
//   "*/5 * * * *"  → النشر المجدول المستحق (كل 5 دقائق)
//   "17 * * * *"   → جلب RSS + سحب التحليلات (كل ساعة)
// كل المهام idempotent: إعادة التشغيل لا تُكرّر النشر ولا الأخبار.
export async function handleScheduled(event: ScheduledController, env: Env): Promise<void> {
  const cron = event.cron;

  if (cron === '*/5 * * * *') {
    await runDueSchedules(env);
    return;
  }

  if (cron === '17 * * * *') {
    await Promise.allSettled([refreshAllFeeds(env), pullAnalytics(env)]);
    return;
  }

  // احتياط: شغّل النشر المستحق في أي حدث آخر
  await runDueSchedules(env);
}
