/* ============================================================
   مرآة قيم قالب البريد وسمته — نسخة طبق الأصل من
   `src/services/emailTheme.ts` و`src/services/blockStyle.ts`.

   لا يمكن استيراد ملفات الخادم هنا (حزمتان منفصلتان)، فالنسخ مقصود
   وموضعه واحد — كما كان `EMAIL_PREVIEW` في `Newsletters.tsx` قبل أن
   يحتاج المحرر إلى اللوحة كاملةً. أي تغيير هناك يُنقل هنا، وإلا كذبت
   المعاينة ومنتقي الألوان على ما يصل المشترك.

   استثناء قوالب البريد — CLAUDE.md §1.
   ============================================================ */

export const EMAIL = {
  primary: '#937133',
  primaryForeground: '#FFFFFF',
  primarySoft: '#EFEAE2',
  primaryStrong: '#937133',
  background: '#E8EBED',
  card: '#FFFFFF',
  foreground: '#333333',
  mutedForeground: '#646A78',
  border: '#D9D9D9',
  muted: '#F9FAFB',
  info: '#1B7DB4',
  infoStrong: '#006EA4',
  infoSoft: '#E1EDF5',
  warning: '#A76900',
  warningStrong: '#975A00',
  warningSoft: '#F3EADD',
  radius: '12px',
  fontStack: "system-ui,-apple-system,'Segoe UI',Tahoma,sans-serif",
} as const;

export type Align = 'start' | 'center' | 'end';
export type SizeStep = 'sm' | 'md' | 'lg' | 'xl';
export type RadiusStep = 'none' | 'sm' | 'md' | 'full';
export type Weight = 400 | 500 | 600 | 700;

export type BlockStyle = {
  color?: string;
  background?: string;
  border?: string;
  align?: Align;
  size?: SizeStep;
  weight?: Weight;
  radius?: RadiusStep;
  full?: boolean;
};

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

export const WIDTH_PX: Record<NewsletterTheme['width'], number> = { narrow: 520, normal: 640, wide: 760 };
export const RADIUS_PX: Record<RadiusStep, string> = { none: '0', sm: '6px', md: EMAIL.radius, full: '999px' };
export const BODY_PX: Record<NewsletterTheme['size'], number> = { sm: 15, md: 16, lg: 18 };

/** لوحة الألوان المعروضة للكاتب — مرايا الرموز وحدها، ولا لون يُخترع هنا. */
export const SWATCHES: { value: string; label: string }[] = [
  { value: EMAIL.primary, label: 'الأساسي' },
  { value: EMAIL.primarySoft, label: 'الأساسي الهادئ' },
  { value: EMAIL.info, label: 'معلومة' },
  { value: EMAIL.infoStrong, label: 'معلومة داكن' },
  { value: EMAIL.infoSoft, label: 'معلومة هادئ' },
  { value: EMAIL.warning, label: 'تحذير' },
  { value: EMAIL.warningStrong, label: 'تحذير داكن' },
  { value: EMAIL.warningSoft, label: 'تحذير هادئ' },
  { value: EMAIL.foreground, label: 'المتن' },
  { value: EMAIL.mutedForeground, label: 'ثانوي' },
  { value: EMAIL.border, label: 'الحدّ' },
  { value: EMAIL.muted, label: 'سطح هادئ' },
  { value: EMAIL.card, label: 'أبيض' },
  { value: EMAIL.background, label: 'رمادي فاتح' },
];

/* الألفاظ من naf-terms.md §١٤ — «تخصيص مظهر الكتلة» و«سمة النشرة». */
export const ALIGN_LABEL: Record<Align, string> = {
  start: 'بداية السطر', center: 'الوسط', end: 'نهاية السطر',
};
export const SIZE_LABEL: Record<SizeStep, string> = {
  sm: 'صغير', md: 'متوسط', lg: 'كبير', xl: 'كبير جداً',
};
export const WEIGHT_LABEL: Record<Weight, string> = {
  400: 'عادي', 500: 'متوسط', 600: 'شبه غامق', 700: 'غامق',
};
export const RADIUS_LABEL: Record<RadiusStep, string> = {
  none: 'بلا', sm: 'خفيفة', md: 'معتادة', full: 'كاملة',
};
export const WIDTH_LABEL: Record<NewsletterTheme['width'], string> = {
  narrow: 'ضيّق', normal: 'معتاد', wide: 'عريض',
};

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** نفس محقّق الخادم حرفياً — الواجهة لا تُرسل ما سيسقط هناك صامتاً. */
export function hexColor(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!HEX.test(s)) return '';
  if (s.length === 4) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toUpperCase();
  return s.toUpperCase();
}

export function parseTheme(json: string | null | undefined): NewsletterTheme {
  let raw: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(json || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) raw = parsed;
  } catch { /* سمة تالفة تعود إلى الافتراضي */ }
  const t = { ...DEFAULT_THEME };
  for (const k of ['pageBackground', 'cardBackground', 'text', 'heading', 'link',
    'buttonBackground', 'buttonText', 'border'] as const) {
    const c = hexColor(raw[k]);
    if (c) t[k] = c;
  }
  if (['narrow', 'normal', 'wide'].includes(String(raw.width))) t.width = raw.width as NewsletterTheme['width'];
  if (['none', 'sm', 'md', 'full'].includes(String(raw.radius))) t.radius = raw.radius as RadiusStep;
  if (['sm', 'md', 'lg'].includes(String(raw.size))) t.size = raw.size as NewsletterTheme['size'];
  return t;
}

export function isCustomTheme(t: NewsletterTheme): boolean {
  return (Object.keys(DEFAULT_THEME) as (keyof NewsletterTheme)[]).some((k) => t[k] !== DEFAULT_THEME[k]);
}

/** تخصيصٌ فارغ يُحذف بدل أن يُخزَّن كائناً بلا مفاتيح. */
export function cleanStyle(s: BlockStyle | undefined): BlockStyle | undefined {
  if (!s) return undefined;
  const out: BlockStyle = {};
  for (const [k, v] of Object.entries(s)) {
    if (v === undefined || v === '' || v === false) continue;
    (out as any)[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}
