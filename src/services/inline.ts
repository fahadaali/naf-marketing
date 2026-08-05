import { EMAIL } from './emailTheme';

/* ===== التنسيق داخل الفقرة =====

   الكتل تحمل نصّاً خاماً، لا HTML. الكاتب يكتب علامات قليلة معدودة
   والمصيّر يحوّلها — لا العكس.

   ولماذا لا نخزّن HTML من حقل contentEditable؟ لأن ذلك يعني تعقيم
   HTML وارد من المتصفح قبل حقنه في رسالة بريد تُفتح في عميلٍ لا
   نتحكّم به. المُعقِّم الذي يخطئ مرة واحدة يرسل الخطأ إلى كل مشترك.
   العلامات أدناه مجموعة مغلقة: ما لم يُذكر هنا يبقى نصّاً مهرّباً.

   الترتيب مقصود ومكتوب في renderInline. */

/** يهرّب كل ما له معنى في HTML. أساس كل ما تحته — لا شيء يتخطّاه. */
export function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* المخططات المسموحة وحدها. أي رابط آخر — وأخطرها `javascript:` —
   يُعرض نصّاً ولا يصير رابطاً. القائمة بيضاء لا سوداء عمداً: القائمة
   السوداء تُلتفّ حولها، والبيضاء تُغلق. */
const SAFE_SCHEME = /^(?:https?:\/\/|mailto:)/i;

/* علامة نائبة تحفظ الرابط من معالجة الغامق والمائل بعده — رابط يحمل
   نجمة في مساره كان يتكسّر بلا هذه الخطوة. U+0000 لا يظهر في نصّ
   يكتبه إنسان، ويُنزع من المدخل قبل أي شيء احتياطاً. */
const SLOT = '\u0000';

function linkHtml(href: string, label: string, inline: boolean): string {
  // البريد لا يقرأ ورقة أنماط خارجية، فالرابط يحمل لونه سطرياً —
  // استثناء قوالب البريد، CLAUDE.md §1. القيمة من emailTheme.ts.
  const st = inline ? ` style="color:${EMAIL.primary};text-decoration:underline"` : '';
  return `<a href="${href}"${st}>${label}</a>`;
}

/**
 * يحوّل نصّ فقرة إلى HTML: تهريب كامل، ثم مجموعة علامات مغلقة.
 *
 *   `[نص](https://…)`  رابط        `**نصّ**`  غامق
 *   `__نصّ__`           تسطير       `*نصّ*`    مائل
 *
 * والروابط العارية تُربط تلقائياً. `inline` يعني وجهة البريد.
 */
export function renderInline(text: string, inline: boolean): string {
  const src = String(text ?? '').split(SLOT).join('');
  let out = escapeHtml(src);

  // ١. الروابط المكتوبة أولاً، وتُحفظ في نائبات حتى لا يمسّها ما بعدها.
  //    عنوان الرابط مهرَّب أصلاً، فـ`&` صارت `&amp;` — وهي الصيغة
  //    الصحيحة داخل خاصية href لا خطأً يُصحَّح.
  const links: string[] = [];
  out = out.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (whole, label: string, href: string) => {
    if (!SAFE_SCHEME.test(href)) return whole; // يبقى نصّاً ظاهراً كما كتبه الكاتب
    links.push(linkHtml(href, label, inline));
    return `${SLOT}${links.length - 1}${SLOT}`;
  });

  // ٢. الغامق قبل المائل — `**نصّ**` تلتقطها قاعدة النجمة الواحدة خطأً لو سبقت.
  out = out
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_\n]+)__/g, '<u>$1</u>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>');

  // ٣. الروابط العارية. الترقيم اللاصق في آخر الرابط يخرج منه:
  //    «راجع https://naf.sa.» نقطتها نهاية جملة لا جزء من المسار.
  out = out.replace(/(https?:\/\/[^\s<]+)/g, (url: string) => {
    const trail = url.match(/[.,;:!?)،؛؟]+$/);
    const clean = trail ? url.slice(0, -trail[0].length) : url;
    return linkHtml(clean, clean, inline) + (trail ? trail[0] : '');
  });

  // ٤. إعادة الروابط المكتوبة إلى مواضعها.
  return out.replace(new RegExp(`${SLOT}(\\d+)${SLOT}`, 'g'), (_m, i: string) => links[Number(i)] ?? '');
}

/**
 * يجرّد العلامات ويُبقي النصّ — للمقتطف ومنشورات التواصل.
 * الرابط يصير نصّه الظاهر: «اقرأ الدليل» لا `[اقرأ الدليل](https://…)`.
 */
export function stripInline(text: string): string {
  return String(text ?? '')
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, '$1')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1');
}
