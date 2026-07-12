import type { Env } from '../types';
import { getProvider } from '../adapters';
import { nowIso } from '../util';

// مُشغّل النشر المجدول — idempotent:
// 1) يلتقط الجداول المستحقة ويقفلها بحالة 'processing' عبر تحديث شرطي (لا تُلتقط مرتين).
// 2) بعد النشر يخزّن provider_post_id ويضع الحالة 'published'.
// إعادة المحاولة لا تنشر نفس المنشور مرتين لأن الالتقاط يعتمد على انتقال pending -> processing.

export async function runDueSchedules(env: Env): Promise<{ published: number; failed: number }> {
  const now = nowIso();
  const { results: due } = await env.DB.prepare(
    `SELECT s.id, s.post_id, s.platform, p.body, p.title
     FROM schedules s JOIN content_posts p ON p.id = s.post_id
     WHERE s.status = 'pending' AND s.scheduled_at <= ?
     ORDER BY s.scheduled_at ASC
     LIMIT 25`,
  )
    .bind(now)
    .all<{ id: string; post_id: string; platform: string; body: string; title: string }>();

  let published = 0;
  let failed = 0;
  const provider = await getProvider(env);

  for (const job of due) {
    // قفل ذرّي: لا ينجح إلا لأول عامل يلتقط الوظيفة
    const lock = await env.DB.prepare(
      "UPDATE schedules SET status = 'processing' WHERE id = ? AND status = 'pending'",
    )
      .bind(job.id)
      .run();
    if (lock.meta.changes === 0) continue; // التقطها عامل آخر

    // نسخة المنصة إن وُجدت
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
      // في حال الفشل نعيدها إلى pending كي تُعاد المحاولة في الدورة التالية
      await env.DB.prepare("UPDATE schedules SET status = 'pending', error = ? WHERE id = ?")
        .bind(String(err?.message || err), job.id)
        .run();
      failed++;
    }
  }

  // تحديث حالة المنشور إلى published عندما تُنشر كل جداوله
  await env.DB.prepare(
    `UPDATE content_posts SET status = 'published', updated_at = ?
     WHERE status = 'scheduled'
       AND id IN (SELECT post_id FROM schedules)
       AND id NOT IN (SELECT post_id FROM schedules WHERE status != 'published')`,
  )
    .bind(now)
    .run();

  return { published, failed };
}
