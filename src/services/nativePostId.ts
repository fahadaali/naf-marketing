/* ═══ معرّف المنشور على منصته من رابطه ═══

   المنشور الواحد قد يصل برابطين بصيغتين — `youtu.be/…` و`watch?v=…` — فلا
   يطابقهما الرابط بحروفه. وفي ثلاث منصاتٍ يحمل الرابطُ المعرّفَ الأصلي نفسه،
   فيُقرأ منه ويُطابَق به: يوتيوب (معرّف الفيديو)، وإكس (رقم التغريدة)، وتيك
   توك (رقم الفيديو). وما سواها لا يُستنتج: رمز إنستغرام القصير ليس معرّف
   الوسيط، وروابط فيسبوك ولينكدإن متعدّدة الصيغ. */

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

/** المنصات التي يُقرأ معرّفها الأصلي من رابطها. */
export const URL_NATIVE_PLATFORMS = ['youtube', 'x', 'tiktok'];
