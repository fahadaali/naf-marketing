import type { Env } from '../types';
import type { PublishMedia } from '../adapters/provider';
import { getProvider } from '../adapters';
import { nowIso, htmlToText, extractMediaIds } from '../util';
import { notifyPublishFailed } from './notify';

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
      'SELECT body_override, media_asset_id FROM post_variants WHERE post_id = ? AND platform = ?',
    )
      .bind(job.post_id, job.platform)
      .first<{ body_override: string | null; media_asset_id: string | null }>();

    // محتوى المحرر HTML — نُجرّده إلى نص صالح للنشر (وإلا ظهرت الوسوم حرفياً في المنشور)
    const rawBody = variant?.body_override || job.body || '';
    const text = (htmlToText(rawBody) || job.title || '').trim();

    try {
      // الوسائط: نسخة المنصة إن حُدّدت، وإلا الوسائط المضمّنة في متن المنشور
      const assetIds = variant?.media_asset_id
        ? [variant.media_asset_id]
        : extractMediaIds(rawBody);
      const media = await loadMedia(env, assetIds);

      const result = await provider.publish({ platforms: [job.platform], text, media });
      await env.DB.prepare(
        "UPDATE schedules SET status = 'published', provider_post_id = ?, published_at = ?, error = NULL WHERE id = ?",
      )
        .bind(result.providerPostId, nowIso(), job.id)
        .run();
      published++;
    } catch (err: any) {
      const errMsg = String(err?.message || err);
      await env.DB.prepare("UPDATE schedules SET status = 'failed', error = ? WHERE id = ?")
        .bind(errMsg, job.id)
        .run();
      failed++;
      try { await notifyPublishFailed(env, job.post_id, job.platform, errMsg); } catch { /* لا تعطّل النشر */ }
    }
  }

  await markFullyPublishedPosts(env);
  return { published, failed };
}

// يقرأ بايتات الوسائط من R2 لتمريرها للمزوّد (مسار /api/media محمي بالمصادقة،
// فلا يستطيع المزوّد جلبه برابط). حد أقصى ٤ وسائط لكل منشور.
async function loadMedia(env: Env, assetIds: string[]): Promise<PublishMedia[]> {
  const out: PublishMedia[] = [];
  for (const id of assetIds.slice(0, 4)) {
    const asset = await env.DB.prepare(
      'SELECT r2_key, mime_type, filename FROM media_assets WHERE id = ?',
    )
      .bind(id)
      .first<{ r2_key: string; mime_type: string | null; filename: string | null }>();
    if (!asset) continue;
    const obj = await env.MEDIA.get(asset.r2_key);
    if (!obj) continue;
    out.push({
      data: await obj.arrayBuffer(),
      mimeType: asset.mime_type || 'application/octet-stream',
      filename: asset.filename || asset.r2_key.split('/').pop() || 'media',
    });
  }
  return out;
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

// النشر التلقائي للمواعيد المستحقّة — يُستدعى من Cron كل دورة.
// يلتقط ما حان موعده وما زال pending، والقفل الذرّي في publishJobs يمنع الازدواج.
// المنشورات الفاشلة لا تُعاد تلقائياً (تجنّباً لحلقة فشل متكررة) — تُعاد يدوياً بزر «نشر الآن».
export async function runDuePublishes(env: Env): Promise<{ published: number; failed: number }> {
  const { results } = await env.DB.prepare(
    `SELECT s.id, s.post_id, s.platform, p.body, p.title
     FROM schedules s JOIN content_posts p ON p.id = s.post_id
     WHERE s.status = 'pending' AND s.scheduled_at <= ?
     ORDER BY s.scheduled_at ASC
     LIMIT 20`,
  )
    .bind(nowIso())
    .all<Job>();

  if (!results.length) return { published: 0, failed: 0 };
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
