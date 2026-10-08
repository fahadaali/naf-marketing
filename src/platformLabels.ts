import type { Env } from './types';

/* ═══ أسماء منصات التواصل في الخادم ═══

   naf-terms §٣ «أسماء منصات التواصل». منسوخةٌ هنا كما نُسخت مفردات التقرير
   (`services/report.ts`): الإشعارات والبريد والتقرير ورسائل المزوّد تُكتب في
   الخادم وفي `Cron` بلا متصفّح، وخريطة الواجهة (`web/src/platforms.tsx`) لا
   يستوردها الخادم. وكانت هذه كلّها تكتب المفتاح: «فشل نشر منشور — x: …»،
   و«تقييم سلبي على google»، و«جدولة على: x, linkedin». */

export const PLATFORM_AR: Record<string, string> = {
  linkedin: 'لينكدإن',
  linkedin_page: 'لينكدإن (صفحة)',
  x: 'إكس',
  // اسم العلامة لاتينيٌّ معزول الاتجاه داخل القوسين، كما في الواجهة
  google: 'نشاطي التجاري (⁨Google⁩)',
  instagram: 'إنستغرام',
  snapchat: 'سناب شات',
  tiktok: 'تيك توك',
  facebook: 'فيسبوك',
  youtube: 'يوتيوب',
  threads: 'ثريدز',
};

// مرادفات المزوّدين ← مفاتيحنا — الخريطة نفسها في `web/src/platformKeys.ts`
const ALIASES: Record<string, string> = {
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

export function normalizePlatformKey(key: string): string {
  const k = String(key || '').toLowerCase().trim();
  return ALIASES[k] || k;
}

/**
 * اسم المنصة كما يُكتب للقارئ: الاسم المخصّص من الإعدادات أولاً (منصةٌ أضافها
 * المدير العام)، ثم الاسم المسجّل، ثم المفتاح نفسه لمنصةٍ لا اسم لها.
 */
export function platformName(key: string, custom: Record<string, string> = {}): string {
  const k = normalizePlatformKey(key);
  return custom[key] || custom[k] || PLATFORM_AR[k] || key;
}

/** أسماء منصاتٍ متعدّدة بالفاصلة العربية — naf-terms «ملاحظة الجدولة». */
export function platformNames(keys: readonly string[], custom: Record<string, string> = {}): string {
  return keys.map((k) => platformName(k, custom)).join('، ');
}

/** الأسماء المخصّصة من الإعدادات (`platform_labels`). والقراءة تسقط صامتةً إلى لا شيء. */
export async function customPlatformLabels(env: Env): Promise<Record<string, string>> {
  try {
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'platform_labels'")
      .first<{ value: string }>();
    const parsed = row?.value ? JSON.parse(row.value) : null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    // اسمٌ نصّيٌّ غير فارغ وحده — وما سواه يسقط إلى الاسم المسجّل
    return Object.fromEntries(
      Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === 'string' && e[1].trim() !== ''),
    );
  } catch {
    return {};
  }
}

const SCHEDULE_PREFIX = 'جدولة على:';

/** ملاحظة الجدولة في سجلّ الاعتماد: «جدولة على: إكس، لينكدإن». */
export function scheduleNote(platforms: readonly string[], custom: Record<string, string> = {}): string {
  return `${SCHEDULE_PREFIX} ${platformNames(platforms, custom)}`;
}

/**
 * ملاحظةٌ كما تُعرض: ملاحظات الجدولة القديمة كُتبت بالمفاتيح («جدولة على: x,
 * linkedin») فتُقرأ بالأسماء، والجديدة أسماءٌ أصلاً فتمرّ كما هي. وما سواها —
 * سبب رفضٍ كتبه مراجع — لا يُمسّ.
 */
export function noteForDisplay(note: string | null | undefined, custom: Record<string, string> = {}): string {
  if (!note) return '';
  if (!note.startsWith(SCHEDULE_PREFIX)) return note;
  const names = note.slice(SCHEDULE_PREFIX.length).split(/[,،]/).map((p) => p.trim()).filter(Boolean);
  return scheduleNote(names, custom);
}
