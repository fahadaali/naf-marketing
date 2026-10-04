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
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'",
};

export function htmlToText(html: string): string {
  if (!html) return '';
  // لا وسوم أصلاً — نصّ عادي كما هو
  if (!/<[a-z!/]/i.test(html)) return html.trim();
  let s = html;
  s = s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ''); // محتوى غير مرئي
  /* بطاقة الوسيط في المحرر (`mediaEmbedHtml`) تحمل اسم الملف ووصفه نصّاً:
     «VIDdownload-….mp4 فيديو • اضغط للاستعراض». وكان يُنشر مع المنشور كأنه
     من كلامه. والوسيط نفسه يُرفق من معرّفه لا من هذا النص، فيُحذف بأصنافه —
     لا بشكل البطاقة كلّها، كي لا يتعلّق بترتيب السمات. */
  s = s.replace(/<(span|div)\b[^>]*\bclass="[^"]*\bmedia-(?:cap|sub|ic)\b[^"]*"[^>]*>[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|li|h[1-6]|figure|figcaption|blockquote|tr)>/gi, '\n');
  s = s.replace(/<li[^>]*>/gi, '• ');
  s = s.replace(/<[^>]+>/g, ''); // بقية الوسوم
  for (const [ent, ch] of Object.entries(HTML_ENTITIES)) s = s.split(ent).join(ch);
  s = s.replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)));
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n'); // تنظيف الفراغات
  return s.trim();
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
