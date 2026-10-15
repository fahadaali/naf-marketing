import type { Env } from '../types';

/* ═══ معرّف المنشور على منصته من رابطه ═══

   لقطةٌ من مزوّدٍ سابق (Buffer أو SocialAPI) مفتاحُها معرّفُ ذلك المزوّد، وبه
   تُطلب تعليقاتها فيردّ Ayrshare «غير موجود». ويُعرف معرّفها الأصلي حين يطابقها
   سجلّ المنصة (0045) — والمطابقة بالرابط كانت بحروفه، فرابطُ يوتيوب القصير
   (`youtu.be/…`) لا يطابق الطويل (`watch?v=…`) وهما منشورٌ واحد، فيبقى المنشور
   بلا معرّفه الأصلي ولا تصل تعليقاته أبداً.

   وفي ثلاث منصاتٍ يحمل الرابطُ المعرّفَ الأصلي نفسه، فيُقرأ منه: يوتيوب
   (معرّف الفيديو)، وإكس (رقم التغريدة)، وتيك توك (رقم الفيديو). وما سواها لا
   يُستنتج: رمز إنستغرام القصير ليس معرّف الوسيط، وروابط فيسبوك ولينكدإن
   متعدّدة الصيغ — فيُترك لمطابقة السجلّ. */

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/** المعرّف الأصلي من رابط المنشور — أو `null` إن لم يحمله الرابط أو لم تُعرف صيغته. */
export function nativeIdFromUrl(platform: string, url: string | null | undefined): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^(www\.|m\.|mobile\.)/, '');
  const parts = u.pathname.split('/').filter(Boolean);

  if (platform === 'youtube') {
    let id: string | null = null;
    if (host === 'youtu.be') id = parts[0] ?? null;
    else if (host === 'youtube.com' || host === 'music.youtube.com') {
      if (parts[0] === 'watch') id = u.searchParams.get('v');
      else if (['shorts', 'live', 'embed', 'v'].includes(parts[0] ?? '')) id = parts[1] ?? null;
    }
    return id && YOUTUBE_ID.test(id) ? id : null;
  }

  if (platform === 'x') {
    if (host !== 'x.com' && host !== 'twitter.com') return null;
    const i = parts.indexOf('status');
    const id = i >= 0 ? parts[i + 1] : undefined;
    return id && /^\d+$/.test(id) ? id : null;
  }

  if (platform === 'tiktok') {
    if (host !== 'tiktok.com') return null;
    const i = parts.findIndex((p) => p === 'video' || p === 'photo');
    const id = i >= 0 ? parts[i + 1] : undefined;
    return id && /^\d+$/.test(id) ? id : null;
  }

  return null;
}

/**
 * شرطُ SQL لمفتاحٍ من مزوّدٍ سابق: نائبُ SocialAPI (`…:منصة`) أو معرّف Buffer
 * (٢٤ خانة ست عشرية فيها حرف). مفتاحٌ كهذا لا يعرفه Ayrshare أبداً.
 */
export function legacyKeySql(keyCol: string, platformCol: string): string {
  return `(${keyCol} LIKE '%:' || ${platformCol}
          OR (length(${keyCol}) = 24 AND ${keyCol} NOT GLOB '*[^0-9a-f]*' AND ${keyCol} GLOB '*[a-f]*'))`;
}

/** المنصات التي يُقرأ معرّفها الأصلي من رابطها. */
export const URL_NATIVE_PLATFORMS = ['youtube', 'x', 'tiktok'];

/**
 * يملأ `native_post_id` من الرابط للقطاتٍ لم يُعرف معرّفها الأصلي. وما يطابق
 * فيه الرابطُ المفتاحَ يُكتب كذلك، فلا يُعاد فحصه في كل دورة. لا طلب إلى
 * المزوّد، ولا يُمسّ معرّفٌ أصليٌّ معروف.
 */
export async function resolveNativeIdsFromUrls(env: Env): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT provider_post_id, platform, external_url FROM analytics_snapshots
     WHERE native_post_id IS NULL AND external_url IS NOT NULL AND external_url <> ''
       AND platform IN (${URL_NATIVE_PLATFORMS.map(() => '?').join(',')})`,
  )
    .bind(...URL_NATIVE_PLATFORMS)
    .all<{ provider_post_id: string; platform: string; external_url: string }>();

  const stmts: D1PreparedStatement[] = [];
  for (const r of results) {
    const id = nativeIdFromUrl(r.platform, r.external_url);
    if (!id) continue;
    stmts.push(
      env.DB.prepare('UPDATE analytics_snapshots SET native_post_id = ? WHERE provider_post_id = ? AND native_post_id IS NULL')
        .bind(id, r.provider_post_id),
    );
  }
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  return stmts.length;
}
