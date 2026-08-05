import { EMAIL, hexColor } from './newsletterTheme';
import type { Parsed } from './markSource';

/* ============================================================
   تلوين علامات المحرر خلف الحقل النصّي.

   الكتلة تحفظ نصّاً خاماً بعلاماتٍ مغلقة — وهذا أساس أمان المحرر
   كلّه: لا HTML من المتصفح، ولا مُعقِّم يُخطئ مرّةً فيرسل خطأه إلى كل
   مشترك (`src/services/inline.ts`). لكن الكاتب كان يدفع الثمن كاملاً:
   كلمةٌ ملوّنة تعني اثني عشر حرفاً من العلامة حولها، وفقرةٌ فيها
   ثلاثة ألوان تصير غير مقروءة.

   فالحلّ طبقةٌ خلف الحقل لا تغيير في التخزين: `<div>` يحمل **نفس
   الحروف** ويطبّق عليها الألوان، و`<textarea>` شفّاف النصّ فوقه يحمل
   المؤشّر والتحديد. الكاتب يرى ألوانه، والعلامة تخفت ولا تختفي.

   **القاعدة التي تحكم كل سطر هنا: لا يجوز أن يتغيّر مقاس حرف واحد.**
   الطبقتان تلتزمان الالتفاف نفسه والترتيب ثنائيّ الاتجاه نفسه، فأي
   تنسيق يغيّر العرض — `font-weight` أو `font-size` أو `letter-spacing`
   — يزيح النصّ عن المؤشّر بمقدارٍ يتراكم مع كل كلمة. فالمسموح هنا
   اللون والخلفية والتسطير وظلُّ النصّ وحدها؛ كلّها تصبغ ولا تقيس.

   ولهذا يبقى الغامق بظلّ نصٍّ لا بثقل خط: `font-weight: 700` يوسّع
   الحرف، والظلّ يُثخّنه في مكانه.
   ============================================================ */

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* العلامات نفسها التي يقرؤها `renderInline` في الخادم، بالترتيب نفسه:
   الرابط أولاً كي لا تلتقط قاعدةُ النجمة نجمةً في مساره، ثم اللون، ثم
   الغامق قبل المائل. ولا يُعاد التحقّق من الروابط هنا: هذه طبقةُ عرضٍ
   للكاتب لا مصيّرٌ للقارئ — والحكم النهائي في الخادم كما كان. */
const LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
const COLOR = /\{([ch]):(#[0-9a-fA-F]{3,6})\|([^{}\n]+)\}/g;
const BOLD = /\*\*([^*\n]+)\*\*/g;
const UNDER = /__([^_\n]+)__/g;
const ITALIC = /\*([^*\n]+)\*/g;

/** علامةٌ باهتة — تبقى مقروءةً لمن يبحث عنها، وتخرج من طريق من يقرأ. */
const syn = (s: string) => `<span class="mk-syn">${s}</span>`;

/**
 * يحوّل نصّ الحقل إلى HTML للطبقة الخلفية. الحروف كما هي حرفاً بحرف —
 * لا حذف ولا إضافة — والفرق في الصبغ وحده.
 */
export function highlightMarks(value: string): string {
  let out = escapeHtml(value);

  out = out.replace(LINK, (_w, label: string, href: string) =>
    `${syn('[')}<span class="mk-link">${label}</span>${syn(`](${href})`)}`);

  /* الكلمة الملوّنة تُعرض على **سطح الرسالة** لا على سطح المنصة.

     الرسالة فاتحة دائماً في كل عميل بريد تقريباً، والمنصة تتبع وضع
     القارئ. فبلا هذا السطر تُعرض كلمةٌ ظُلّلت بلون فاتح على سطحٍ داكن
     بلون متن المنصة الفاتح — أي فاتحٌ على فاتح، لا يُقرأ. وقِيس ذلك
     في الوضع الداكن لا استُنتج.

     فالخلفية والمقدّمة تُكتبان معاً من مرآة قيم البريد: الكاتب يرى ما
     سيصل المشترك بالضبط، في وضعَي المنصة كليهما. */
  out = out.replace(COLOR, (whole, kind: string, raw: string, body: string) => {
    const color = hexColor(raw);
    // لونٌ لا يطابق الصيغة يبقى نصّاً كما هو — تماماً كما سيصنع الخادم
    if (!color) return whole;
    const style = kind === 'h'
      ? `background-color:${color};color:${EMAIL.foreground}`
      : `color:${color};background-color:${EMAIL.card}`;
    return `${syn(`{${kind}:${raw}|`)}<span style="${style}">${body}</span>${syn('}')}`;
  });

  out = out
    .replace(BOLD, (_w, t: string) => `${syn('**')}<span class="mk-b">${t}</span>${syn('**')}`)
    .replace(UNDER, (_w, t: string) => `${syn('__')}<span class="mk-u">${t}</span>${syn('__')}`)
    .replace(ITALIC, (_w, t: string) => `${syn('*')}<span class="mk-i">${t}</span>${syn('*')}`);

  /* سطرٌ أخير فارغ لا يرسمه المتصفح في `<div>` ويحجز مكانه في
     `<textarea>`. فبلا هذا الحرف تنقص الطبقةُ سطراً عند نهاية النصّ
     بسطر جديد، ويعلو المؤشّر عن كلامه. */
  return `${out}\n`;
}

/* ===== الطبقة في وضع «العلامات مخفية» =====

   هناك يحمل الحقل النصّ النظيف، فتُبنى الطبقة من الحروف نفسها ومن
   أنماطها المحفوظة في `parseMarks`. لا علامة تُعرض، والمحاذاة مضمونة
   لأن الحروف واحدة في الطبقتين.

   والألوان تُعرض على سطح الرسالة لا سطح المنصة — للسبب المشروح أعلاه. */
export function highlightClean(p: Parsed): string {
  let out = '';
  let i = 0;
  const key = (n: number) => {
    const st = p.styles[n] || {};
    return [st.color || '', st.bg || '', st.bold ? 'b' : '', st.italic ? 'i' : '',
      st.under ? 'u' : '', st.link ? 'l' : ''].join('|');
  };
  while (i < p.clean.length) {
    const k = key(i);
    let j = i + 1;
    while (j < p.clean.length && key(j) === k) j++;
    const st = p.styles[i] || {};
    const text = escapeHtml(p.clean.slice(i, j));
    const cls = [st.bold && 'mk-b', st.italic && 'mk-i', st.under && 'mk-u', st.link && 'mk-link']
      .filter(Boolean).join(' ');
    const style = st.bg
      ? `background-color:${st.bg};color:${EMAIL.foreground}`
      : st.color ? `color:${st.color};background-color:${EMAIL.card}` : '';
    out += (cls || style)
      ? `<span${cls ? ` class="${cls}"` : ''}${style ? ` style="${style}"` : ''}>${text}</span>`
      : text;
    i = j;
  }
  return `${out}\n`;
}
