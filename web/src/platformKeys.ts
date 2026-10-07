/* مفاتيح المنصات وترتيبها — دوالّ صافية بلا React، تُختبر من `test/` كما تُختبر
   `campaigns.ts`. والرسم (الشعار ورقعته وتسميته) في `platforms.tsx`. */

import { parsePlatforms } from './campaigns';

/** المنصات المعروفة بترتيب العرض: صفّ الشعارات يتبعه أينما ظهر، فلا يختلف بين بطاقتين. */
export const PLATFORM_KEYS = [
  'linkedin', 'linkedin_page', 'x', 'google', 'instagram', 'snapchat', 'tiktok', 'facebook', 'youtube', 'threads',
] as const;

export type PlatformKey = (typeof PLATFORM_KEYS)[number];

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

/** موحَّدةً بلا تكرار، المعروفة بترتيبها ثم المخصّصة أبجدياً. */
export function sortPlatforms(keys: readonly string[]): string[] {
  const unique = [...new Set(keys.map(normalizePlatform).filter(Boolean))];
  const rank = (k: string) => {
    const i = (PLATFORM_KEYS as readonly string[]).indexOf(k);
    return i < 0 ? PLATFORM_KEYS.length : i;
  };
  return unique.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/**
 * منصات المحتوى: المجدولة فعلاً (`scheduled_platforms`، «linkedin,x» من الخادم)
 * والمخطّطة (`planned_platforms`، JSON). المسودة بلا موعدٍ ولا خطة لا منصات لها،
 * فلا يُرسم لها صفّ شعارات.
 */
export function platformsOf(post: { scheduled_platforms?: string | null; planned_platforms?: string | null }): string[] {
  const scheduled = (post.scheduled_platforms || '').split(',').map((p) => p.trim());
  return sortPlatforms([...scheduled, ...parsePlatforms(post.planned_platforms)]);
}
