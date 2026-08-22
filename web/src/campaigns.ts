/* ============================================================
   مفردات الحملة — منقولةٌ من naf-terms.md §٣ «حالات الحملة»
   و«حقول الحملة»، وألوانها وأيقوناتها من naf-icons.md.

   لا تُعدَّل هنا. المصطلح يُسجَّل في السجلّ أولاً ثم يُنقل إلى هذا
   الملفّ — وهو ما لم يحدث في الصفحة القديمة، فكتبت خريطتها المحلّية
   وصبغتها شارةً ثنائية: نشطةٌ خضراء وما عداها رمادي.
   ============================================================ */

/* حالات الحملة الأربع — نظيرُها في الخادم `CampaignStatus` في
   src/types.ts، والقيم هي قيد CHECK في migrations/0001_init.sql. */
export type CampaignStatus = 'planned' | 'active' | 'completed' | 'archived';

export const CAMPAIGN_STATUS_LABELS: Record<string, string> = {
  planned: 'مخطّطة',
  active: 'نشطة',
  completed: 'مكتملة',
  archived: 'مؤرشفة',
};

/** رموز الشارات في `styles.css`. «مكتملة» blue لا green — الاكتمال
    انقضاءُ مدّةٍ لا حكمٌ بالنجاح، والحكم يقوله «ضمن المستهدف» وحده. */
export const CAMPAIGN_STATUS_BADGE: Record<string, string> = {
  planned: 'gray',
  active: 'green',
  completed: 'blue',
  archived: 'gray',
};

/** ترتيب العرض — مسار الحملة لا الأبجدية. */
export const CAMPAIGN_STATUSES: CampaignStatus[] = ['planned', 'active', 'completed', 'archived'];

/**
 * منصات الحملة من عمودها النصّي.
 *
 * الحقل JSON في القاعدة، وكانت الصفحة تنادي `JSON.parse` عليه مرّتين
 * داخل التصيير بلا حارس — فصفٌّ واحدٌ مشوَّه يُبيّض الشاشة كلها.
 */
export function parsePlatforms(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * ما بقي من مدّة الحملة بالأيام.
 *
 * **اليوم الجاري يُعدّ يوماً باقياً.** فحملةٌ تنتهي اليوم تُقرأ «متبقٍ يوم»
 * لا «صفر»، وحملةٌ تنتهي بعد ثلاثة أيام تُقرأ أربعة — ثلاثةٌ كاملة وما بقي
 * من اليوم. والقارئ يخطّط بأيام عملٍ لا بفرقٍ حسابيّ بين تاريخين.
 *
 * و`null` حين لا نهاية مسجّلة أو كان التاريخ غير صالح — لا صفراً: حملةٌ
 * بلا تاريخ انتهاء ليست حملةً انتهت اليوم، والسطر لا يُعرض أصلاً.
 */
export function daysRemaining(endDate: string | null | undefined, now = new Date()): number | null {
  if (!endDate) return null;
  const end = new Date(`${endDate}T23:59:59Z`).getTime();
  if (Number.isNaN(end)) return null;
  return Math.ceil((end - now.getTime()) / 86_400_000);
}
