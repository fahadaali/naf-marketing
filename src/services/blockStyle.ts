import { EMAIL } from './emailTheme';

/* ============================================================
   تخصيص مظهر النشرة — الألوان والمحاذاة والأحجام التي يختارها الكاتب.

   ولماذا لا يخالف هذا §1 من CLAUDE.md؟ لأن القيمة هنا **محتوى** لا
   رمزٌ في نظام التصميم: لونٌ يختاره الكاتب لفقرةٍ في نشرته يُخزَّن في
   `blocks_json` بجانب نصّها، ولا يُكتب في شيفرة ولا في ورقة أنماط.
   الشيفرة تبقى بلا قيمة خام: الافتراضيات كلّها من `emailTheme.ts` —
   ملف المرايا الحرفية الوحيد، واستثناء قوالب البريد نفسه.

   وهذا الملف هو الشرط الذي يجعل ذلك سليماً، لا مجرّد وصف له:

   ١) **لا لون يصل خاصية `style` بلا تحقّق.** كل قيمة تمرّ على
      `hexColor`، وما لم يطابق `#RGB` أو `#RRGGBB` يسقط كأنه لم
      يُكتب. القيمة تُحقن في `style="…"` داخل رسالةٍ تُفتح في عميلٍ لا
      نتحكّم به — و`background:url(javascript:…)` بابٌ يُغلق هنا مرة
      واحدة بدل أن يُنسى في موضع من عشرين.

   ٢) **ما ليس لوناً مجموعةٌ مغلقة.** المحاذاة والحجم والثقل
      والاستدارة قيمُها معدودة هنا، فلا يخترع الكاتب مقاساً خارج
      السلّم ولا تصل قيمةٌ غريبة إلى الناتج.

   ٣) **كتلةٌ بلا تخصيص تُصيَّر كما كانت حرفياً.** الدوال تعيد نصّاً
      فارغاً حين لا يختار الكاتب شيئاً، فلا تنتفخ الرسالة بأنماطٍ
      تكرّر الافتراضي.
   ============================================================ */

export type Align = 'start' | 'center' | 'end';
export type SizeStep = 'sm' | 'md' | 'lg' | 'xl';
export type RadiusStep = 'none' | 'sm' | 'md' | 'full';
export type Weight = 400 | 500 | 600 | 700;

/** تخصيص كتلةٍ واحدة. كلّه اختياري، وغيابه يعني «اتبع السمة». */
export type BlockStyle = {
  /** لون النصّ */
  color?: string;
  /** لون سطح الكتلة */
  background?: string;
  /** لون الحدّ — للبطاقة والجدول والفاصل */
  border?: string;
  align?: Align;
  size?: SizeStep;
  weight?: Weight;
  /** استدارة الحواف — للزر والصورة والكتل ذات السطح */
  radius?: RadiusStep;
  /** زرٌّ يمتدّ بعرض العمود */
  full?: boolean;
};

const ALIGNS: Align[] = ['start', 'center', 'end'];
const SIZES: SizeStep[] = ['sm', 'md', 'lg', 'xl'];
const RADII: RadiusStep[] = ['none', 'sm', 'md', 'full'];
const WEIGHTS: Weight[] = [400, 500, 600, 700];

/* ===== الألوان =====

   القائمة بيضاء لا سوداء، كما في مخططات الروابط: `#` ثم ثلاث أو ستّ
   خاناتٍ ستّ عشرية وانتهى. `rgb()` و`hsl()` و`color-mix()` وأسماء
   الألوان كلّها تسقط — لا لأنها خطرة بذاتها، بل لأن قبول صيغةٍ ثانية
   يعني مُحلِّلاً ثانياً، ومُحلِّلٌ ثانٍ هو الثغرة. */
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** يعيد لوناً صالحاً أو نصّاً فارغاً. لا استثناء ولا قيمة افتراضية. */
export function hexColor(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!HEX.test(s)) return '';
  // ثلاث خانات تُمدّ إلى ستّ: بعض عملاء البريد القديمة لا تقرأ المختصرة
  if (s.length === 4) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toUpperCase();
  return s.toUpperCase();
}

/** ينظّف تخصيصاً وارداً من الواجهة أو من ملف قالب مستورد. */
export function parseStyle(v: unknown): BlockStyle | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const raw = v as Record<string, unknown>;
  const out: BlockStyle = {};
  const color = hexColor(raw.color);
  const background = hexColor(raw.background);
  const border = hexColor(raw.border);
  if (color) out.color = color;
  if (background) out.background = background;
  if (border) out.border = border;
  if (ALIGNS.includes(raw.align as Align)) out.align = raw.align as Align;
  if (SIZES.includes(raw.size as SizeStep)) out.size = raw.size as SizeStep;
  if (RADII.includes(raw.radius as RadiusStep)) out.radius = raw.radius as RadiusStep;
  if (WEIGHTS.includes(Number(raw.weight) as Weight)) out.weight = Number(raw.weight) as Weight;
  if (raw.full === true) out.full = true;
  return Object.keys(out).length ? out : undefined;
}

/* ===== السمة =====

   ما يحيط بالكتل: خلفية الصفحة وسطح البطاقة وعرضها ولون المتن
   والعناوين والروابط والأزرار. كتلةٌ لا تخصّص شيئاً ترث من هنا.

   والقيم الافتراضية كلّها من `EMAIL` — أي من رموز naf-theme في وضعها
   الفاتح. فنشرةٌ لم يلمس كاتبها السمة تخرج كما كانت تخرج قبل هذا
   الملف، بايتاً ببايت. */
export type NewsletterTheme = {
  pageBackground: string;
  cardBackground: string;
  text: string;
  heading: string;
  link: string;
  buttonBackground: string;
  buttonText: string;
  border: string;
  width: 'narrow' | 'normal' | 'wide';
  radius: RadiusStep;
  size: 'sm' | 'md' | 'lg';
};

export const DEFAULT_THEME: NewsletterTheme = {
  pageBackground: EMAIL.background,
  cardBackground: EMAIL.card,
  text: EMAIL.foreground,
  heading: EMAIL.foreground,
  link: EMAIL.primary,
  buttonBackground: EMAIL.primary,
  buttonText: EMAIL.primaryForeground,
  border: EMAIL.border,
  width: 'normal',
  radius: 'md',
  size: 'md',
};

const WIDTHS: NewsletterTheme['width'][] = ['narrow', 'normal', 'wide'];
const BASE_SIZES: NewsletterTheme['size'][] = ['sm', 'md', 'lg'];

/** عرض بطاقة الرسالة بالبكسل — `max-width` لا عرضٌ ثابت. */
export const WIDTH_PX: Record<NewsletterTheme['width'], number> = {
  narrow: 520, normal: 640, wide: 760,
};

/** الاستدارة بالبكسل. `calc()` غير مضمون في عملاء البريد، فالقيم صريحة. */
export const RADIUS_PX: Record<RadiusStep, string> = {
  none: '0', sm: '6px', md: EMAIL.radius, full: '999px',
};

/** مقياس المتن — البريد بالبكسل، والويب من سلّم الرموز. */
const BODY_PX: Record<NewsletterTheme['size'], number> = { sm: 15, md: 16, lg: 18 };

/** خطوات حجم الكتلة بالبكسل، منسوبةً إلى مقياس المتن في السمة. */
export function sizePx(step: SizeStep, base: number): number {
  const factor: Record<SizeStep, number> = { sm: 0.875, md: 1, lg: 1.2, xl: 1.45 };
  return Math.round(base * factor[step]);
}

/** رمز الحجم في الويب — من السلّم المسجّل في naf-theme.css لا بقيمة. */
const WEB_SIZE: Record<SizeStep, string> = {
  sm: 'var(--text-sm)', md: 'var(--text-base)', lg: 'var(--text-lg)', xl: 'var(--text-xl)',
};

export function parseTheme(json: string | null | undefined): NewsletterTheme {
  let raw: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(json || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) raw = parsed;
  } catch { /* سمة تالفة تعود إلى الافتراضي — نشرةٌ بلا ألوان خير من نشرةٍ لا تُفتح */ }

  const t = { ...DEFAULT_THEME };
  const colorKeys = ['pageBackground', 'cardBackground', 'text', 'heading', 'link',
    'buttonBackground', 'buttonText', 'border'] as const;
  for (const k of colorKeys) {
    const c = hexColor(raw[k]);
    if (c) t[k] = c;
  }
  if (WIDTHS.includes(raw.width as NewsletterTheme['width'])) t.width = raw.width as NewsletterTheme['width'];
  if (RADII.includes(raw.radius as RadiusStep)) t.radius = raw.radius as RadiusStep;
  if (BASE_SIZES.includes(raw.size as NewsletterTheme['size'])) t.size = raw.size as NewsletterTheme['size'];
  return t;
}

/** هل غيّر الكاتب شيئاً؟ تقرؤها الصفحة العامة لتقرّر أتفرض لوحة الرسالة أم تترك ثيم الموقع. */
export function isCustomTheme(t: NewsletterTheme): boolean {
  return (Object.keys(DEFAULT_THEME) as (keyof NewsletterTheme)[]).some((k) => t[k] !== DEFAULT_THEME[k]);
}

/** حجم المتن بالبكسل حسب السمة — أساسُ كل خطوات الحجم في الرسالة. */
export function baseSize(t: NewsletterTheme): number {
  return BODY_PX[t.size];
}

/* ===== بناء الأنماط =====

   دالّتان لا واحدة، لأن الوجهتين تختلفان في أمرين لا في الصياغة:
   البريد يكتب القيمة بالبكسل ويكتب الجهة فيزيائيةً (`text-align:right`)
   لأن العملاء المكتبية لا تقرأ الخصائص المنطقية — وهو الاستثناء نفسه
   المكتوب في `newsletter.ts` على الجدول والاقتباس. والويب يكتب رمز
   السلّم والجهة المنطقية. */

/** جهة المحاذاة في البريد. الرسالة `dir="rtl"`، فالبداية يمين. */
function alignPhysical(a: Align): string {
  return a === 'center' ? 'center' : a === 'end' ? 'left' : 'right';
}

export type StyleCtx = {
  /** وجهة البريد: أنماط سطرية بقيم حرفية */
  inline: boolean;
  theme: NewsletterTheme;
};

/* الحبر والسطح مفصولان لأن موضعهما في الوسم مختلف لا لأن التصنيف أنيق:
   لون الحروف وحجمها وثقلها تعيش على `<p>` نفسه، والخلفية والحشوة
   والاستدارة والمحاذاة تعيش على الحاوية. وكتلةُ نصٍّ بفقرتين وخلفيةٍ
   واحدة تُخرج صندوقين لو كتبنا الخلفية على كل فقرة. */

/** لون الحروف وحجمها وثقلها. */
export function inkDecls(style: BlockStyle | undefined, ctx: StyleCtx): string {
  if (!style) return '';
  const d: string[] = [];
  if (style.color) d.push(`color:${style.color}`);
  if (style.size) {
    d.push(ctx.inline
      ? `font-size:${sizePx(style.size, baseSize(ctx.theme))}px`
      : `font-size:${WEB_SIZE[style.size]}`);
  }
  if (style.weight) d.push(`font-weight:${style.weight}`);
  return d.join(';');
}

/** الخلفية والحدّ والاستدارة والمحاذاة. */
export function surfaceDecls(style: BlockStyle | undefined, ctx: StyleCtx): string {
  if (!style) return '';
  const d: string[] = [];
  if (style.background) {
    d.push(`background:${style.background}`);
    // نصٌّ ملتصقٌ بحدّ اللون يُقرأ بصعوبة — الحشوة تأتي مع الصبغ لا بطلبٍ ثانٍ
    d.push('padding:12px 14px');
  }
  if (style.border) d.push(`border:1px solid ${style.border}`);
  if (style.radius) d.push(`border-radius:${RADIUS_PX[style.radius]}`);
  else if (style.background) d.push(`border-radius:${RADIUS_PX[ctx.theme.radius]}`);
  if (style.align) d.push(`text-align:${ctx.inline ? alignPhysical(style.align) : style.align}`);
  return d.join(';');
}

/** يضمّ تعريفات مبنيّة في الشيفرة إلى تخصيص الكاتب — والكاتب آخراً فيغلب. */
export function mergeDecls(...parts: (string | undefined)[]): string {
  return parts.map((s) => (s || '').replace(/;+$/, '')).filter(Boolean).join(';');
}

/** يلفّ التعريفات في خاصية `style`، أو لا شيء حين لا تعريف. */
export function styleAttr(decls: string): string {
  return decls ? ` style="${decls}"` : '';
}

/** محاذاة وحدها — للحاويات التي لا تقبل سطحاً، كفقرة الزر. */
export function alignDecl(style: BlockStyle | undefined, ctx: StyleCtx): string {
  if (!style?.align) return '';
  return `text-align:${ctx.inline ? alignPhysical(style.align) : style.align}`;
}
