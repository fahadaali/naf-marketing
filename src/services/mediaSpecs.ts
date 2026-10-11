import type { PublishMedia } from '../adapters/provider';

/* ═══ الوسيط على مقاس كل منصة ═══

   يُرسل المحتوى نفسه إلى كل منصةٍ في طلبٍ منفصل، فيُكيَّف وسيطه لكلٍّ منها
   هنا قبل الطلب. والمصادر صفحات «Media Guidelines» في توثيق Ayrshare
   (https://www.ayrshare.com/docs/media-guidelines/overview).

   القاعدة: الصورة تُترك كما صُمّمت ما دامت المنصة تقبل نسبتها، ولا تُكيَّف
   إلا حين تخرج عن المدى — فتُرفض أو تقصّها المنصة بنفسها. والتكييف إطارٌ
   بمقاس المنصة، خلفيّته الصورة نفسها مكبّرةً مموّهة، والصورة كاملةً في
   وسطه: لا يُقصّ منها نصٌّ ولا شعار، ولا لون يُكتب باليد.

   والنسبة هنا العرض على الارتفاع: ‎9:16‎ = 0.5625. */

export type ImageSpec = {
  /** أدنى نسبةٍ تقبلها المنصة (الأطول) وأعلاها (الأعرض) — وغيابهما: كل نسبة. */
  min?: number;
  max?: number;
  /** مقاس الإطار لصورةٍ أطول من المدى، ولأعرض منه. */
  tall?: [number, number];
  wide?: [number, number];
  /** أطول ضلعٍ يُرسل — وما فوقه يُصغَّر بنسبته دون إطار. إنستغرام يرفض
      عرضاً فوق ٦٠٠٠، وكانت صورةٌ بعرض ٧١٩٤ تُرفض بعد موعدها. */
  maxSide?: number;
  /** PNG مرفوض — يُحوَّل إلى JPEG وإن قُبلت نسبته (تيك توك). */
  noPng?: boolean;
};

const PORTRAIT_9_16: [number, number] = [1080, 1920];

export const IMAGE_SPECS: Record<string, ImageSpec> = {
  // ‎4:5‎ إلى ‎1.91:1‎ — وما خرج عنه يرفضه إنستغرام. وعرضه ٣٢٠–١٤٤٠ في التوثيق
  instagram: { min: 0.8, max: 1.91, tall: [1080, 1350], wide: [1080, 566], maxSide: 1440 },
  // القصة وسبوتلايت ‎9:16‎ وحدها
  snapchat: { min: 0.5625, max: 0.5625, tall: PORTRAIT_9_16, wide: PORTRAIT_9_16, maxSide: 1920 },
  /* ‎9:16‎ وحدها، ولا يقبل PNG. والتوثيق يقول «‎9:16‎ أو ‎16:9‎ أو مربّعة»، وردّ
     تيك توك نفسه رفض المربّعة: «TikTok does not allow square images». فكل
     صورةٍ غير طوليّة تُوضع في إطار ‎1080×1920‎ — مقاس الشاشة في تيك توك. */
  tiktok: { min: 0.5625, max: 0.5625, tall: PORTRAIT_9_16, wide: PORTRAIT_9_16, maxSide: 1920, noPng: true },
  // ‎1:2.4‎ إلى ‎2.4:1‎
  linkedin: { min: 1 / 2.4, max: 2.4, tall: [1080, 1350], wide: [1200, 627], maxSide: 4096 },
  linkedin_page: { min: 1 / 2.4, max: 2.4, tall: [1080, 1350], wide: [1200, 627], maxSide: 4096 },
  // حتى ‎10:1‎ في الاتجاهين، وعرضه حتى ١٤٤٠
  threads: { min: 0.1, max: 10, tall: PORTRAIT_9_16, wide: [1920, 1080], maxSide: 1440 },
  /* «الطولي قد يُرفض فاستعمل الأفقي» — كذا في التوثيق بلا حدٍّ معلن، فالثقة
     منخفضة. والإطار الأفقي لا يضرّ صورةً كانت ستُقبل. */
  google: { min: 1, max: 2, tall: [1200, 900], wide: [1600, 900], maxSide: 2048 },
  // كل نسبة — والضلع: فيسبوك حتى ٢٠٤٨، وإكس يصغّر ما فوق ٤٠٩٦ بنفسه
  facebook: { maxSide: 2048 },
  x: { maxSide: 4096 },
};

/** هامش المقارنة: صورةٌ بنسبة ‎0.5620‎ هي ‎9:16‎ في الحقيقة، لا تُكيَّف لفرق بكسل. */
const TOLERANCE = 0.01;

/** مقاس الإطار الذي تُكيَّف إليه الصورة لهذه المنصة — أو `null` إن قبلتها كما هي. */
export function imageTarget(platform: string, width: number, height: number): [number, number] | null {
  const spec = IMAGE_SPECS[platform];
  if (!spec || !(width > 0) || !(height > 0)) return null;
  const r = width / height;
  if (spec.min && spec.tall && r < spec.min * (1 - TOLERANCE)) return spec.tall;
  if (spec.max && spec.wide && r > spec.max * (1 + TOLERANCE)) return spec.wide;
  return null;
}

/** مقاسٌ مصغَّر بنسبة الصورة إن تجاوز أطول أضلاعها حدّ المنصة — وإلا `null`. */
export function imageDownscale(platform: string, width: number, height: number): [number, number] | null {
  const max = IMAGE_SPECS[platform]?.maxSide;
  if (!max || !(width > 0) || !(height > 0) || Math.max(width, height) <= max) return null;
  const k = max / Math.max(width, height);
  return [Math.max(1, Math.round(width * k)), Math.max(1, Math.round(height * k))];
}

/* ═══ المقطع ═══

   المقطع لا يُضغط ولا يُعاد ترميزه: جودته أولى، وحدّ الرفع عندنا (١٠٠
   ميغابايت) تحت أصغر حدود المنصات. فيُحذَّر قبل النشر مما سترفضه المنصة —
   مدّةً أو حجماً — ولا يُصلَح بصمت. */

export type VideoSpec = { minMs?: number; maxMs?: number; maxBytes?: number };

const MB = 1048576;

export const VIDEO_SPECS: Record<string, VideoSpec> = {
  x: { minMs: 500, maxMs: 140_000, maxBytes: 512 * MB },
  instagram: { minMs: 3_000, maxMs: 15 * 60_000, maxBytes: 1024 * MB },
  tiktok: { minMs: 3_000, maxMs: 600_000, maxBytes: 10 * 1024 * MB },
  snapchat: { minMs: 5_000, maxMs: 60_000, maxBytes: 1024 * MB },
  linkedin: { minMs: 3_000, maxMs: 30 * 60_000, maxBytes: 500 * MB },
  linkedin_page: { minMs: 3_000, maxMs: 30 * 60_000, maxBytes: 500 * MB },
  facebook: { maxBytes: 2048 * MB },
  youtube: { maxBytes: 4096 * MB },
  threads: { maxMs: 5 * 60_000, maxBytes: 1024 * MB },
};

/** حدود ريلز فيسبوك وشورتس يوتيوب — للمقطع الطوليّ وحده. */
export const FACEBOOK_REEL_MS: [number, number] = [3_000, 90_000];
export const YOUTUBE_SHORT_MAX_MS = 180_000;

export type MediaMeta = { width?: number | null; height?: number | null; duration_ms?: number | null };

export function isVertical(m: MediaMeta): boolean {
  return !!m.width && !!m.height && m.height > m.width;
}

/** ريلز فيسبوك: طوليٌّ بين ٣ و٩٠ ثانية. وما سواه فيديو عاديّ كما كان. */
export function facebookReel(m: MediaMeta): boolean {
  const d = m.duration_ms ?? 0;
  return isVertical(m) && d >= FACEBOOK_REEL_MS[0] && d <= FACEBOOK_REEL_MS[1];
}

/** شورتس يوتيوب: طوليٌّ حتى ثلاث دقائق. */
export function youtubeShort(m: MediaMeta): boolean {
  const d = m.duration_ms ?? 0;
  return isVertical(m) && d > 0 && d <= YOUTUBE_SHORT_MAX_MS;
}

function seconds(ms: number): string {
  return ms % 1000 === 0 ? String(ms / 1000) : (ms / 1000).toFixed(1);
}

/** ما سترفضه المنصة من المقطع — مدّته وحجمه — بنصٍّ يقول ما يُفعل. */
export function videoIssues(platform: string, m: MediaMeta & { size?: number; filename?: string }): string[] {
  const spec = VIDEO_SPECS[platform];
  if (!spec) return [];
  const out: string[] = [];
  const name = m.filename ? `«${m.filename}» ` : '';
  const d = m.duration_ms;
  if (d && spec.minMs && d < spec.minMs) {
    out.push(`المقطع ${name}أقصر من حدّ هذه المنصة (${seconds(spec.minMs)} ثانية على الأقل). ضع مقطعاً أطول في نسخة المنصة ثم أعد النشر`);
  }
  if (d && spec.maxMs && d > spec.maxMs) {
    out.push(`المقطع ${name}أطول من حدّ هذه المنصة (${seconds(spec.maxMs)} ثانية على الأكثر). ضع مقطعاً أقصر في نسخة المنصة ثم أعد النشر`);
  }
  if (m.size && spec.maxBytes && m.size > spec.maxBytes) {
    out.push(`حجم المقطع ${name}يتجاوز حدّ هذه المنصة، ولا يُضغط المقطع حفاظاً على جودته. ضع نسخةً أصغر في نسخة المنصة ثم أعد النشر`);
  }
  return out;
}

/* ═══ تكييف الصورة ═══ */

/** صيغٌ يقرؤها `IMAGES` ويُخرجها JPEG. والمتحرّكة (GIF) تفقد حركتها، فلا تُمسّ. */
export const ADAPTABLE = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

/** تمويه الخلفية وتعتيمها — في الصورة المُرسلة لا في الواجهة: الخلفية تبقى
    خلفيةً، وتبرز الصورة فوقها. */
const BACKDROP = { blur: 60, brightness: 0.8 };
const QUALITY = 90;

/** مقاس الصورة داخل الإطار: أكبر ما يسعه دون قصّ. */
export function containSize(width: number, height: number, frame: [number, number]): [number, number] {
  const [W, H] = frame;
  const r = width / height;
  let w = W;
  let h = Math.round(W / r);
  if (h > H) {
    h = H;
    w = Math.round(H * r);
  }
  return [Math.max(1, w), Math.max(1, h)];
}

function baseName(filename: string): string {
  return (filename || 'media').replace(/\.[a-z0-9]{2,5}$/i, '');
}

type Read = () => Promise<ReadableStream<Uint8Array>>;

function reader(m: PublishMedia): Read {
  return async () => {
    const s = m.data ? new Blob([m.data]).stream() : await m.open?.();
    if (!s) throw new Error('وسيطٌ في المحتوى لم يعد موجوداً في المكتبة. احذفه من المحتوى أو أعد رفعه ثم أعد النشر');
    return s;
  };
}

async function toBuffer(out: ImageTransformationResult): Promise<ArrayBuffer> {
  return new Response(out.image()).arrayBuffer();
}

/** الإطار المموّه: الصورة كاملةً في وسط إطارٍ بمقاس المنصة. */
export async function frameImage(
  images: ImagesBinding,
  m: PublishMedia,
  dims: { width: number; height: number },
  frame: [number, number],
  suffix: string,
): Promise<PublishMedia> {
  const read = reader(m);
  const [W, H] = frame;
  const [w, h] = containSize(dims.width, dims.height, frame);
  try {
    const backdrop = images
      .input(await read())
      .transform({ width: W, height: H, fit: 'cover' })
      .transform(BACKDROP);
    const photo = images.input(await read()).transform({ width: w, height: h, fit: 'contain' });
    const out = await backdrop
      .draw(photo, { top: Math.round((H - h) / 2), left: Math.round((W - w) / 2) })
      .output({ format: 'image/jpeg', quality: QUALITY });
    const data = await toBuffer(out);
    return { data, size: data.byteLength, mimeType: 'image/jpeg', filename: `${baseName(m.filename)}-${suffix}.jpg` };
  } catch (err) {
    throw new Error(`تعذّر تكييف الصورة «${m.filename}» لهذه المنصة: ${String((err as Error)?.message || err)}`);
  }
}

/** الصورة JPEG — بأبعادها، أو مصغّرةً إلى `size`. للمنصة التي ترفض PNG أو
    تضيق بالأبعاد الكبيرة. والشفافية تُسطَّح على أبيض. */
async function toJpeg(images: ImagesBinding, m: PublishMedia, size?: [number, number]): Promise<PublishMedia> {
  try {
    let t = images.input(await reader(m)());
    if (size) t = t.transform({ width: size[0], height: size[1], fit: 'scale-down' });
    const out = await t.output({ format: 'image/jpeg', quality: QUALITY, background: 'white' });
    const data = await toBuffer(out);
    return { data, size: data.byteLength, mimeType: 'image/jpeg', filename: `${baseName(m.filename)}.jpg` };
  } catch (err) {
    throw new Error(`تعذّر تجهيز الصورة «${m.filename}» لهذه المنصة: ${String((err as Error)?.message || err)}`);
  }
}

/** أبعاد الصورة: المحفوظة عند الرفع، وإلا قُرئت من الملف. */
export async function imageDims(
  images: ImagesBinding,
  m: PublishMedia & MediaMeta,
): Promise<{ width: number; height: number } | null> {
  if (m.width && m.height) return { width: m.width, height: m.height };
  try {
    const info = (await images.info(await reader(m)())) as { width?: number; height?: number };
    return info.width && info.height ? { width: info.width, height: info.height } : null;
  } catch {
    return null;
  }
}

/**
 * الصورة كما ستصل هذه المنصة: كما هي إن قبلتها، وإلا في إطارٍ بمقاسها.
 * والأصل في المكتبة لا يُمسّ — تُصنع نسخةٌ تُرسل وحدها.
 */
export async function adaptImage(
  images: ImagesBinding,
  platform: string,
  m: PublishMedia & MediaMeta,
): Promise<PublishMedia & MediaMeta> {
  const mime = (m.mimeType || '').toLowerCase();
  if (!ADAPTABLE.has(mime) || !IMAGE_SPECS[platform]) return m;
  const dims = await imageDims(images, m);
  const frame = dims ? imageTarget(platform, dims.width, dims.height) : null;
  if (dims && frame) {
    const out = await frameImage(images, m, dims, frame, platform);
    return { ...out, width: frame[0], height: frame[1] };
  }
  const smaller = dims ? imageDownscale(platform, dims.width, dims.height) : null;
  if (smaller || (IMAGE_SPECS[platform].noPng && mime === 'image/png')) {
    const [width, height] = smaller ?? [dims?.width, dims?.height];
    return { ...(await toJpeg(images, m, smaller ?? undefined)), width, height };
  }
  return m;
}
