import type { ReactNode } from 'react';
import { Linkedin, Instagram, Facebook, Youtube, Ghost, Music2, AtSign, Globe, MapPin } from 'lucide-react';

// بيانات المنصات: التسمية العربية، اللون الرسمي، والأيقونة.
// المنصات المعروفة لها أيقونات وألوان رسمية؛ المنصات المخصّصة تأخذ أيقونة عامة.
// ألوان العلامات من رموز --brand-* في ثيم ناف — استثناء منصوص عليه في CLAUDE.md §1،
// ولا تُستعمل هذه الرموز لأي عنصر واجهة آخر.
export type PlatformMeta = {
  label: string;
  color: string;        // اللون الرسمي (خلفية الأيقونة)
  fg?: string;          // لون الرمز (افتراضي أبيض)
  gradient?: string;    // تدرّج (إنستغرام)
  glyph: (size: number) => ReactNode;
};

// رمز العلامة يتبع حجم الرقعة بدل مقاس ثابت. الرقعة نفسها تأخذ أحد مقاسات
// naf-icons.md الثلاثة من موضع الاستدعاء؛ وهذه نسبة رسم داخلية لا مقاس أيقونة.
const g = (size: number) => Math.round(size * 0.62);

function XGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <path d="M5 5l14 14M19 5L5 19" />
    </svg>
  );
}

export const PLATFORM_META: Record<string, PlatformMeta> = {
  linkedin: { label: 'لينكدإن', color: 'var(--brand-linkedin)', glyph: (s) => <Linkedin size={g(s)} /> },
  linkedin_page: { label: 'لينكدإن (صفحة)', color: 'var(--brand-linkedin)', glyph: (s) => <Linkedin size={g(s)} /> },
  x: { label: 'إكس', color: 'var(--brand-x)', glyph: (s) => <XGlyph size={g(s)} /> },
  // نشاط تجاري على الخرائط → MapPin. لا Star: هي للتقييم حصراً — naf-icons#v1.4.0
  google: { label: 'نشاطي التجاري (Google)', color: 'var(--brand-google)', glyph: (s) => <MapPin size={g(s)} /> },
  instagram: {
    label: 'إنستغرام',
    color: 'var(--brand-instagram)',
    gradient: 'var(--brand-instagram-gradient)',
    glyph: (s) => <Instagram size={g(s)} />,
  },
  snapchat: { label: 'سناب شات', color: 'var(--brand-snapchat)', fg: 'var(--brand-snapchat-foreground)', glyph: (s) => <Ghost size={g(s)} /> },
  tiktok: { label: 'تيك توك', color: 'var(--brand-tiktok)', glyph: (s) => <Music2 size={g(s)} /> },
  facebook: { label: 'فيسبوك', color: 'var(--brand-facebook)', glyph: (s) => <Facebook size={g(s)} /> },
  youtube: { label: 'يوتيوب', color: 'var(--brand-youtube)', glyph: (s) => <Youtube size={g(s)} /> },
  threads: { label: 'ثريدز', color: 'var(--brand-threads)', glyph: (s) => <AtSign size={g(s)} /> },
};

// المنصات المعروفة القابلة للإضافة من الإعدادات
// (المرادفات مستبعدة — تُعرض بمفتاحها الأساسي فقط)
export const KNOWN_PLATFORMS = Object.keys(PLATFORM_META).filter((k) => k !== 'google');

// مرادفات المزوّدين → مفاتيح المنصات لدينا.
// المزوّدون (SocialAPI/Buffer) يستخدمون تسميات مختلفة عن مفاتيحنا، فتظهر خام بلا أيقونة
// إن لم تُوحَّد — مثل twitter بدل x، وgooglebusiness بدل google.
const PLATFORM_ALIASES: Record<string, string> = {
  twitter: 'x',
  'twitter.com': 'x',
  googlebusiness: 'google',
  google_business: 'google',
  gbp: 'google',
  linkedinpage: 'linkedin_page',
  'linkedin-page': 'linkedin_page',
  ig: 'instagram',
  fb: 'facebook',
  yt: 'youtube',
};

// يوحّد مفتاح المنصة أياً كان مصدره (المزوّد أو الإعدادات)
export function normalizePlatform(key: string): string {
  const k = String(key || '').toLowerCase().trim();
  return PLATFORM_ALIASES[k] || k;
}

// توجيهات افتراضية لكل منصة عند التوليد بالذكاء الاصطناعي (تُطابق الخادم)
export const DEFAULT_PLATFORM_PROMPTS: Record<string, string> = {
  linkedin: 'محتوى مهني رصين يناسب لينكدإن والقطاع القانوني، بفقرات قصيرة ولغة موثوقة.',
  linkedin_page: 'محتوى مهني رصين لصفحة منظمة على لينكدإن، بلغة مؤسسية موثوقة وفقرات قصيرة.',
  x: 'منشور موجز جداً يناسب منصة إكس (لا يتجاوز 280 حرفاً)، مباشر وجذّاب، ويمكن إضافة وسم واحد أو اثنين.',
  instagram: 'أسلوب جذّاب بصرياً بسطور قصيرة وإيموجي مناسب باعتدال، مع وسوم (hashtags) ملائمة في النهاية.',
  snapchat: 'رسالة قصيرة عفوية ومباشرة تناسب سناب شات.',
  tiktok: 'نص قصير حيوي يناسب تيك توك مع دعوة واضحة للتفاعل.',
  facebook: 'منشور ودّي متوسط الطول يناسب فيسبوك.',
  youtube: 'وصف مناسب ليوتيوب مع نقاط رئيسية موجزة.',
  threads: 'منشور محادثاتي قصير يناسب ثريدز.',
};

export function platformLabel(key: string, custom?: Record<string, string>): string {
  const k = normalizePlatform(key);
  return custom?.[key] || custom?.[k] || PLATFORM_META[k]?.label || key;
}

// أيقونة منصة داخل رقعة ملوّنة بلونها الرسمي
export function PlatformIcon({ platform, size = 24 }: { platform: string; size?: number }) {
  const meta = PLATFORM_META[normalizePlatform(platform)];
  const style: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: Math.round(size * 0.28),
    display: 'grid',
    placeItems: 'center',
    // الأبيض جزء من علامة المنصة نفسها لا من ثيم ناف: الخلفية لون علامة
    // ثابت في الوضعين، فرمز الثيم هنا ينقلب خطأً في الوضع الداكن.
    // يقع ضمن استثناء ألوان العلامات الخارجية — CLAUDE.md §1.
    color: meta?.fg || '#fff',
    background: meta?.gradient || meta?.color || 'var(--muted-foreground)',
    flexShrink: 0,
  };
  return <span style={style}>{meta ? meta.glyph(size) : <Globe size={g(size)} />}</span>;
}
