import type { Env } from './types';
import { refreshAllFeeds } from './services/rss';
import { pullAnalytics } from './services/analytics';

// معالج المهام المجدولة. cron المُعرّفة في wrangler.toml:
//   "17 * * * *"  → جلب RSS + سحب التحليلات (كل ساعة)
// النشر لم يعد مجدولاً تلقائياً — يتم يدوياً عبر زر «نشر الآن».
// المهام idempotent: إعادة التشغيل لا تُكرّر الأخبار.
export async function handleScheduled(_event: ScheduledController, env: Env): Promise<void> {
  await Promise.allSettled([refreshAllFeeds(env), pullAnalytics(env)]);
}
