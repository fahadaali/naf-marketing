import { useEffect, useState, type ReactNode } from 'react';
import { Globe, MapPin } from 'lucide-react';
import {
  XMark, TikTokMark, SnapchatMark, ThreadsMark,
  FacebookMark, YouTubeMark, InstagramMark, LinkedInMark,
} from './components/brand/brand-marks';
import { type PlatformKey, normalizePlatform } from './platformKeys';
import { api } from './api';

export { normalizePlatform, platformsOf, sortPlatforms } from './platformKeys';

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

export const PLATFORM_META: Record<string, PlatformMeta> = ({
  linkedin: { label: 'لينكدإن', color: 'var(--brand-linkedin)', glyph: (s) => <LinkedInMark size={g(s)} /> },
  linkedin_page: { label: 'لينكدإن (صفحة)', color: 'var(--brand-linkedin)', glyph: (s) => <LinkedInMark size={g(s)} /> },
  x: { label: 'إكس', color: 'var(--brand-x)', glyph: (s) => <XMark size={g(s)} /> },
  // نشاط تجاري على الخرائط → MapPin. لا Star: هي للتقييم حصراً — naf-icons#v1.4.0
  google: { label: 'نشاطي التجاري (\u2068Google\u2069)', color: 'var(--brand-google)', glyph: (s) => <MapPin size={g(s)} /> },
  instagram: {
    label: 'إنستغرام',
    color: 'var(--brand-instagram)',
    gradient: 'var(--brand-instagram-gradient)',
    glyph: (s) => <InstagramMark size={g(s)} />,
  },
  snapchat: { label: 'سناب شات', color: 'var(--brand-snapchat)', fg: 'var(--brand-snapchat-foreground)', glyph: (s) => <SnapchatMark size={g(s)} /> },
  tiktok: { label: 'تيك توك', color: 'var(--brand-tiktok)', glyph: (s) => <TikTokMark size={g(s)} /> },
  facebook: { label: 'فيسبوك', color: 'var(--brand-facebook)', glyph: (s) => <FacebookMark size={g(s)} /> },
  youtube: { label: 'يوتيوب', color: 'var(--brand-youtube)', glyph: (s) => <YouTubeMark size={g(s)} /> },
  threads: { label: 'ثريدز', color: 'var(--brand-threads)', glyph: (s) => <ThreadsMark size={g(s)} /> },
}) satisfies Record<PlatformKey, PlatformMeta>;

// المنصات المعروفة القابلة للإضافة من الإعدادات
// (المرادفات مستبعدة — تُعرض بمفتاحها الأساسي فقط)
export const KNOWN_PLATFORMS = Object.keys(PLATFORM_META).filter((k) => k !== 'google');

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

// أيقونة منصة داخل رقعة ملوّنة بلونها الرسمي.
//
// وبجانب اسمٍ مكتوب تكون زينةً لا يقرؤها قارئ الشاشة (`aria-hidden`)، وإلا قرأ
// الاسم مرتين. ووحدها يُمرَّر لها `title`: فتصير صورةً مسمّاةً وتلميحاً عند المرور
// — الاسم يبقى تسميةً حين يغيب نصّه (naf-terms.md، «كل المنصات»).
export function PlatformIcon({ platform, size = 24, title }: { platform: string; size?: number; title?: string }) {
  const meta = PLATFORM_META[normalizePlatform(platform)];
  const style: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: Math.round(size * 0.28),
    display: 'grid',
    placeItems: 'center',
    // مقدّمة رقعة العلامة من رمز السجلّ: بيضاء في الوضعين لأن الخلفية
    // لون علامة ثابت لا سطح ثيم — naf-theme#v1.10.0. والمنصة المخصّصة لا علامة
    // لها، فرقعتها سطحٌ دلالي: `--brand-on-color` للعلامات وحدها، وأبيضُه على
    // `--muted-foreground` في الداكن دون التباين المطلوب.
    color: meta ? meta.fg || 'var(--brand-on-color)' : 'var(--muted-foreground)',
    background: meta ? meta.gradient || meta.color : 'var(--muted)',
    flexShrink: 0,
  };
  const name = title ? { role: 'img', 'aria-label': title, title } : { 'aria-hidden': true };
  return <span style={style} {...name}>{meta ? meta.glyph(size) : <Globe size={g(size)} />}</span>;
}

/* تسميات المنصات المخصّصة من الإعدادات (`platform_labels`) — تُجلب مرّةً في الجلسة
   وتتشاركها كل الصفوف. وبدونها تُسمّى المنصة المخصّصة بمفتاحها الخام. والصمت قرار:
   غيابُها يُبقي المفتاح ولا يُسقط شاشة. */
let labelsOnce: Promise<Record<string, string>> | null = null;

export function usePlatformLabels(): Record<string, string> | undefined {
  const [labels, setLabels] = useState<Record<string, string>>();
  useEffect(() => {
    let live = true;
    labelsOnce ||= api.get('/settings')
      .then((d) => (d.settings?.platform_labels as Record<string, string>) || {})
      .catch(() => ({}));
    labelsOnce.then((l) => { if (live) setLabels(l); });
    return () => { live = false; };
  }, []);
  return labels;
}

/**
 * صفّ شعارات منصات المحتوى — أعلى بطاقته أو فوق عنوانه في الجدول، فيُعرف المحتوى
 * الواحد بمنصاته بطاقةً واحدة لا بطاقةً لكل منصة. لا شيء حين لا منصات.
 */
export function PlatformIcons({
  platforms, size = 16, custom,
}: { platforms: string[]; size?: number; custom?: Record<string, string> }) {
  const fetched = usePlatformLabels();
  if (!platforms.length) return null;
  const labels = custom ?? fetched;
  return (
    <span className="row platform-row">
      {platforms.map((p) => <PlatformIcon key={p} platform={p} size={size} title={platformLabel(p, labels)} />)}
    </span>
  );
}
