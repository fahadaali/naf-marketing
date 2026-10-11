/* سببُ فشل النشر يجمع جملةً عربية منّا ورسالةَ المزوّد الإنجليزية كما ردّها:
   «فشل النشر عبر Ayrshare: twitter: Error accessing the media. …».

   وكان يُعرض في عزلٍ واحد باتجاه الصفحة، فتلتفّ الفقرة الإنجليزية من اليمين
   وتقفز نقطتها الأخيرة إلى أول السطر («.12.56MB»). فيُفصل هنا الجزء العربي
   عن رسالة المزوّد، لتُعرض الرسالة في سطرٍ بعده باتجاهها هي. */

const ARABIC = /[؀-ۿ]/;

/**
 * الجزء العربي من السبب، ورسالة المزوّد بعده إن كانت لاتينيةً خالصة.
 * والقطع عند أول «: » يليه نصٌّ يبدأ بحرفٍ لاتيني ولا حرف عربيّ فيه —
 * وسببٌ عربيٌّ كلُّه (كالفحص المسبق) يبقى كما هو.
 */
export function splitProviderReason(reason: string): { ar: string; ltr: string } {
  let i = reason.indexOf(': ');
  while (i !== -1) {
    const rest = reason.slice(i + 2);
    if (/^[A-Za-z]/.test(rest) && !ARABIC.test(rest)) return { ar: reason.slice(0, i), ltr: rest };
    i = reason.indexOf(': ', i + 2);
  }
  return { ar: reason, ltr: '' };
}
