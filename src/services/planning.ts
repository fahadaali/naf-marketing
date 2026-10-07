// خطة المحتوى في الخادم — الأشكال ومقابلها من الأنواع، ومدقّقات حقول الخطة.
//
// التحقّق متسامح عن قصد: قيمةٌ غير صالحة تُهمل ويبقى ما كان، ولا تولّد رسالة
// خطأ. الواجهة لا ترسل إلا ما تعرضه، والاستيراد يعدّ ما لم يُطابَق ويقوله —
// ورسالةٌ جديدة لكل حقلٍ تحتاج تسجيلاً في السجلّ قبل أن تُكتب (CLAUDE.md §٧).

export type ContentType = 'text' | 'image' | 'video';

/**
 * الشكل ← النوع. الشكل ما يُنتَج (كاروسيل، قصة، مقال)، والنوع تصنيفٌ تقنيّ
 * تجمع به المؤشرات (`engagement_by_content_type`)؛ ولكل شكلٍ نوعٌ واحد فلا
 * تتغيّر المؤشرات. والأنواع الثلاثة أشكالٌ بأنفسها.
 */
export const FORMAT_TYPE = {
  text: 'text',
  image: 'image',
  carousel: 'image',
  infographic: 'image',
  video: 'video',
  short_video: 'video',
  story: 'image',
  article: 'text',
} as const satisfies Record<string, ContentType>;

export type Format = keyof typeof FORMAT_TYPE;

const CONTENT_TYPES: readonly string[] = ['text', 'image', 'video'];

export function isFormat(v: unknown): v is Format {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(FORMAT_TYPE, v);
}

/**
 * الشكل والنوع معاً. الشكل يقرّر النوع. ومن يرسل النوع وحده — استيرادٌ
 * قديم أو عميلٌ لا يعرف الشكل — يبقى شكلُه الحاليّ إن وافق النوع، وإلا
 * الشكلُ الأساسيّ للنوع. و`null` إن لم يأتِ أحدهما صالحاً: لا يُمسّ العمودان.
 */
export function resolveFormat(
  input: { format?: unknown; content_type?: unknown },
  current?: string | null,
): { format: Format; content_type: ContentType } | null {
  if (isFormat(input.format)) return { format: input.format, content_type: FORMAT_TYPE[input.format] };
  if (typeof input.content_type === 'string' && CONTENT_TYPES.includes(input.content_type)) {
    const type = input.content_type as ContentType;
    if (isFormat(current) && FORMAT_TYPE[current] === type) return { format: current, content_type: type };
    return { format: type, content_type: type };
  }
  return null;
}

/** يومٌ صحيح بصيغة 'YYYY-MM-DD'. و2026-02-30 يُرفض، لا يُطوى إلى مارس. */
export function isYmd(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/*
 * المدقّقات أدناه تُرجع ثلاث قيم: قيمةً تُخزَّن، أو `null` تمسح الحقل، أو
 * `undefined` تتركه كما هو — لأن المُرسَل غير صالح أو لم يُرسَل أصلاً.
 */

export function cleanDay(v: unknown): string | null | undefined {
  if (v === null || v === '') return null;
  return isYmd(v) ? v : undefined;
}

/** منصات الخطة: مفاتيح بلا تكرار، JSON كـ `campaigns.target_platforms`. */
export function cleanPlatforms(v: unknown): string | null | undefined {
  if (v === null) return null;
  if (!Array.isArray(v)) return undefined;
  const keys = [...new Set(v.filter((p): p is string => typeof p === 'string' && /^[a-z0-9_]{1,32}$/.test(p)))];
  return keys.length ? JSON.stringify(keys.slice(0, 12)) : null;
}

export function cleanText(v: unknown, max: number): string | null | undefined {
  if (v === null) return null;
  if (typeof v !== 'string') return undefined;
  const s = v.trim().slice(0, max);
  return s || null;
}

export const PILLAR_MAX = 80;
export const BRIEF_MAX = 2000;

/** سقف قائمة الخطة — وما زاد عليه يُقال (`truncated`) ولا يُسقط صامتاً. */
export const PLANNED_CAP = 1000;

/**
 * منصات المحتوى المجدولة فعلاً، مفصولةً بفاصلة («linkedin,x») — لصفّ الشعارات
 * فوق عنوانه في القوائم، فيُعرف المحتوى بمنصاته بطاقةً واحدة لا بطاقةً لكل
 * منصة. استعلامٌ فرعيّ على `p` بفهرس `idx_schedules_post` (0033)، ويجاور
 * `planned_platforms` الذي تقرؤه الواجهة معه.
 */
export const SCHEDULED_PLATFORMS_SQL =
  '(SELECT group_concat(DISTINCT sp.platform) FROM schedules sp WHERE sp.post_id = p.id) AS scheduled_platforms';

/** «فكرة»: مسودةٌ لم يُكتب نصّها. والنصّ الفارغ مطبَّعٌ إلى '' عند كل كتابة. */
export function isIdeaRow(p: { status: string; body: string | null }): boolean {
  return p.status === 'draft' && (p.body ?? '') === '';
}
