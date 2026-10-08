/* مسار المحتوى بين حالاته — دوالّ صافية بلا React، تُختبر من `test/` كما تُختبر
   `campaigns.ts`. كانت أعمدة اللوحة وقاعدة نقلها داخل `PostKanban.tsx`، فلا
   يصلها اختبارٌ إلا بتصيير المكوّن. */

/** أعمدة لوحة المحتوى بحالاتها المعروضة. «فكرة» أوّلها: مسودةٌ لم يُكتب نصّها بعد. */
export const KANBAN_COLS: { key: string; statuses: string[] }[] = [
  { key: 'idea', statuses: ['idea'] },
  { key: 'draft', statuses: ['draft'] },
  { key: 'rejected', statuses: ['rejected'] },
  { key: 'pending_marketing', statuses: ['pending_marketing'] },
  { key: 'pending_gm', statuses: ['pending_gm'] },
  { key: 'approved', statuses: ['approved'] },
  { key: 'scheduled', statuses: ['scheduled', 'late'] },
  { key: 'published', statuses: ['published'] },
  { key: 'archived', statuses: ['archived'] },
];

/**
 * الإجراء الذي يقابل نقل بطاقةٍ من حالتها **المعروضة** إلى عمود، أو `null` إن كان
 * الانتقال ممنوعاً. يحترم تسلسل الاعتماد — والخادم يتحقّق منه كذلك، وهذا حارسٌ
 * للقارئ لا حاجزٌ أمني.
 *
 * والفكرة لا تُنقل إلى عمودٍ ولا منه: تصير مسودةً حين يُكتب نصّها، لا بسحب. ولذلك
 * تُمرَّر الحالة المعروضة لا `post.status` — فالفكرة في قاعدة البيانات «مسودة».
 */
export function moveAction(from: string, toCol: string): 'submit' | 'approve' | 'reject' | 'archive' | null {
  if (toCol === 'pending_marketing' && ['draft', 'rejected'].includes(from)) return 'submit';
  if (toCol === 'pending_gm' && from === 'pending_marketing') return 'approve';
  if (toCol === 'approved' && from === 'pending_gm') return 'approve';
  if (toCol === 'rejected' && ['pending_marketing', 'pending_gm'].includes(from)) return 'reject';
  if (toCol === 'archived' && from === 'published') return 'archive';
  return null;
}

/**
 * أيفتح سحبُ البطاقة إلى «مجدول» نافذةَ الجدولة في المحرر؟
 *
 * الجدولة لا تتمّ بسحب: تحتاج موعداً ومنصات. فسحبُ المعتمد إلى عمودها يوصل
 * إلى حيث تُجدوَل بدل رسالة منع. وما لم يُعتمد بعد يبقى ممنوعاً — تجاوزٌ
 * لمراحل الاعتماد — والمعتمد وحده هو ما يُظهر له المحرّر زرّ «جدولة النشر».
 */
export function opensScheduling(from: string, toCol: string): boolean {
  return toCol === 'scheduled' && from === 'approved';
}

// محارف الاتجاه والفواصل الصفرية — لا تُرى ولا تُعدّ نصّاً
const INVISIBLE = /[​-‏⁠-⁩﻿]/g;

/**
 * نصّ المحرّر فارغٌ في المعنى: لا كلمة بعد نزع الوسوم والمسافات والمحارف الخفيّة،
 * ولا وسيط. صورةٌ من `isBlankBody` في الخادم (`src/util.ts`) لتقرّر الشاشة قبل
 * الحفظ — والخادم هو الحكم: يطبّع الفارغ إلى '' ويردّ الإرسال.
 */
export function isBlankHtml(html: string | null | undefined): boolean {
  if (!html) return true;
  if (/data-media-id=|\/api\/media\/|<(img|video|audio|iframe|embed|object)\b/i.test(html)) return false;
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ');
  return text.replace(INVISIBLE, '').trim() === '';
}
