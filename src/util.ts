// أدوات مساعدة عامة

export function newId(prefix = ''): string {
  const id = crypto.randomUUID().replace(/-/g, '');
  return prefix ? `${prefix}_${id}` : id;
}

/**
 * أكبر وسيطٍ يُرفع إلى المكتبة ويُنشر: ١٠٠ ميغابايت — وهو كذلك حدّ جسم الطلب
 * في كلاودفلير للخطّتين المجانية والاحترافية، فلا يُقبل هنا ما تردّه الحافة.
 * ومزوّد النشر قد يقبل أقلّ منه: حدُّه على خادمه لا هنا.
 */
export const MAX_MEDIA_BYTES = 100 * 1024 * 1024;

export function nowIso(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/* ═══ كان هنا نظام تجزئة كلمات المرور ═══

   ‏`hashPassword` و`verifyPassword` وأدواتهما الأربع — أربعةٌ وأربعون
   سطراً من PBKDF2 — بلا مستدعٍ في المستودع كلّه. آخر قارئ لهما كان
   الدخول المحلي، وقد أُغلق حين صارت المصادقة كلُّها في المركز
   (`src/routes/auth.ts`). وبقي الرمز يوحي بأن ثمّة دخولاً بكلمة مرور،
   وليس ثمّة.

   و`password_hash` يبقى عموداً في `users` — قيمته `''` لمستخدم الدخول
   الموحّد، وهاشٌ فارغ لا يطابق شيئاً. الهجرات للأمام فقط، والعمود
   NOT NULL فلا يُحذف. */

// ===== تحويل محتوى المحرر (HTML) إلى نص صالح للنشر على المنصات =====
// المحرر غنيّ ويُخزّن HTML؛ نشره كما هو يُظهر الوسوم حرفياً في المنشور.
const HTML_ENTITIES: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
};

/** فكّ الكيانات في مرورٍ واحد — فـ`&amp;lt;` يصير `&lt;` لا `<`. والمسافة غير الفاصلة مسافة. */
function decodeEntities(s: string): string {
  return s
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
      }
      return HTML_ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\u00a0/g, ' ');
}

const BLOCK_TAGS = 'p|div|li|ul|ol|h[1-6]|blockquote|figure|figcaption|tr|table|section|article|pre';
const OPEN = '\u0001';
const CLOSE = '\u0002';
const EMBED = '\u0003';

/* ما يُنشر هو ما يُرى في المحرر، سطراً بسطر.

   كان يكتفي بإغلاق الكتلة سطراً جديداً، والمتصفح يكتب أول سطرٍ في المحرر
   نصّاً مجرّداً وما بعده في `<div>` — فيلتصق السطر الأول بالثاني. وكان يختصر
   كل سطرين فارغين فأكثر إلى سطرٍ واحد، ويترك `&nbsp;` حرفياً في نصٍّ بلا وسوم.
   فتغيّرت مسافات المنشور وأسطره على كل منصة، لا على إكس ولينكدإن وحدهما.

   والقاعدة الآن قاعدة المتصفح: الكتلة تبدأ سطراً وتنهيه، والكتلة الفارغة
   (`<div><br></div>`) سطرٌ فارغ، و`<br>` الأخير في كتلةٍ حاملُ مكانٍ لا سطر.
   والأسطر الفارغة تبقى بعددها كما كُتبت. وبطاقة الوسيط لا نصّ لها: تفصل ما
   قبلها عمّا بعدها ولا تزيد سطراً — الوسيط يُرفق من معرّفه. */
export function htmlToText(html: string): string {
  if (!html) return '';
  // لا وسوم أصلاً — نصّ عادي كما هو، وكياناته تُفكّ
  if (!/<[a-z!/]/i.test(html)) return decodeEntities(html).trim();
  let s = html;
  s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ''); // محتوى غير مرئي
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  /* بطاقة الوسيط في المحرر (`mediaEmbedHtml`) تحمل اسم الملف ووصفه نصّاً:
     «VIDdownload-….mp4 فيديو • اضغط للاستعراض». وكان يُنشر مع المنشور كأنه
     من كلامه. والوسيط نفسه يُرفق من معرّفه لا من هذا النص، فيُحذف بأصنافه —
     لا بشكل البطاقة كلّها، كي لا يتعلّق بترتيب السمات. */
  s = s.replace(/<(span|div)\b[^>]*\bclass="[^"]*\bmedia-(?:cap|sub|ic)\b[^"]*"[^>]*>[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<div\b[^>]*\bclass="[^"]*\bmedia-embed\b[^"]*"[^>]*>/gi, EMBED);
  // القائمة المرقّمة بأرقامها — الأعمق أولاً
  for (let prev = ''; prev !== s;) {
    prev = s;
    s = s.replace(/<ol\b[^>]*>((?:(?!<ol\b)[\s\S])*?)<\/ol>/i, (_m, inner: string) => {
      let n = 0;
      return OPEN + inner.replace(/<li\b[^>]*>/gi, () => `${OPEN}${++n}. `) + CLOSE;
    });
  }
  s = s.replace(/<li\b[^>]*>/gi, `${OPEN}• `);
  // <br> الأخير في الكتلة حاملُ مكانٍ يتركه المتصفح فيها — لا سطر
  s = s.replace(
    new RegExp(`<br\\s*\\/?>(?=(?:\\s|<\\/(?:span|b|strong|i|em|u|ins|s|a|font|mark)>)*<\\/(?:${BLOCK_TAGS})>)`, 'gi'),
    '',
  );
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(new RegExp(`<(?:${BLOCK_TAGS})\\b[^>]*>`, 'gi'), OPEN);
  s = s.replace(new RegExp(`<\\/(?:${BLOCK_TAGS})>`, 'gi'), CLOSE);
  s = s.replace(/<[^>]+>/g, ''); // بقية الوسوم
  // فراغُ الشيفرة بين الكتل (`<ul>\n  <li>`) ليس من الكلام
  s = s.replace(/([\u0001\u0002\u0003])\s+(?=[\u0001\u0002\u0003])/g, '$1');
  s = decodeEntities(s);

  let out = '';
  let openLine = false; // في السطر الجاري شيءٌ — حرفٌ، أو <br> بدأه
  let empty = false; // كتلةٌ فُتحت ولم يُكتب فيها شيء بعد
  const stack: boolean[] = []; // لكل كتلةٍ مفتوحة: أهي بطاقة وسيط؟
  for (const ch of s) {
    if (ch === OPEN || ch === EMBED) {
      if (openLine) { out += '\n'; openLine = false; }
      stack.push(ch === EMBED);
      empty = ch === OPEN;
    } else if (ch === CLOSE) {
      const embed = stack.pop() ?? false;
      if (openLine || (empty && !embed)) out += '\n';
      openLine = false;
      empty = false;
    } else {
      out += ch;
      openLine = true;
      empty = false;
    }
  }
  return out.replace(/[ \t]+\n/g, '\n').trim();
}

// يستخرج معرّفات الوسائط المضمّنة في محتوى المحرر (روابط /api/media/<id>)
export function extractMediaIds(html: string): string[] {
  const out: string[] = [];
  const re = /\/api\/media\/([A-Za-z0-9_-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html || '')) !== null) {
    const id = m[1];
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/* ═══ النصّ الفارغ ═══

   المحرر يترك بعد مسح ما فيه وسوماً بلا نصّ — `<br>` أو `<div><br></div>` —
   فلا يُعرف المحتوى الفارغ بمقارنة نصّه بـ''. و«فكرة» حالةٌ مشتقّة من
   `status = 'draft' AND body = ''`، فيُطبَّع الفارغ إلى '' عند كل كتابة ويصحّ
   الاشتقاق في SQL كما في الواجهة. والوسيط وحده محتوى: منشورٌ بصورةٍ بلا
   كلمة ليس فارغاً. ومحارف الاتجاه والوصل لا تُرى، فلا تُعدّ نصّاً.
   و`&nbsp;` وحدها — ما يتركه مسافةٌ في محررٍ فارغ — لا يفكّها `htmlToText`
   حين لا وسم معها، فتُفكّ هنا. */
const INVISIBLE = /[​-‏⁠-⁩﻿]/g;

export function isBlankBody(html: unknown): boolean {
  if (typeof html !== 'string' || !html) return true;
  if (/data-media-id=|<(img|video|audio|iframe|embed|object)\b/i.test(html) || extractMediaIds(html).length) {
    return false;
  }
  const text = htmlToText(html.replace(/&nbsp;|&#160;|&#xa0;/gi, ' '));
  return text.replace(INVISIBLE, '').trim() === '';
}

/** ما يُخزَّن في `body`: النصّ كما هو، أو '' إن كان فارغاً في المعنى. */
export function normalizeBody(v: unknown): string {
  return typeof v === 'string' && !isBlankBody(v) ? v : '';
}
