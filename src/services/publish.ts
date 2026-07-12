import type { Env } from '../types';
import { getProvider } from '../adapters';
import { nowIso } from '../util';

// مُشغّل النشر — idempotent:
// 1) يلتقط كل جدول ويقفله بحالة 'processing' عبر تحديث شرطي (لا يُلتقط مرتين).
// 2) بعد النشر يخزّن provider_post_id ويضع الحالة 'published'.
// إعادة المحاولة لا تنشر نفس المنشور مرتين لأن الالتقاط يعتمد على انتقال pending -> processing.

type Job = { id: string; post_id: string; platform: string; body: string; title: string };

// المنطق المشترك لنشر مجموعة جداول (تُمرَّر مسبقاً)
async function publishJobs(env: Env, jobs: Job[]): Promise<{ published: number; failed: number }> {
  let published = 0;
  let failed = 0;
  const provider = await getProvider(env);

  for (const job of jobs) {
    // قفل ذرّي: لا ينجح إلا لأول عامل يلتقط الوظيفة
    const lock = await env.DB.prepare(
      "UPDATE schedules SET status = 'processing' WHERE id = ? AND status IN ('pending','failed')",
    )
      .bind(job.id)
      .run();
    if (lock.meta.changes === 0) continue; // التقطها عامل آخر أو نُشرت مسبقاً

    const variant = await env.DB.prepare(
      'SELECT body_override FROM post_variants WHERE post_id = ? AND platform = ?',
    )
      .bind(job.post_id, job.platform)
      .first<{ body_override: string | null }>();

    const text = (variant?.body_override || job.body || job.title || '').trim();

    try {
      const result = await provider.publish({ platforms: [job.platform], text });
      await env.DB.prepare(
        "UPDATE schedules SET status = 'published', provider_post_id = ?, published_at = ?, error = NULL WHERE id = ?",
      )
        .bind(result.providerPostId, nowIso(), job.id)
        .run();
      published++;
    } catch (err: any) {
      await env.DB.prepare("UPDATE schedules SET status = 'failed', error = ? WHERE id = ?")
        .bind(String(err?.message || err), job.id)
        .run();
      failed++;
    }
  }

  await markFullyPublishedPosts(env);
  return { published, failed };
}

// يحوّل المنشور إلى published عندما تُنشر كل جداوله
async function markFullyPublishedPosts(env: Env): Promise<void> {
  await env.DB.prepare(
    `UPDATE content_posts SET status = 'published', updated_at = ?
     WHERE status = 'scheduled'
       AND id IN (SELECT post_id FROM schedules)
       AND id NOT IN (SELECT post_id FROM schedules WHERE status != 'published')`,
  )
    .bind(nowIso())
    .run();
}

// النشر المجدول المستحق فقط (يُستدعى من Cron والتشغيل اليدوي)
export async function runDueSchedules(env: Env): Promise<{ published: number; failed: number }> {
  const now = nowIso();
  const { results } = await env.DB.prepare(
    `SELECT s.id, s.post_id, s.platform, p.body, p.title
     FROM schedules s JOIN content_posts p ON p.id = s.post_id
     WHERE s.status IN ('pending','failed') AND s.scheduled_at <= ?
     ORDER BY s.scheduled_at ASC
     LIMIT 25`,
  )
    .bind(now)
    .all<Job>();
  return publishJobs(env, results);
}

// النشر الفوري لكل جداول منشور معيّن — يتجاوز الموعد المحدد (زر «نشر الآن»).
export async function publishPostNow(
  env: Env,
  postId: string,
): Promise<{ published: number; failed: number; early: boolean }> {
  const { results } = await env.DB.prepare(
    `SELECT s.id, s.post_id, s.platform, p.body, p.title
     FROM schedules s JOIN content_posts p ON p.id = s.post_id
     WHERE s.post_id = ? AND s.status IN ('pending','failed')
     ORDER BY s.scheduled_at ASC`,
  )
    .bind(postId)
    .all<Job & { scheduled_at?: string }>();

  // هل يوجد جدول لم يحن موعده بعد؟ (لغرض رسالة التنبيه)
  const earliest = await env.DB.prepare(
    "SELECT MIN(scheduled_at) AS mn FROM schedules WHERE post_id = ? AND status IN ('pending','failed')",
  )
    .bind(postId)
    .first<{ mn: string | null }>();
  const early = !!earliest?.mn && new Date(earliest.mn).getTime() > Date.now();

  const result = await publishJobs(env, results);
  return { ...result, early };
}
