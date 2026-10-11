// تيك توك لا يقبل منشوراً بصورةٍ واحدة — صورتان فأكثر أو مقطع. فتُصنع من
// الصورة الواحدة هنا مقطعاً: الصورة ثابتةً خمس ثوانٍ في إطار ‎1080×1920‎،
// ومعها مسار صوتٍ صامت (يعامله تيك توك مقطعاً لا منشور صور).
//
// يُصنع في المتصفح لأن العامل لا يملك ما يرمّز به فيديو. ويُستدعى لحظة
// «جدولة النشر» أو «نشر الآن» إن كانت تيك توك بينها — فلا خطوة على أحد.
//
// - الإطار صورة الخادم نفسها (`/api/media/:id/adapted?frame=portrait`) —
//   الإطار المموّه الذي يُكيَّف به لسناب، فالمعاينة والمقطع شيءٌ واحد.
// - الصورة H.264 عبر WebCodecs، والتغليف MP4 بمكتبة `mediabunny`. ومتصفحٌ
//   بلا مرمّز H.264 (Chromium مفتوح المصدر) يُخرج VP9 في WebM — يقبله تيك
//   توك كذلك.
// - الصوت حِزَمٌ صامتة ثابتة البايتات (AAC مع MP4، وOpus مع WebM)، لا يُرمَّز
//   شيء — فلا يحتاج `AudioEncoder` الذي لا يتوفّر في كل متصفح.
//
// والمقطع يُرفع وسيطاً، ويُحفظ في نسخة تيك توك مع الصورة التي صُنع منها:
// إن تغيّرت بعده صُنع غيره في الضغطة التالية، ولا يُنشر مقطعٌ من صورةٍ قديمة.

import { api } from './api';
import { uploadMedia } from './mediaUpload';
import { bodyMediaIds, platformMedia, type AssetInfo, type Variant } from './mediaPlan';

export const TIKTOK_VIDEO_SECONDS = 5;
const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;

/* AAC-LC بـ ‎44.1‎ كيلوهرتز وقناتين: إعداد الفكّ (AudioSpecificConfig)، وإطارٌ
   صامت واحد (١٠٢٤ عيّنة) يتكرّر. البايتات نفسها التي يملأ بها hls.js فجوات
   الصوت (`AAC.getSilentFrame`). */
const AAC_SAMPLE_RATE = 44100;
const AAC_CONFIG = new Uint8Array([0x12, 0x10]);
const AAC_SILENT_FRAME = new Uint8Array([0x21, 0x00, 0x49, 0x90, 0x02, 0x19, 0x00, 0x23, 0x80]);
const AAC_FRAME_SAMPLES = 1024;

/* Opus بـ ‎48‎ كيلوهرتز: إطار صمتٍ واحد مدّته ‎20‎ ملّي ثانية (‎0xF8 0xFF 0xFE‎)
   — الإطار الذي تملأ به تطبيقات الصوت لحظات السكوت. */
const OPUS_SILENT_FRAME = new Uint8Array([0xf8, 0xff, 0xfe]);
const OPUS_FRAME_SECONDS = 0.02;

type Container = { video: 'avc' | 'vp9'; ext: 'mp4' | 'webm'; type: string };

async function loadBitmap(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** إطار ‎9:16‎ من الخادم. وبلا ربط `IMAGES` تُرسم الصورة نفسها في وسط الإطار. */
async function portraitFrame(imageId: string): Promise<Blob> {
  const res = await fetch(`/api/media/${imageId}/adapted?frame=portrait`, { credentials: 'same-origin' });
  if (res.ok) return res.blob();
  const raw = await fetch(`/api/media/${imageId}`, { credentials: 'same-origin' });
  if (!raw.ok) throw new Error('تعذّر جلب الصورة لتجهيز مقطع تيك توك. أعد المحاولة');
  return raw.blob();
}

/** يصنع المقطع من الصورة ويردّه ملفاً — ‎1080×1920‎، خمس ثوانٍ، بصوتٍ صامت. */
export async function imageToVideo(image: Blob, name: string): Promise<File> {
  const mb = await import('mediabunny');
  const size = { width: WIDTH, height: HEIGHT };
  let box: Container | null = null;
  if (typeof VideoEncoder !== 'undefined') {
    if (await mb.canEncodeVideo('avc', size)) box = { video: 'avc', ext: 'mp4', type: 'video/mp4' };
    else if (await mb.canEncodeVideo('vp9', size)) box = { video: 'vp9', ext: 'webm', type: 'video/webm' };
  }
  if (!box) {
    throw new Error('هذا المتصفح لا يدعم تجهيز مقطع تيك توك. استخدم متصفحاً حديثاً (Chrome أو Edge أو Safari)، أو أضف صورة ثانية إلى المحتوى');
  }

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('تعذّر تجهيز مقطع تيك توك في هذا المتصفح');
  const bmp = await loadBitmap(image);
  /* الإطار في الغالب صورة الخادم بمقاسه، فيُرسم كما هو. وإن تعذّرت (بلا ربط
     IMAGES) رُسم هنا بالتركيب نفسه: الصورة مكبّرةً مموّهةً خلفيةً، وهي كاملةً
     في الوسط. والتمويه في المقطع المُرسل لا في الواجهة. */
  const cover = Math.max(WIDTH / bmp.width, HEIGHT / bmp.height);
  const cw = Math.round(bmp.width * cover);
  const ch = Math.round(bmp.height * cover);
  ctx.filter = 'blur(40px) brightness(0.8)';
  ctx.drawImage(bmp, Math.round((WIDTH - cw) / 2), Math.round((HEIGHT - ch) / 2), cw, ch);
  ctx.filter = 'none';
  const r = Math.min(WIDTH / bmp.width, HEIGHT / bmp.height);
  const w = Math.round(bmp.width * r);
  const h = Math.round(bmp.height * r);
  ctx.drawImage(bmp, Math.round((WIDTH - w) / 2), Math.round((HEIGHT - h) / 2), w, h);
  if ('close' in bmp) bmp.close();

  const mp4 = box.ext === 'mp4';
  const output = new mb.Output({
    format: mp4 ? new mb.Mp4OutputFormat({ fastStart: 'in-memory' }) : new mb.WebMOutputFormat(),
    target: new mb.BufferTarget(),
  });
  const video = new mb.CanvasSource(canvas, { codec: box.video, bitrate: mb.QUALITY_HIGH, keyFrameInterval: 1 });
  const audio = new mb.EncodedAudioPacketSource(mp4 ? 'aac' : 'opus');
  output.addVideoTrack(video, { frameRate: FPS });
  output.addAudioTrack(audio);
  await output.start();

  const frames = TIKTOK_VIDEO_SECONDS * FPS;
  for (let i = 0; i < frames; i++) await video.add(i / FPS, 1 / FPS);

  const silent = mp4 ? AAC_SILENT_FRAME : OPUS_SILENT_FRAME;
  const frameDuration = mp4 ? AAC_FRAME_SAMPLES / AAC_SAMPLE_RATE : OPUS_FRAME_SECONDS;
  const config: AudioDecoderConfig = mp4
    ? { codec: 'mp4a.40.2', sampleRate: AAC_SAMPLE_RATE, numberOfChannels: 2, description: AAC_CONFIG }
    : { codec: 'opus', sampleRate: 48000, numberOfChannels: 2 };
  const packets = Math.ceil(TIKTOK_VIDEO_SECONDS / frameDuration);
  for (let i = 0; i < packets; i++) {
    const packet = new mb.EncodedPacket(silent, 'key', i * frameDuration, frameDuration);
    await audio.add(packet, i === 0 ? { decoderConfig: config } : undefined);
  }

  video.close();
  audio.close();
  await output.finalize();
  const buffer = (output.target as InstanceType<typeof mb.BufferTarget>).buffer;
  if (!buffer) throw new Error('تعذّر تجهيز مقطع تيك توك. أعد المحاولة');
  return new File([buffer], `${name.replace(/\.[a-z0-9]{2,5}$/i, '') || 'tiktok'}-tiktok.${box.ext}`, { type: box.type });
}

/**
 * يجهّز مقطع تيك توك للمحتوى إن احتاجه: صورةٌ واحدة ولا مقطع لها بعد.
 * يقرأ المحتوى كما حُفظ — فهو ما يُنشر — ويردّ `true` إن صنع مقطعاً.
 */
export async function ensureTikTokVideo(postId: string): Promise<boolean> {
  const d = await api.get<{ post: { body: string }; variants: Variant[] }>(`/posts/${postId}`);
  const variant = (d.variants || []).find((v) => v.platform === 'tiktok');
  const ids = variant?.media_asset_id ? [variant.media_asset_id] : bodyMediaIds(d.post.body);
  if (ids.length !== 1) return false;
  const info = await api.get<{ media: AssetInfo[] }>(`/media/info?ids=${encodeURIComponent(ids[0])}`);
  const assets = Object.fromEntries(info.media.map((m) => [m.id, m]));
  const plan = platformMedia(null, 'tiktok', ids, variant, assets);
  if (!plan.needsVideo || plan.videoReady) return false;

  const image = await portraitFrame(ids[0]);
  const file = await imageToVideo(image, assets[ids[0]]?.filename || 'tiktok');
  const up = await uploadMedia<{ id: string }>(file);
  await api.put(`/posts/${postId}/variants/tiktok`, { generated_media_id: up.id, generated_from_id: ids[0] });
  return true;
}
