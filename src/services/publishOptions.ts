/* ============================================================
   خيارات النشر لكل منصة — تُحفظ مع نسختها (`post_variants.options_json`، 0043)
   وتُرسل مع منشورها. والأسماء هنا بلغتنا لا بلغة المزوّد: `adapters/ayrshare.ts`
   يترجمها إلى حقوله، فلو تغيّر المزوّد بقيت الخيارات كما هي.

   ما يُقبل من كل منصة مذكورٌ في `normalizeOptions`، وما سواه يُطرح صامتاً:
   خيارٌ لمنصةٍ لا تعرفه لا يُحفظ لها فيُرسل إليها خطأً. والقيم من صفحات المنصات
   في توثيق Ayrshare — «X Thread» و«Instagram/Facebook Stories» و«Call to
   Action» و«Events Post» و«YouTube Post Optional Fields» و«Subtitles».
   ============================================================ */

export type CtaType = 'call' | 'book' | 'learn_more' | 'sign_up';

export type PublishOptions = {
  /** إكس: سلسلةٌ تقسّم النص على منشوراتٍ متتابعة، ومعها ترقيمها (2/5). */
  thread?: boolean;
  threadNumber?: boolean;
  /** إنستغرام وفيسبوك: قصةٌ تختفي بعد يوم — وسيطٌ واحد بلا نصّ. */
  story?: boolean;
  /** نشاطي التجاري (Google): زرٌّ تحت المنشور، ورابطه لما سوى الاتصال. */
  cta?: { type: CtaType; url?: string };
  /** نشاطي التجاري (Google): فعاليةٌ بعنوانها وموعديها (ISO). */
  event?: { title: string; start: string; end: string };
  /** يوتيوب: تصنيف المقطع ووسومه وملف ترجمته (SRT أو SBV من مكتبة الوسائط). */
  categoryId?: number;
  tags?: string[];
  subtitle?: { mediaId: string; language: 'ar' | 'en'; filename?: string };
};

/** أزرار نشاطي التجاري التي تعني مكتب محاماة — والطلب والتسوّق ليسا منها. */
export const CTA_TYPES: CtaType[] = ['call', 'book', 'learn_more', 'sign_up'];

/** تصنيفات يوتيوب المعروضة بمعرّفاتها في واجهة يوتيوب البرمجية (videoCategories). */
export const YOUTUBE_CATEGORIES = [22, 25, 27, 28] as const;

/** حدودٌ من التوثيق: وسوم يوتيوب حرفان فأكثر لكلٍّ وخمس مئة للمجموع، وعنوان فعالية نشاطي التجاري ٥٨. */
const TAG_MIN = 2;
const TAGS_TOTAL_MAX = 500;
const EVENT_TITLE_MAX = 58;

export type NormalizedOptions = { options: PublishOptions | null; error?: string };

const isIso = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v));

/** ما يُقبل من خيارات المنصة، أو سببُ رفضه. والفارغ يُحفظ `null`. */
export function normalizeOptions(platform: string, raw: unknown): NormalizedOptions {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const out: PublishOptions = {};

  if (platform === 'x') {
    if (o.thread === true) {
      out.thread = true;
      if (o.threadNumber === true) out.threadNumber = true;
    }
  }

  if (platform === 'instagram' || platform === 'facebook') {
    if (o.story === true) out.story = true;
  }

  if (platform === 'google') {
    if (o.cta && CTA_TYPES.includes(o.cta.type)) {
      const url = String(o.cta.url || '').trim();
      if (o.cta.type !== 'call' && !/^https:\/\/\S+$/.test(url)) {
        return { options: null, error: 'رابط الزرّ مطلوب، ويبدأ بـ https://' };
      }
      out.cta = o.cta.type === 'call' ? { type: 'call' } : { type: o.cta.type, url };
    }
    if (o.event) {
      const title = String(o.event.title || '').trim();
      if (!title || !isIso(o.event.start) || !isIso(o.event.end) || Date.parse(o.event.end) <= Date.parse(o.event.start)) {
        return { options: null, error: 'الفعالية تحتاج عنواناً وموعدَي بدءٍ وانتهاء، والانتهاء بعد البدء' };
      }
      if (title.length > EVENT_TITLE_MAX) return { options: null, error: 'عنوان الفعالية أطول من \u206858\u2069 حرفاً. اختصره ثم احفظ' };
      out.event = { title, start: new Date(o.event.start).toISOString(), end: new Date(o.event.end).toISOString() };
    }
  }

  if (platform === 'youtube') {
    const cat = Number(o.categoryId);
    if ((YOUTUBE_CATEGORIES as readonly number[]).includes(cat)) out.categoryId = cat;
    const tags = (Array.isArray(o.tags) ? o.tags : [])
      .map((t: unknown) => String(t ?? '').trim().replace(/^#/, ''))
      .filter(Boolean);
    if (tags.length) {
      const unique = [...new Set(tags)] as string[];
      if (unique.some((t) => t.length < TAG_MIN) || unique.join('').length > TAGS_TOTAL_MAX) {
        return { options: null, error: 'وسم يوتيوب حرفان فأكثر، ومجموع الوسوم خمس مئة حرف' };
      }
      out.tags = unique;
    }
    if (o.subtitle && typeof o.subtitle.mediaId === 'string' && o.subtitle.mediaId) {
      const filename = typeof o.subtitle.filename === 'string' ? o.subtitle.filename.slice(0, 200) : '';
      out.subtitle = {
        mediaId: o.subtitle.mediaId,
        language: o.subtitle.language === 'en' ? 'en' : 'ar',
        ...(filename ? { filename } : {}),
      };
    }
  }

  return { options: Object.keys(out).length ? out : null };
}

/** الخيارات المحفوظة — وما لم يُقرأ منها لا شيء. */
export function parseOptions(raw: string | null | undefined): PublishOptions {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as PublishOptions) : {};
  } catch {
    return {};
  }
}

/**
 * ما يمنع الخيارَ من النشر بوسائط المنشور — يُقال قبل الإرسال لا بعده. القصة
 * وسيطٌ واحد، وفيسبوك لا يقبل لها مقطعاً فوق دقيقة. والفعالية بلا مقطع.
 */
export function optionIssues(platform: string, options: PublishOptions, media: { mimeType: string; duration_ms?: number | null }[]): string[] {
  const issues: string[] = [];
  if (options.story) {
    if (media.length !== 1 || !/^(image|video)\//.test(media[0].mimeType)) {
      issues.push('القصة صورةٌ واحدة أو مقطعٌ واحد. اجعل للمنصة وسيطاً واحداً في «نسخة كل منصة»، أو انشره منشوراً لا قصة');
    } else if (platform === 'facebook' && media[0].mimeType.startsWith('video/') && (media[0].duration_ms ?? 0) > 60_000) {
      issues.push('قصة فيسبوك لا تتجاوز دقيقة. اختصر المقطع، أو انشره منشوراً لا قصة');
    }
  }
  if (options.event && media.some((m) => m.mimeType.startsWith('video/'))) {
    issues.push('فعالية نشاطي التجاري لا تقبل مقطعاً. اجعل وسيطها صورة، أو انشره منشوراً لا فعالية');
  }
  return issues;
}
