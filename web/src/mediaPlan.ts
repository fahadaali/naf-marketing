// ما سيصل كل منصة من وسائط المحتوى — للمعاينة في «نسخة كل منصة».
//
// المواصفات من الخادم (`GET /api/media/specs` ← `src/services/mediaSpecs.ts`)
// ولا تُحمل هنا نسخةٌ منها. وما هنا قراءتها وحدها: `imageTarget` بالقاعدة
// نفسها في الخادم، واختبارٌ يقارن الاثنين (`test/mediaPlan.test.ts`).

export type ImageSpec = {
  min?: number;
  max?: number;
  tall?: [number, number];
  wide?: [number, number];
  maxSide?: number;
  noPng?: boolean;
};
export type VideoSpec = { minMs?: number; maxMs?: number; maxBytes?: number };
export type MediaSpecs = {
  image: Record<string, ImageSpec>;
  video: Record<string, VideoSpec>;
  facebook_reel_ms: [number, number];
  youtube_short_max_ms: number;
};

export type AssetInfo = {
  id: string;
  mime_type: string | null;
  filename?: string | null;
  size?: number | null;
  width?: number | null;
  height?: number | null;
  duration_ms?: number | null;
  /** النص البديل ووسم الذكاء الاصطناعي (0042) — يُرسلان مع الوسيط عند النشر. */
  alt_text?: string | null;
  ai_generated?: number | null;
};

export type Variant = {
  platform: string;
  media_asset_id?: string | null;
  generated_media_id?: string | null;
  generated_from_id?: string | null;
};

const TOLERANCE = 0.01;

/** مقاس الإطار الذي تُكيَّف إليه الصورة لهذه المنصة — أو `null` إن قبلتها كما هي. */
export function imageTarget(
  specs: Pick<MediaSpecs, 'image'>,
  platform: string,
  width: number,
  height: number,
): [number, number] | null {
  const spec = specs.image[platform];
  if (!spec || !(width > 0) || !(height > 0)) return null;
  const r = width / height;
  if (spec.min && spec.tall && r < spec.min * (1 - TOLERANCE)) return spec.tall;
  if (spec.max && spec.wide && r > spec.max * (1 + TOLERANCE)) return spec.wide;
  return null;
}

/** معرّفات الوسائط في متن المحرر، بترتيبها — كما يقرؤها الخادم (`extractMediaIds`). */
export function bodyMediaIds(html: string): string[] {
  const out: string[] = [];
  const re = /\/api\/media\/([A-Za-z0-9_-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html || '')) !== null) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

const ADAPTABLE = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
const isImage = (a?: AssetInfo) => !!a && (a.mime_type || '').startsWith('image/');
const isVideo = (a?: AssetInfo) => !!a && (a.mime_type || '').startsWith('video/');

export type PlannedItem = {
  id: string;
  asset?: AssetInfo;
  /** الإطار الذي ستُكيَّف إليه الصورة، أو `null` إن أُرسلت كما هي. */
  frame: [number, number] | null;
};

export type PlatformMedia = {
  /** من أين وسيط المنصة: المتن، أو ما اختير لها باليد. */
  source: 'body' | 'variant';
  items: PlannedItem[];
  /** تيك توك بصورةٍ واحدة: يُصنع منها مقطع عند النشر. */
  needsVideo: boolean;
  /** المقطع المولّد للصورة الحالية نفسها — جاهز، لا يُولَّد من جديد. */
  videoReady: boolean;
};

/** صورةٌ واحدة لمنصةٍ لا تقبل منشور صورٍ بأقلّ من صورتين. */
const NEEDS_TWO_IMAGES = new Set(['tiktok']);

/** وسائط المنصة كما سيرسلها الخادم (`prepareInput`): أربعةٌ على الأكثر. */
export function platformMedia(
  specs: MediaSpecs | null,
  platform: string,
  bodyIds: string[],
  variant: Variant | undefined,
  assets: Record<string, AssetInfo>,
): PlatformMedia {
  const source = variant?.media_asset_id ? 'variant' : 'body';
  const ids = (variant?.media_asset_id ? [variant.media_asset_id] : bodyIds).slice(0, 4);
  const items = ids.map((id) => {
    const asset = assets[id];
    const mime = (asset?.mime_type || '').toLowerCase();
    const frame =
      specs && asset && ADAPTABLE.has(mime) && asset.width && asset.height
        ? imageTarget(specs, platform, asset.width, asset.height)
        : null;
    return { id, asset, frame };
  });
  const single = items.length === 1 && isImage(items[0].asset);
  const needsVideo = NEEDS_TWO_IMAGES.has(platform) && single;
  const videoReady =
    needsVideo && !!variant?.generated_media_id && variant.generated_from_id === items[0].id;
  return { source, items, needsVideo, videoReady };
}

/** هل في وسائط المنصة ما يحتاج نظرة — صورةٌ تُكيَّف أو مقطعٌ يُصنع. */
export function needsAttention(p: PlatformMedia): boolean {
  return p.needsVideo || p.items.some((i) => !!i.frame);
}

/** نسبة الإطار نصّاً: ‎9:16‎، ‎4:5‎… — للشارة تحت المعاينة. */
export function ratioLabel([w, h]: [number, number]): string {
  const KNOWN: [number, number, string][] = [
    [9, 16, '9:16'], [16, 9, '16:9'], [4, 5, '4:5'], [1, 1, '1:1'], [4, 3, '4:3'], [1.91, 1, '1.91:1'],
  ];
  const r = w / h;
  const hit = KNOWN.find(([a, b]) => Math.abs(a / b - r) < 0.02);
  return hit ? hit[2] : `${w}×${h}`;
}

/** نوع النشر الذي سيأخذه المقطع على المنصة — ريلز، شورتس، سبوتلايت… */
export function videoMode(specs: MediaSpecs | null, platform: string, a?: AssetInfo): string | null {
  if (!isVideo(a)) return null;
  const vertical = !!a!.width && !!a!.height && a!.height! > a!.width!;
  const d = a!.duration_ms ?? 0;
  switch (platform) {
    case 'instagram':
      return 'ريلز';
    case 'facebook': {
      const [min, max] = specs?.facebook_reel_ms ?? [3000, 90000];
      return vertical && d >= min && d <= max ? 'ريلز' : null;
    }
    case 'youtube':
      return vertical && d > 0 && d <= (specs?.youtube_short_max_ms ?? 180000) ? 'شورتس' : null;
    case 'snapchat':
      return 'سبوتلايت وقصة';
    default:
      return null;
  }
}
