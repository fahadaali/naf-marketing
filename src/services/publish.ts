import type { Env } from '../types';
import { PublishUncertain, keepDescription, type PublishInput, type PublishMedia, type PublishingProvider } from '../adapters/provider';
import { getProvider } from '../adapters';
import { nowIso, htmlToText, extractMediaIds, newId } from '../util';
import { notifyPublishFailed } from './notify';
import { adaptImage, frameImage, imageDims, platformMediaFilter, videoIssues } from './mediaSpecs';
import { optionIssues, parseOptions } from './publishOptions';
import { ALREADY_RETRIED_ERROR } from '../adapters/ayrshare';
import { customPlatformLabels, platformName } from '../platformLabels';

// مُشغّل النشر — idempotent:
// 1) يلتقط كل جدول ويقفله بحالة 'processing' عبر تحديث شرطي (لا يُلتقط مرتين).
// 2) بعد النشر يخزّن provider_post_id ويضع الحالة 'published'.
// إعادة المحاولة لا تنشر نفس المنشور مرتين لأن الالتقاط يعتمد على انتقال pending -> processing.
// 3) ومحاولةٌ لا تُعرف نتيجتها تُعاد بمفتاحها نفسه (`publish_key`)، فيرفضها المزوّد إن كانت الأولى وصلته.

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
  /* تيك توك: منشور الصور صورتان فأكثر — «photo posts require at least 2
     images» كما ردّه تحقّق المزوّد. والمقطع الواحد يكفي. */
  if (platform === 'tiktok' && media.length && media.every((m) => m.mimeType.startsWith('image/')) && media.length < 2) {
    /* والصورة الواحدة يصنع منها المحرر مقطعاً حين يُضغط «جدولة النشر» أو
       «نشر الآن» (`web/src/tiktokVideo.ts`) — فلا يصل هنا إلا ما جُدول من
       غيره، أو تغيّرت صورته بعد التوليد. */
    return 'تيك توك لا يقبل منشور صورٍ بأقلّ من صورتين. افتح المحتوى في المحرر واضغط «نشر الآن» ليُجهَّز من الصورة مقطع، أو أضف صورة ثانية';
  }
  if (!text && !media.length) return 'المنشور فارغ: لا نصّ فيه ولا وسيط. أضف محتوى ثم أعد النشر';
  return null;
}

/** ما سترفضه المنصة من المقاطع — مدّةً أو حجماً (`mediaSpecs.ts`). */
export function mediaIssues(platform: string, media: PublishMedia[]): string[] {
  return media
    .filter((m) => m.mimeType.startsWith('video/'))
    .flatMap((m) => videoIssues(platform, m));
}

/** ما يُرسل للمزوّد لمنصةٍ واحدة — يُبنى هكذا عند النشر وعند الفحص المسبق.
    والفحص المسبق لا يكيّف الصور (`adapt: false`): يكفيه أن يعرف ما سيُرسل. */
async function prepareInput(env: Env, job: Job, opts: { adapt?: boolean } = {}): Promise<PublishInput> {
  const variant = await env.DB.prepare(
    `SELECT body_override, media_asset_id, first_comment, generated_media_id, generated_from_id, options_json
     FROM post_variants WHERE post_id = ? AND platform = ?`,
  )
    .bind(job.post_id, job.platform)
    .first<{
      body_override: string | null; media_asset_id: string | null; first_comment: string | null;
      generated_media_id: string | null; generated_from_id: string | null; options_json: string | null;
    }>();
  const options = parseOptions(variant?.options_json);

  // محتوى المحرر HTML — نُجرّده إلى نص صالح للنشر (وإلا ظهرت الوسوم حرفياً في المنشور)
  const rawBody = variant?.body_override || job.body || '';
  const text = (htmlToText(rawBody) || job.title || '').trim();

  // الوسائط: نسخة المنصة إن حُدّدت، وإلا الوسائط المضمّنة في متن المنشور — بما تقبله المنصة منها
  const assetIds = variant?.media_asset_id ? [variant.media_asset_id] : extractMediaIds(rawBody);
  let media = platformMediaFilter(job.platform, await loadMedia(env, assetIds));
  /* مقطعٌ وُلّد من صورة المنصة الواحدة (تيك توك) يحلّ محلّها — ما دامت هي
     الصورة نفسها. فإن تغيّرت بعده أُرسلت الصورة، فيقول `missingRequirement`
     ما ينقص بدل أن يُنشر مقطعٌ من صورةٍ قديمة. والمقطع مولَّدٌ إن كانت صورته
     مولَّدة: الوسم للمحتوى لا للملف. */
  if (variant?.generated_media_id && media.length === 1 && media[0].id === variant.generated_from_id) {
    const [image] = media;
    const [clip] = await loadMedia(env, [variant.generated_media_id]);
    media = [image.aiGenerated && !clip.aiGenerated ? { ...clip, aiGenerated: true } : clip];
  }

  /* الصورة على مقاس المنصة: كما هي إن قبلتها، وإلا في إطارٍ بمقاسها
     (`adaptImage`). وبلا ربط `IMAGES` تُرسل كما هي، كما كانت. */
  if (opts.adapt && env.IMAGES) {
    const adapted: PublishMedia[] = [];
    for (const m of media) adapted.push(keepDescription(m, await adaptImage(env.IMAGES, job.platform, m)));
    media = adapted;
  }

  // ملف الترجمة من مكتبة الوسائط — وما حُذف منها يُنشر المقطع بلا ترجمة كما يُنشر بلا غلاف
  const subtitle = options.subtitle
    ? (await loadMedia(env, [options.subtitle.mediaId]).catch(() => [] as PublishMedia[]))[0]
    : undefined;

  return {
    platforms: [job.platform],
    text,
    title: job.title || undefined,
    media,
    firstComment: variant?.first_comment || undefined,
    cover: opts.adapt ? await loadCover(env, job.post_id, media) : undefined,
    ...(Object.keys(options).length ? { options } : {}),
    ...(subtitle ? { subtitle } : {}),
  };
}

/* ═══ غلاف المقطع ═══

   صورةٌ يختارها الفريق للمقطع (`video_cover_id`)، تظهر قبل التشغيل حيث
   تقبلها المنصة. وتُوضع في إطارٍ بأبعاد المقطع نفسه — لينكدإن يشترطها،
   وفي غيره لا يُقصّ الغلاف عند العرض. ولا غلاف إلا لمقطعٍ واحد. */
const COVER_MAX_SIDE = 1920;

async function loadCover(env: Env, postId: string, media: PublishMedia[]): Promise<PublishMedia | undefined> {
  const video = media.length === 1 && media[0].mimeType.startsWith('video/') ? media[0] : null;
  if (!video) return undefined;
  const row = await env.DB.prepare('SELECT video_cover_id FROM content_posts WHERE id = ?')
    .bind(postId)
    .first<{ video_cover_id: string | null }>();
  if (!row?.video_cover_id) return undefined;
  // غلافٌ حُذف من المكتبة لا يمنع نشر المقطع — يُنشر بلا غلاف
  const [cover] = await loadMedia(env, [row.video_cover_id]).catch(() => [] as PublishMedia[]);
  if (!cover || !cover.mimeType.startsWith('image/')) return undefined;
  if (!env.IMAGES || !video.width || !video.height) return cover;
  const scale = Math.min(1, COVER_MAX_SIDE / Math.max(video.width, video.height));
  const frame: [number, number] = [Math.round(video.width * scale), Math.round(video.height * scale)];
  const dims = await imageDims(env.IMAGES, cover);
  if (!dims) return cover;
  return frameImage(env.IMAGES, cover, dims, frame, 'cover');
}

function extraIds(ids?: string[]): string | null {
  return ids?.length ? JSON.stringify(ids) : null;
}

/**
 * يكتب الفشل على الموعد ويُشعر به. ومفتاحُ المحاولة يُمحى — الرفض نتيجةٌ
 * معروفة، والإعادة محاولةٌ جديدة — إلا ما لا تُعرف نتيجته (`keepKey`): يبقى
 * مفتاحه فتُرفض إعادته لدى المزوّد إن كان المنشور وصله.
 */
/** `retryId`: معرّف المنشور لدى المزوّد إن كان فشله يُعاد — به تُعاد المحاولة على المنشور نفسه (0048). */
async function failJob(env: Env, job: Job, errMsg: string, opts: { keepKey?: boolean; retryId?: string | null } = {}): Promise<void> {
  await env.DB.prepare(
    `UPDATE schedules SET status = 'failed', error = ?, published_at = NULL,
            publish_key = CASE WHEN ? = 1 THEN publish_key ELSE NULL END,
            retry_id = ?
     WHERE id = ?`,
  )
    .bind(errMsg, opts.keepKey ? 1 : 0, opts.retryId ?? null, job.id)
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
       قبل أن يكتب النتيجة (`reconcilePublishing`).

       ومفتاحُ المحاولة يُولد هنا إن لم يبقَ للموعد مفتاحٌ من محاولةٍ لا تُعرف
       نتيجتها — فإن بقي أُرسل هو نفسه (`publish_key` في 0040). */
    const lock = await env.DB.prepare(
      `UPDATE schedules SET status = 'processing', published_at = ?, error = NULL,
              publish_key = COALESCE(publish_key, ?)
       WHERE id = ? AND status IN ('pending','failed')`,
    )
      .bind(nowIso(), newId('pub'), job.id)
      .run();
    if (lock.meta.changes === 0) continue; // التقطها عامل آخر أو نُشرت مسبقاً

    const key = await env.DB.prepare('SELECT publish_key, retry_id, scheduled_at FROM schedules WHERE id = ?')
      .bind(job.id)
      .first<{ publish_key: string | null; retry_id: string | null; scheduled_at: string | null }>();

    /* فشلٌ يُعاد (مهلة المنصة انتهت): يُعاد المنشور نفسه لدى المزوّد لا منشورٌ
       جديد — فإن كانت المنصة استلمته لم يتكرّر. ويُسأل سجلّها أولاً: ما ظهر فيه
       منشورٌ لا يُعاد. وما أُعيد قبلُ يُفلت معرّفه فتُرسله المحاولة التالية جديداً. */
    if (key?.retry_id && provider?.retryPost) {
      const retryId = key.retry_id;
      try {
        const input = await prepareInput(env, job);
        const seen = provider.findOnPlatform && key.scheduled_at
          ? await provider.findOnPlatform({ platform: job.platform, text: input.text, since: key.scheduled_at }).catch(() => null)
          : null;
        if (seen) {
          await env.DB.prepare(
            `UPDATE schedules SET status = 'published', provider_post_id = ?, published_at = ?, error = NULL,
                    publish_key = NULL, retry_id = NULL
             WHERE id = ?`,
          )
            .bind(retryId, seen, job.id)
            .run();
          published++;
          continue;
        }
        const result = await provider.retryPost(retryId);
        await env.DB.prepare('UPDATE schedules SET provider_post_id = ?, retry_id = NULL WHERE id = ?')
          .bind(result.providerPostId, job.id)
          .run();
        pending++;
      } catch (err: any) {
        const msg = String(err?.message || err);
        await failJob(env, job, msg, { keepKey: err instanceof PublishUncertain, retryId: msg === ALREADY_RETRIED_ERROR ? null : retryId });
        failed++;
      }
      continue;
    }

    try {
      if (!provider) throw new Error(providerError);

      const input = { ...(await prepareInput(env, job, { adapt: true })), idempotencyKey: key?.publish_key || undefined };
      const missing = missingRequirement(job.platform, input.text, input.media || []);
      if (missing) throw new Error(missing);
      const issues = [...mediaIssues(job.platform, input.media || []), ...optionIssues(job.platform, input.options || {}, input.media || [])];
      if (issues.length) throw new Error(issues.join(' · '));

      const result = await provider.publish(input);

      if (result.state === 'pending') {
        /* قبله المزوّد ولم يؤكّد نشره: يبقى «قيد النشر» ومعه معرّفه، ويُسأل
           عنه في الدورات التالية حتى يُنشر أو يُرفض. */
        await env.DB.prepare('UPDATE schedules SET provider_post_id = ?, extra_provider_ids = ? WHERE id = ?')
          .bind(result.providerPostId, extraIds(result.extraIds), job.id)
          .run();
        pending++;
        continue;
      }
      // `note`: نشرةٌ من نشرات الموعد لم تُنشر وغيرها نُشر (سناب) — يُكتب تحته
      await env.DB.prepare(
        `UPDATE schedules SET status = 'published', provider_post_id = ?, published_at = ?, error = ?,
                extra_provider_ids = ?, publish_key = NULL, retry_id = NULL
         WHERE id = ?`,
      )
        .bind(result.providerPostId, nowIso(), result.note || null, extraIds(result.extraIds), job.id)
        .run();
      published++;
    } catch (err: any) {
      await failJob(env, job, String(err?.message || err), { keepKey: err instanceof PublishUncertain });
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
export async function loadMedia(env: Env, assetIds: string[]): Promise<PublishMedia[]> {
  const out: PublishMedia[] = [];
  for (const id of assetIds.slice(0, 4)) {
    const asset = await env.DB.prepare(
      'SELECT r2_key, mime_type, filename, width, height, duration_ms, alt_text, ai_generated FROM media_assets WHERE id = ?',
    )
      .bind(id)
      .first<{
        r2_key: string; mime_type: string | null; filename: string | null;
        width: number | null; height: number | null; duration_ms: number | null;
        alt_text: string | null; ai_generated: number | null;
      }>();
    const head = asset ? await env.MEDIA.head(asset.r2_key) : null;
    if (!asset || !head) {
      throw new Error('وسيطٌ في المحتوى لم يعد موجوداً في المكتبة. احذفه من المحتوى أو أعد رفعه ثم أعد النشر');
    }
    const key = asset.r2_key;
    out.push({
      id,
      open: async () => (await env.MEDIA.get(key))?.body ?? null,
      size: head.size,
      mimeType: asset.mime_type || 'application/octet-stream',
      filename: asset.filename || asset.r2_key.split('/').pop() || 'media',
      width: asset.width,
      height: asset.height,
      duration_ms: asset.duration_ms,
      alt: asset.alt_text?.trim() || null,
      aiGenerated: !!asset.ai_generated,
    });
  }
  return out;
}

/* ═══ حالة المنشور بعد إلغاء الجدولة ═══

   كان إلغاءُ موعد المنصة المتعثّرة يحذف الصفّ ولا يمسّ المنشور، فيبقى «مجدولاً»
   ويظهر «منشوراً جزئياً» وقد نُشر على كل ما بقي له — ولا يصير «منشوراً» إلا
   صدفةً حين تجري دورة نشرٍ بعدها. فيُسوّى هنا عند الإلغاء:
   - مجدولٌ لم يبقَ له موعدٌ ينتظر وله ما نُشر ← «منشور».
   - مجدولٌ لم يبقَ له موعدٌ أصلاً ← «معتمد»، يُجدوَل من جديد متى شاء الفريق.
   ويُكتب الانتقال في `approvals` كأيّ انتقال (به يُقاس زمن النشر). */
export async function settlePostStatus(env: Env, postId: string, actorId: string | null): Promise<string | null> {
  const post = await env.DB.prepare('SELECT status FROM content_posts WHERE id = ?').bind(postId).first<{ status: string }>();
  if (!post) return null;
  if (post.status !== 'scheduled') return post.status;
  const counts = await env.DB.prepare(
    `SELECT SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) AS done,
            SUM(CASE WHEN status <> 'published' THEN 1 ELSE 0 END) AS open
     FROM schedules WHERE post_id = ?`,
  ).bind(postId).first<{ done: number | null; open: number | null }>();
  if (Number(counts?.open ?? 0) > 0) return post.status;
  const to = Number(counts?.done ?? 0) > 0 ? 'published' : 'approved';
  const moved = await env.DB.prepare(
    "UPDATE content_posts SET status = ?, updated_at = ? WHERE id = ? AND status = 'scheduled'",
  ).bind(to, nowIso(), postId).run();
  if (!moved.meta?.changes) return post.status;
  await env.DB.prepare(
    `INSERT INTO approvals (id, post_id, from_status, to_status, actor_id, note) VALUES (?, ?, 'scheduled', ?, ?, ?)`,
  ).bind(newId('appr'), postId, to, actorId, 'إلغاء الجدولة').run();
  return to;
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
/** `platforms`: منصاتٌ بعينها — «نشر الآن» لمنصةٍ متعثّرة لا يُعجّل مواعيد البقية. */
export async function publishPostNow(
  env: Env,
  postId: string,
  platforms?: string[],
): Promise<{ published: number; failed: number; pending: number; early: boolean; errors: PublishError[] }> {
  const only = platforms?.length ? ` AND s.platform IN (${platforms.map(() => '?').join(',')})` : '';
  const { results } = await env.DB.prepare(
    `SELECT s.id, s.post_id, s.platform, p.body, p.title
     FROM schedules s JOIN content_posts p ON p.id = s.post_id
     WHERE s.post_id = ? AND s.status IN ('pending','failed')${only}
     ORDER BY s.scheduled_at ASC`,
  )
    .bind(postId, ...(platforms ?? []))
    .all<Job>();

  // هل يوجد جدول لم يحن موعده بعد؟ (لغرض رسالة التنبيه)
  const earliest = await env.DB.prepare(
    `SELECT MIN(s.scheduled_at) AS mn FROM schedules s WHERE s.post_id = ? AND s.status IN ('pending','failed')${only}`,
  )
    .bind(postId, ...(platforms ?? []))
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
/** مهلةُ المنصة انتهت قبل أن تردّ — لا رفضٌ للمحتوى. والسببُ كما قاله المزوّد بعده. */
function timedOutError(platform: string, reason?: string): string {
  return `انتهت مهلة ${platform} قبل أن تردّ، ولم يُرفض المحتوى. اضغط «نشر الآن» لإعادة المحاولة على المنشور نفسه فلا يتكرّر${reason ? ` (${reason})` : ''}`;
}
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
    // ومفتاح محاولته يبقى: إن كان المنشور وصل المزوّد رُفضت إعادته ولم يتكرّر
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

  // والنصّ كما أُرسل (نسخة المنصة أو المتن) — به يُطابَق في سجلّ المنصة حين يطول الانتظار
  const waiting = await env.DB.prepare(
    `SELECT s.id, s.post_id, s.platform, s.provider_post_id, s.published_at,
            COALESCE(NULLIF(v.body_override, ''), p.body) AS body, p.title
     FROM schedules s
     JOIN content_posts p ON p.id = s.post_id
     LEFT JOIN post_variants v ON v.post_id = s.post_id AND v.platform = s.platform
     WHERE s.status = 'processing' AND s.provider_post_id IS NOT NULL AND s.provider_post_id != ''
     ORDER BY s.published_at ASC
     LIMIT 10`,
  ).all<{
    id: string; post_id: string; platform: string; provider_post_id: string; published_at: string | null;
    body: string | null; title: string | null;
  }>();

  if (waiting.results?.length) {
    let provider: PublishingProvider | null = null;
    try { provider = await getProvider(env); } catch { /* يُعاد في الدورة التالية */ }
    for (const row of provider ? waiting.results : []) {
      let check: Awaited<ReturnType<NonNullable<PublishingProvider['getPublishStatus']>>> = null;
      try {
        const text = (htmlToText(row.body || '') || row.title || '').trim();
        check = provider!.getPublishStatus
          ? await provider!.getPublishStatus(row.provider_post_id, { platform: row.platform, sentAt: row.published_at, text })
          : null;
      } catch {
        continue; // عطلٌ عابر — يُسأل في الدورة التالية
      }
      const sentAt = row.published_at ? Date.parse(row.published_at) : 0;
      const expired = !sentAt || now - sentAt > CONFIRM_WITHIN_MS;
      if (check?.state === 'pending' && !expired) continue;

      if (check?.state === 'failed' || check?.state === 'pending') {
        const retryable = check.state === 'failed' && !!check.retryable;
        const msg = retryable
          ? timedOutError(platformName(row.platform, await customPlatformLabels(env)), check.error)
          : check.state === 'failed'
            ? `فشل النشر عبر المزوّد: ${check.error || 'رفضت المنصة المنشور'}`
            : UNCONFIRMED_ERROR;
        // ما لم يُؤكَّد قد يُنشر بعد: يبقى مفتاحه فلا تُكرّره إعادة النشر.
        // وما فشل بتعثّرٍ يُعاد يبقى معرّفه: به يُعاد المنشور نفسه
        await failJob(env, { id: row.id, post_id: row.post_id, platform: row.platform, body: '', title: '' }, msg, {
          keepKey: check.state === 'pending',
          retryId: retryable ? row.provider_post_id : null,
        });
        failed++;
        continue;
      }
      // نُشر — أو لا يُعلن المزوّد حالاً يُقرأ فيُعدّ منشوراً كما كان. ووقتُ
      // النشر وقتُ الإرسال المحفوظ لا وقتُ هذا السؤال.
      await env.DB.prepare(
        "UPDATE schedules SET status = 'published', error = NULL, publish_key = NULL WHERE id = ? AND status = 'processing'",
      )
        .bind(row.id)
        .run();
      published++;
    }
  }

  published += await recoverMisreportedFailures(env);
  if (published) await markFullyPublishedPosts(env);
  return { published, failed };
}

/* ═══ ما كُتب فاشلاً وهو منشور — مرّةً واحدة ═══

   قبل أن يُسأل سجلّ المنصة عن «تعثّرٍ يُعاد» (`unsureFailure` في
   `adapters/ayrshare.ts`) كُتبت مواعيدُ لينكدإن فاشلةً وهي على الصفحة، فظهر
   محتواها «متأخراً». فتُفحص مرّةً: ما فشل بذلك السبب في أسبوعين ووُجد في سجلّ
   منصته بنصّه بعد يومٍ قبل موعده يُكتب منشوراً. وما لم يوجد يبقى كما هو. */
const RECOVER_KEY = 'publish_retryable_recovered_at';
const RETRYABLE_MARK = '%تعثّرٌ مؤقت لدى المنصة%';

async function recoverMisreportedFailures(env: Env): Promise<number> {
  const done = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(RECOVER_KEY).first<{ value: string }>();
  if (done?.value) return 0;
  let provider: PublishingProvider;
  try {
    provider = await getProvider(env);
  } catch {
    return 0; // يُعاد في الدورة التالية
  }
  if (!provider.findOnPlatform) return 0;

  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const { results } = await env.DB.prepare(
    `SELECT s.id, s.platform, s.scheduled_at, COALESCE(NULLIF(v.body_override, ''), p.body) AS body, p.title
     FROM schedules s
     JOIN content_posts p ON p.id = s.post_id
     LEFT JOIN post_variants v ON v.post_id = s.post_id AND v.platform = s.platform
     WHERE s.status = 'failed' AND s.error LIKE ? AND s.scheduled_at >= ?
     LIMIT 30`,
  )
    .bind(RETRYABLE_MARK, since)
    .all<{ id: string; platform: string; scheduled_at: string; body: string | null; title: string | null }>();

  let recovered = 0;
  for (const row of results || []) {
    const text = (htmlToText(row.body || '') || row.title || '').trim();
    const from = new Date(Date.parse(row.scheduled_at) - 86_400_000).toISOString();
    let at: string | null;
    try {
      at = await provider.findOnPlatform({ platform: row.platform, text, since: from });
    } catch {
      return recovered; // السجلّ لم يُقرأ — تُعاد المحاولة في الدورة التالية
    }
    if (!at) continue;
    const r = await env.DB.prepare(
      `UPDATE schedules SET status = 'published', error = NULL, publish_key = NULL, published_at = ?
       WHERE id = ? AND status = 'failed'`,
    )
      .bind(at, row.id)
      .run();
    recovered += r.meta.changes ? 1 : 0;
  }
  await env.DB.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  )
    .bind(RECOVER_KEY, nowIso())
    .run();
  return recovered;
}

/* ═══ الفحص عند الجدولة ═══

   كان ما سترفضه المنصة لا يُعرف إلا في الموعد: جُدول منشورٌ على أربع منصات
   فرُفض على الأربع ساعة نشره — صورةٌ أكبر من حدّ إكس، وPNG لا يقبله
   إنستغرام، وصورةٌ واحدة لتيك توك، ولا فيديو ليوتيوب — والمحتوى يظهر
   «متأخراً» ولا أحد يعرف لماذا.

   فيُبنى عند الجدولة ما سيُرسل لكل منصة كما يُبنى عند النشر، ويُفحص بقواعدنا
   (`missingRequirement`) ثم بحدود المنصة كما يُعلنها المزوّد (`preflight`).
   والسبب يُكتب على الموعد نفسه فيظهر تحته فوراً، ويُمحى عند أوّل محاولة نشر.
   ولا يمنع الجدولة: المحتوى قد يُصلَح قبل موعده. */
export async function preflightSchedules(
  env: Env,
  postId: string,
  platforms: string[],
): Promise<PublishError[]> {
  const post = await env.DB.prepare('SELECT body, title FROM content_posts WHERE id = ?')
    .bind(postId)
    .first<{ body: string; title: string }>();
  if (!post) return [];

  let provider: PublishingProvider | null = null;
  let providerError = '';
  try {
    provider = await getProvider(env);
  } catch (err: any) {
    providerError = String(err?.message || err);
  }

  const out: PublishError[] = [];
  for (const platform of platforms) {
    const issues: string[] = [];
    try {
      if (!provider) throw new Error(providerError);
      const input = await prepareInput(env, { id: '', post_id: postId, platform, body: post.body, title: post.title });
      const missing = missingRequirement(platform, input.text, input.media || []);
      if (missing) issues.push(missing);
      issues.push(...mediaIssues(platform, input.media || []));
      issues.push(...optionIssues(platform, input.options || {}, input.media || []));
      if (provider.preflight) issues.push(...(await provider.preflight(input)));
    } catch (err: any) {
      issues.push(String(err?.message || err));
    }
    const error = [...new Set(issues)].join(' · ') || null;
    await env.DB.prepare(
      "UPDATE schedules SET error = ? WHERE post_id = ? AND platform = ? AND status = 'pending'",
    )
      .bind(error, postId, platform)
      .run();
    if (error) out.push({ platform, error });
  }
  return out;
}
