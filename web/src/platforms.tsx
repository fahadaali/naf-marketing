import type { ReactNode } from 'react';
import { Linkedin, Instagram, Facebook, Youtube, Ghost, Music2, AtSign, Globe } from 'lucide-react';

// بيانات المنصات: التسمية العربية، اللون الرسمي، والأيقونة.
// المنصات المعروفة لها أيقونات وألوان رسمية؛ المنصات المخصّصة تأخذ أيقونة عامة.
export type PlatformMeta = {
  label: string;
  color: string;        // اللون الرسمي (خلفية الأيقونة)
  fg?: string;          // لون الرمز (افتراضي أبيض)
  gradient?: string;    // تدرّج (إنستغرام)
  glyph: ReactNode;
};

const g = (size: number) => size;

function XGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <path d="M5 5l14 14M19 5L5 19" />
    </svg>
  );
}

export const PLATFORM_META: Record<string, PlatformMeta> = {
  linkedin: { label: 'لينكدإن', color: '#0A66C2', glyph: <Linkedin size={g(15)} /> },
  linkedin_page: { label: 'لينكدإن (صفحة)', color: '#0A66C2', glyph: <Linkedin size={g(15)} /> },
  x: { label: 'إكس', color: '#000000', glyph: <XGlyph size={14} /> },
  instagram: {
    label: 'إنستغرام',
    color: '#DD2A7B',
    gradient: 'linear-gradient(45deg,#F58529,#DD2A7B,#8134AF,#515BD4)',
    glyph: <Instagram size={g(15)} />,
  },
  snapchat: { label: 'سناب شات', color: '#FFFC00', fg: '#111', glyph: <Ghost size={g(15)} /> },
  tiktok: { label: 'تيك توك', color: '#010101', glyph: <Music2 size={g(14)} /> },
  facebook: { label: 'فيسبوك', color: '#1877F2', glyph: <Facebook size={g(15)} /> },
  youtube: { label: 'يوتيوب', color: '#FF0000', glyph: <Youtube size={g(15)} /> },
  threads: { label: 'ثريدز', color: '#000000', glyph: <AtSign size={g(15)} /> },
};

// المنصات المعروفة القابلة للإضافة من الإعدادات
export const KNOWN_PLATFORMS = Object.keys(PLATFORM_META);

// توجيهات افتراضية لكل منصة عند التوليد بالذكاء الاصطناعي (تُطابق الخادم)
export const DEFAULT_PLATFORM_PROMPTS: Record<string, string> = {
  linkedin: 'محتوى مهني رصين يناسب لينكدإن والقطاع القانوني، بفقرات قصيرة ولغة موثوقة.',
  linkedin_page: 'محتوى مهني رصين لصفحة منظمة على لينكدإن، بلغة مؤسسية موثوقة وفقرات قصيرة.',
  x: 'منشور موجز جداً يناسب منصة إكس (لا يتجاوز ٢٨٠ حرفاً)، مباشر وجذّاب، ويمكن إضافة وسم واحد أو اثنين.',
  instagram: 'أسلوب جذّاب بصرياً بسطور قصيرة وإيموجي مناسب باعتدال، مع وسوم (hashtags) ملائمة في النهاية.',
  snapchat: 'رسالة قصيرة عفوية ومباشرة تناسب سناب شات.',
  tiktok: 'نص قصير حيوي يناسب تيك توك مع دعوة واضحة للتفاعل.',
  facebook: 'منشور ودّي متوسط الطول يناسب فيسبوك.',
  youtube: 'وصف مناسب ليوتيوب مع نقاط رئيسية موجزة.',
  threads: 'منشور محادثاتي قصير يناسب ثريدز.',
};

export function platformLabel(key: string, custom?: Record<string, string>): string {
  return custom?.[key] || PLATFORM_META[key]?.label || key;
}

// أيقونة منصة داخل رقعة ملوّنة بلونها الرسمي
export function PlatformIcon({ platform, size = 24 }: { platform: string; size?: number }) {
  const meta = PLATFORM_META[platform];
  const style: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: Math.round(size * 0.28),
    display: 'grid',
    placeItems: 'center',
    color: meta?.fg || '#fff',
    background: meta?.gradient || meta?.color || 'hsl(var(--muted-foreground))',
    flexShrink: 0,
  };
  return <span style={style}>{meta?.glyph || <Globe size={Math.round(size * 0.62)} />}</span>;
}

// شارة منصة: أيقونة + تسمية
export function PlatformTag({
  platform,
  custom,
  size = 20,
}: {
  platform: string;
  custom?: Record<string, string>;
  size?: number;
}) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <PlatformIcon platform={platform} size={size} />
      <span>{platformLabel(platform, custom)}</span>
    </span>
  );
}
