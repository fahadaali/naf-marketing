/* ===== أرقام الإدخال =====

   المنصة تعرض الأرقام الغربية دائماً (CLAUDE.md §٨)، لكن من يكتب بلوحة
   مفاتيح عربية يكتب الهندية: «١٤:٣٠» أو «۱۴:۳۰» (الفارسية). وحقلُ الوقت كان
   `type="time"` فلا يقبل منها شيئاً. فما يُكتب يُحوَّل هنا إلى 0–9 قبل أن
   يُقرأ — تحويلُ إدخالٍ لا تنسيقُ عرض، فمكانه هنا لا في naf-format. */

/** الهندية (٠–٩) والفارسية (۰–۹) إلى الغربية؛ وما عداها كما هو. */
export function toLatinDigits(s: string): string {
  return (s || '').replace(/[٠-٩۰-۹]/g, (d) => {
    const c = d.charCodeAt(0);
    return String(c - (c >= 0x06f0 ? 0x06f0 : 0x0660));
  });
}

/**
 * وقتٌ بنظام ٢٤ ساعة كما يُكتب: «14:30» و«١٤:٣٠» و«9:05» و«1430» و«٩» —
 * والفاصل نقطتان أو نقطة أو الفاصلة العشرية العربية «٫». يردّ «HH:mm» أو
 * `null` إن لم يكن وقتاً.
 */
export function parseTime24(input: string): string | null {
  const s = toLatinDigits(input).trim().replace(/[.٫،,]/g, ':');
  let h: number;
  let m: number;
  let match = /^(\d{1,2}):(\d{1,2})$/.exec(s);
  if (match) {
    h = Number(match[1]);
    m = Number(match[2]);
  } else if ((match = /^(\d{3,4})$/.exec(s))) {
    h = Number(match[1].slice(0, -2));
    m = Number(match[1].slice(-2));
  } else if ((match = /^(\d{1,2})$/.exec(s))) {
    h = Number(match[1]);
    m = 0;
  } else {
    return null;
  }
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
