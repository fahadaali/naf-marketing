import type { Env } from '../types';
import type { PublishMedia, PublishingProvider } from '../adapters/provider';
import { getProvider } from '../adapters';
import { nowIso, htmlToText, extractMediaIds } from '../util';
import { notifyPublishFailed } from './notify';

// مُشغّل النشر — idempotent:
// 1) يلتقط كل جدول ويقفله بحالة 'processing' عبر تحديث شرطي (لا يُلتقط مرتين).
// 2) بعد النشر يخزّن provider_post_id ويضع الحالة 'published'.
// إعادة المحاولة لا تنشر نفس المنشور مرتين لأن الالتقاط يعتمد على انتقال pending -> processing.

type Job = { id: string; post_id: string; platform: string; body: string; title: string };

/* ═══ ما ترفضه المنصة قبل أن يصلها ═══

   منصاتٌ لا تقبل منشوراً بلا وسيط: إنستغرام وتيك توك وسناب شات صورةً أو
   مقطعاً، ويوتيوب مقطعاً لا غير. وكان المنشور يُرسل إليها كما هو، فيرجع
   الرفض من المزوّد بنصٍّ إنجليزي عامّ — أو لا يرجع إلا بعد دقائق. فيُقال
   هنا ما ينقص وأين يُضاف، قبل أن يُستهلك طلبٌ واحد. */
const NEEDS_MEDIA: Record<string, 'any' | 'video'> = {
  instagram: 'any',
  tiktok: 'any',
  snapchat: 'any',
  youtube: 'video',
};

/** سببُ رفض المنشور قبل إرساله — أو `null` إن كان صالحاً للإرسال. */
export function missingRequirement(platform: string, text: string, media: PublishMedia[]): string | null {
  const need = NEEDS_MEDIA[platform];
  if (need === 'video' && !media.some((m) => m.mimeType.startsWith('video/'))) {
    return 'هذه المنصة لا تقبل إلا فيديو. أضف مقطعاً إلى المحتوى أو إلى نسخة المنصة ثم أعد النشر';
  }
  if (need === 'any' && !media.length) {
    return 'هذه المنصة لا تقبل منشوراً بلا صورة أو فيديو. أضف وسيطاً إلى المحتوى أو إلى نسخة المنصة ثم أعد النشر';
  }
  if (!text && !media.length) return 'المنشور فارغ: لا نصّ فيه ولا وسيط. أضف محتوى ثم أعد النشر';
  return null;
}

async function failJob(env: Env, job: Job, errMsg: string): Promise<void> {
  await env.DB.prepare("UPDATE schedules SET status = 'failed', error = ?, published_at = NULL WHERE id = ?")
    .bind(errMsg, job.id)
    .run();
  try { await notifyPublishFailed(env, job.post_id, job.platform, errMsg); } catch { /* لا تعطّل النشر */ }
}

// المنطق المشترك لنشر مجموعة جداول (تُمرَّر مسبقاً)
async function publishJobs(
  env: Env,
  jobs: Job[],
): Promise<{ published: number; failed: number; pending: number }> {
  let published = 0;
  let failed = 0;
  let pending = 0;

  /* المزوّد يُطلب مرّةً للدفعة. وكان خطؤه — مفتاحٌ غائب أو مزوّدٌ غير مدعوم —
     يُرمى قبل التقاط أيّ جدول، فتبقى كلها «معلّقة» بلا سبب: في الدورة
     المجدولة يبتلعه `allSettled` فيصير كل موعدٍ «متأخراً» صامتاً. والآن
     يُكتب السبب على كل جدولٍ كما يُكتب أيّ رفض، فيُرى ويُصلح. */
  let provider: PublishingProvider | null = null;
  let providerError = '';
  try {
    provider = await getProvider(env);
  } catch (err: any) {
    providerError = String(err?.message || err);
  }

  for (const job of jobs) {
    /* قفل ذرّي: لا ينجح إلا لأول عامل يلتقط الوظيفة. ووقتُ الالتقاط في
       `published_at` ما دام الجدول «قيد النشر» — به يُعرف جدولٌ انقطع عامله
       قبل أن يكتب النتيجة (`reconcilePublishing`). */
    const lock = await env.DB.prepare(
      "UPDATE schedules SET status = 'processing', published_at = ?, error = NULL WHERE id = ? AND status IN ('pending','failed')",
    )
      .bind(nowIso(), job.id)
      .run();
    if (lock.meta.changes === 0) continue; // التقطها عامل آخر أو نُشرت مسبقاً

    try {
      if (!provider) throw new Error(providerError);

      const variant = await env.DB.prepare(
        'SELECT body_override, media_asset_id, first_comment FROM post_variants WHERE post_id = ? AND platform = ?',
      )
        .bind(job.post_id, job.platform)
        .first<{ body_override: string | null; media_asset_id: string | null; first_comment: string | null }>();

      // محتوى المحرر HTML — نُجرّده إلى نص صالح للنشر (وإلا ظهرت الوسوم حرفياً في المنشور)
      const rawBody = variant?.body_override || job.body || '';
      const text = (htmlToText(rawBody) || job.title || '').trim();

      // الوسائط: نسخة المنصة إن حُدّدت، وإلا الوسائط المضمّنة في متن المنشور
      const assetIds = variant?.media_asset_id
        ? [variant.media_asset_id]
        : extractMediaIds(rawBody);
      const media = await loadMedia(env, assetIds);

      const missing = missingRequirement(job.platform, text, media);
      if (missing) throw new Error(missing);

      const result = await provider.publish({
        platforms: [job.platform],
        text,
        media,
        firstComment: variant?.first_comment || undefined,
      });

      if (result.state === 'pending') {
        /* قبله المزوّد ولم يؤكّد نشره: يبقى «قيد النشر» ومعه معرّفه، ويُسأل
           عنه في الدورات التالية حتى يُنشر أو يُرفض. */
        await env.DB.prepare('UPDATE schedules SET provider_post_id = ? WHERE id = ?')
          .bind(result.providerPostId, job.id)
          .run();
        pending++;
        continue;
      }
      await env.DB.prepare(
        "UPDATE schedules SET status = 'published', provider_post_id = ?, published_at = ?, error = NULL WHERE id = ?",
      )
        .bind(result.providerPostId, nowIso(), job.id)
        .run();
      published++;
    } catch (err: any) {
      await failJob(env, job, String(err?.message || err));
      failed++;
    }
  }

  await markFullyPublishedPosts(env);
  return { published, failed, pending };
}

// يجهّز الوسائط من R2 لتمريرها للمزوّد (مسار /api/media محمي بالمصادقة،
// فلا يستطيع المزوّد جلبه برابط). حد أقصى ٤ وسائط لكل منشور.
//
// تُفتح تدفّقاً عند الرفع لا تُقرأ هنا: ما يُقرأ كاملاً يبقى في ذاكرة العامل
// حتى ينتهي النشر، وأربعة مقاطع كبيرة تتجاوزها.
//
// ووسيطٌ في المحتوى لا يوجد سجلُّه أو ملفُّه كان يُتخطّى صامتاً، فيُنشر
// المنشور بلا صورته — أو يُرفض في منصةٍ لا تقبله بلا وسيط بسببٍ لا يدلّ عليه.
async function loadMedia(env: Env, assetIds: string[]): Promise<PublishMedia[]> {
  const out: PublishMedia[] = [];
  for (const id of assetIds.slice(0, 4)) {
    const asset = await env.DB.prepare(
      'SELECT r2_key, mime_type, filename FROM media_assets WHERE id = ?',
    )
      .bind(id)
      .first<{ r2_key: string; mime_type: string | null; filename: string | null }>();
    const head = asset ? await env.MEDIA.head(asset.r2_key) : null;
    if (!asset || !head) {
      throw new Error('وسيطٌ في المحتوى لم يعد موجوداً في المكتبة. احذفه من المحتوى أو أعد رفعه ثم أعد النشر');
    }
    const key = asset.r2_key;
    out.push({
      open: async () => (await env.MEDIA.get(key))?.body ?? null,
      size: head.size,
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
export async function runDuePublishes(env: Env): Promise<{ published: number; failed: number; pending: number }> {
  const { results } = await env.DB.prepare(
    `SELECT s.id, s.post_id, s.platform, p.body, p.title
     FROM schedules s JOIN content_posts p ON p.id = s.post_id
     WHERE s.status = 'pending' AND s.scheduled_at <= ?
     ORDER BY s.scheduled_at ASC
     LIMIT 20`,
  )
    .bind(nowIso())
    .all<Job>();

  if (!results.length) return { published: 0, failed: 0, pending: 0 };
  return publishJobs(env, results);
}

/** سببُ فشل كل منصةٍ فشلت لهذا المنشور — يُعرض لمن ضغط «نشر الآن». */
export type PublishError = { platform: string; error: string };

// النشر الفوري لكل جداول منشور معيّن — يتجاوز الموعد المحدد (زر «نشر الآن»).
export async function publishPostNow(
  env: Env,
  postId: string,
): Promise<{ published: number; failed: number; pending: number; early: boolean; errors: PublishError[] }> {
  const { results } = await env.DB.prepare(
    `SELECT s.id, s.post_id, s.platform, p.body, p.title
     FROM schedules s JOIN content_posts p ON p.id = s.post_id
     WHERE s.post_id = ? AND s.status IN ('pending','failed')
     ORDER BY s.scheduled_at ASC`,
  )
    .bind(postId)
    .all<Job>();

  // هل يوجد جدول لم يحن موعده بعد؟ (لغرض رسالة التنبيه)
  const earliest = await env.DB.prepare(
    "SELECT MIN(scheduled_at) AS mn FROM schedules WHERE post_id = ? AND status IN ('pending','failed')",
  )
    .bind(postId)
    .first<{ mn: string | null }>();
  const early = !!earliest?.mn && new Date(earliest.mn).getTime() > Date.now();

  const result = await publishJobs(env, results);
  const failedRows = await env.DB.prepare(
    "SELECT platform, error FROM schedules WHERE post_id = ? AND status = 'failed' ORDER BY scheduled_at ASC",
  )
    .bind(postId)
    .all<{ platform: string; error: string | null }>();
  const errors = (failedRows.results || []).map((r) => ({ platform: r.platform, error: r.error || '' }));
  return { ...result, early, errors };
}

/* ═══ ما بقي «قيد النشر» ═══

   جدولٌ «قيد النشر» واحدٌ من اثنين:

   ١) قبله المزوّد ولم يؤكّد نشره — معه `provider_post_id`. يُسأل المزوّد عنه
      حتى يُنشر أو يُرفض. وما لم يُحسم في ساعةٍ يُعدّ فاشلاً بسببٍ يقول ذلك:
      لا يبقى بلا نهاية، ولا يُعاد نشرُه آلياً لأن المزوّد قد ينشره بعد.
   ٢) انقطع عاملُه قبل أن يكتب النتيجة — بلا معرّف، ووقتُ التقاطه قديم.
      وكان يبقى «قيد النشر» إلى الأبد: لا تلتقطه الدورة لأنها تقرأ المعلّق
      وحده، ولا «نشر الآن» لأنه يقرأ المعلّق والفاشل، ولا يُلغى لأن الإلغاء
      لهما كذلك. فيُعدّ فاشلاً بسببٍ يطلب التحقق من الحساب قبل الإعادة: قد
      يكون الطلب وصل المزوّد قبل الانقطاع. */

/** مهلةُ عاملٍ انقطع — أطول من أقصى ما تعيشه دورةٌ مجدولة. */
export const INTERRUPTED_AFTER_MS = 20 * 60_000;
/** مهلةُ تأكيد المزوّد. */
export const CONFIRM_WITHIN_MS = 60 * 60_000;

const INTERRUPTED_ERROR =
  'انقطع النشر قبل أن يردّ المزوّد. تحقّق من الحساب على المنصة قبل إعادة النشر، فقد يكون المنشور وصلها';
const UNCONFIRMED_ERROR =
  'لم يؤكّد المزوّد النشر خلال ساعة. تحقّق من الحساب على المنصة قبل إعادة النشر، فقد يكون المنشور وصلها';

export async function reconcilePublishing(env: Env): Promise<{ published: number; failed: number }> {
  let published = 0;
  let failed = 0;
  const now = Date.now();
  const interruptedBefore = new Date(now - INTERRUPTED_AFTER_MS).toISOString().replace(/\.\d{3}Z$/, 'Z');

  const stuck = await env.DB.prepare(
    `SELECT s.id, s.post_id, s.platform FROM schedules s
     WHERE s.status = 'processing' AND (s.provider_post_id IS NULL OR s.provider_post_id = '')
       AND (s.published_at IS NULL OR s.published_at < ?)
     LIMIT 50`,
  )
    .bind(interruptedBefore)
    .all<{ id: string; post_id: string; platform: string }>();
  for (const row of stuck.results || []) {
    const r = await env.DB.prepare(
      "UPDATE schedules SET status = 'failed', error = ?, published_at = NULL WHERE id = ? AND status = 'processing'",
    )
      .bind(INTERRUPTED_ERROR, row.id)
      .run();
    if (r.meta.changes) {
      failed++;
      try { await notifyPublishFailed(env, row.post_id, row.platform, INTERRUPTED_ERROR); } catch { /* لا تعطّل */ }
    }
  }

  const waiting = await env.DB.prepare(
    `SELECT id, post_id, platform, provider_post_id, published_at FROM schedules
     WHERE status = 'processing' AND provider_post_id IS NOT NULL AND provider_post_id != ''
     ORDER BY published_at ASC
     LIMIT 10`,
  ).all<{ id: string; post_id: string; platform: string; provider_post_id: string; published_at: string | null }>();

  if (waiting.results?.length) {
    let provider: PublishingProvider | null = null;
    try { provider = await getProvider(env); } catch { /* يُعاد في الدورة التالية */ }
    for (const row of provider ? waiting.results : []) {
      let check: Awaited<ReturnType<NonNullable<PublishingProvider['getPublishStatus']>>> = null;
      try {
        check = provider!.getPublishStatus ? await provider!.getPublishStatus(row.provider_post_id) : null;
      } catch {
        continue; // عطلٌ عابر — يُسأل في الدورة التالية
      }
      const sentAt = row.published_at ? Date.parse(row.published_at) : 0;
      const expired = !sentAt || now - sentAt > CONFIRM_WITHIN_MS;
      if (check?.state === 'pending' && !expired) continue;

      if (check?.state === 'failed' || check?.state === 'pending') {
        const msg = check.state === 'failed'
          ? `فشل النشر عبر المزوّد: ${check.error || 'رفضت المنصة المنشور'}`
          : UNCONFIRMED_ERROR;
        await failJob(env, { id: row.id, post_id: row.post_id, platform: row.platform, body: '', title: '' }, msg);
        failed++;
        continue;
      }
      // نُشر — أو لا يُعلن المزوّد حالاً يُقرأ فيُعدّ منشوراً كما كان. ووقتُ
      // النشر وقتُ الإرسال المحفوظ لا وقتُ هذا السؤال.
      await env.DB.prepare(
        "UPDATE schedules SET status = 'published', error = NULL WHERE id = ? AND status = 'processing'",
      )
        .bind(row.id)
        .run();
      published++;
    }
  }

  if (published) await markFullyPublishedPosts(env);
  return { published, failed };
}
