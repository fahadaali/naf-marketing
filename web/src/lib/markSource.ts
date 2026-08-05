/* ============================================================
   المصدر المعلَّم والنصّ النظيف — وجهان لنصٍّ واحد.

   الكتلة تحفظ نصّاً بعلاماتٍ مغلقة (`{c:#937133|نصّ}`)، وهذا ما يصل
   الخادم ولا يتغيّر. لكن الكاتب لا يريد أن يرى العلامة وهو يكتب: كلمةٌ
   ملوّنة تعني اثني عشر حرفاً حولها، وفقرةٌ بثلاثة ألوان تصير غير
   مقروءة.

   فالحقل يعرض **النصّ النظيف** — بلا علامة واحدة — والعلامات تبقى في
   المصدر. وبينهما خريطة: `map[i]` موضعُ الحرف النظيف رقم `i` في
   المصدر المعلَّم. بها يُترجَم كل تحرير وكل تحديد من إحداثيات ما يراه
   الكاتب إلى إحداثيات ما يُخزَّن.

   ولماذا لا نخزّن «نصّاً وقائمةَ مدايات» ونستغني عن العلامات؟ لأن
   المخزَّن يقرؤه الخادم والمصيّر والمستورد والمصدّر، وتغييرُ صيغته
   يمسّها كلّها — والعلامة صيغةٌ مغلقة تُقرأ بلا مُعقِّم. فالتغيير هنا
   في العرض وحده، والتخزين كما هو حرفاً بحرف.

   والقواعد أدناه هي قواعد `renderInline` في الخادم نفسها وبترتيبها:
   الرابط أولاً كي لا تلتقط قاعدةُ النجمة نجمةً في مساره، ثم اللون، ثم
   الغامق قبل المائل. أي اختلافٍ هنا يعني نصّاً يُعرض غير ما يُرسل.
   ============================================================ */

export type CharStyle = {
  /** لون الحروف */
  color?: string;
  /** لون الخلفية — التظليل */
  bg?: string;
  bold?: boolean;
  italic?: boolean;
  under?: boolean;
  link?: boolean;
};

/** مدى علامةٍ في المصدر: حدودها كاملةً، ومتنها بينها. */
export type MarkSpan = { start: number; end: number; bodyStart: number; bodyEnd: number };

export type Parsed = {
  /** النصّ كما يراه الكاتب — بلا علامة واحدة */
  clean: string;
  /** موضع كل حرف نظيف في المصدر المعلَّم */
  map: number[];
  /** نمط كل حرف نظيف */
  styles: CharStyle[];
  /** كل علامةٍ عُرفت، بحدودها ومتنها */
  marks: MarkSpan[];
};

const COLOR = /\{([ch]):(#[0-9a-fA-F]{3,6})\|([^{}\n]+)\}/g;
const LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
const BOLD = /\*\*([^*\n]+)\*\*/g;
const UNDER = /__([^_\n]+)__/g;
const ITALIC = /\*([^*\n]+)\*/g;

/**
 * يفصل المصدر المعلَّم إلى نصٍّ نظيف وخريطةٍ وأنماط.
 *
 * الطريقة: يُعلَّم كل حرفٍ في المصدر إمّا **حدَّ علامة** فيسقط من
 * النظيف، وإمّا حرفَ متنٍ فيُنقل بنمطه. والعلامة التي يقع حدُّها داخل
 * علامةٍ أخرى تُترك كما هي — لا تداخل إلا ما يقبله المصيّر.
 */
export function parseMarks(marked: string): Parsed {
  const n = marked.length;
  const isDelim = new Array<boolean>(n).fill(false);
  const styles = Array.from({ length: n }, (): CharStyle => ({}));
  const marks: MarkSpan[] = [];

  /** يضع الحدود ويطبّق النمط على المتن، ما لم يكن الموضع محجوزاً. */
  const take = (re: RegExp, apply: (s: CharStyle, m: RegExpExecArray) => void, bodyGroup: number) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(marked))) {
      const start = m.index;
      const end = start + m[0].length;
      // حدٌّ سبق أن حُجز يعني تداخلاً — تُترك المطابقة كما هي
      let free = true;
      for (let i = start; i < end; i++) if (isDelim[i]) { free = false; break; }
      if (!free) {
        /* المطابقة المرفوضة لا تُقدّم المؤشّر إلى آخرها: نجمتا الغامق
           تلتقطهما قاعدةُ المائل فتُرفض، ولو قفزنا خلفها ضاع كل مائلٍ
           بعدها في السطر. نستأنف من الحرف التالي لبدايتها. */
        re.lastIndex = start + 1;
        continue;
      }

      const body = m[bodyGroup];
      const bodyStart = marked.indexOf(body, start);
      const bodyEnd = bodyStart + body.length;
      for (let i = start; i < bodyStart; i++) isDelim[i] = true;
      for (let i = bodyEnd; i < end; i++) isDelim[i] = true;
      for (let i = bodyStart; i < bodyEnd; i++) apply(styles[i], m);
      marks.push({ start, end, bodyStart, bodyEnd });
    }
  };

  take(LINK, (s) => { s.link = true; }, 1);
  take(COLOR, (s, m) => {
    if (m[1] === 'h') s.bg = m[2]; else s.color = m[2];
  }, 3);
  take(BOLD, (s) => { s.bold = true; }, 1);
  take(UNDER, (s) => { s.under = true; }, 1);
  take(ITALIC, (s) => { s.italic = true; }, 1);

  const chars: string[] = [];
  const map: number[] = [];
  const out: CharStyle[] = [];
  for (let i = 0; i < n; i++) {
    if (isDelim[i]) continue;
    chars.push(marked[i]);
    map.push(i);
    out.push(styles[i]);
  }
  return { clean: chars.join(''), map, styles: out, marks };
}

/** موضعُ حرفٍ نظيف في المصدر — وآخرُ المصدر لما بعد آخر حرف. */
export function toSource(p: Parsed, cleanIndex: number, marked: string): number {
  if (cleanIndex <= 0) return p.map.length ? p.map[0] : 0;
  if (cleanIndex >= p.map.length) return marked.length;
  return p.map[cleanIndex];
}

/* موضعُ الإدراج في المصدر لفجوةٍ في النظيف — **خارج** ما أُغلق من
   علامات.

   بلا هذا يقع المُدرَج داخل العلامة السابقة: من كتب بعد كلمةٍ ملوّنة
   وجد كلامه قد اصطبغ. فنتخطّى أقواس الإغلاق وحدها — `}` وعلامات
   الغامق والمائل والتسطير — ونقف عند `{` أو `[`، فلا ندخل العلامة
   التالية بدل أن نخرج من السابقة. */
function gapAfter(p: Parsed, gap: number, marked: string): number {
  if (gap <= 0) return 0;
  if (gap > p.map.length) return marked.length;
  let pos = p.map[gap - 1] + 1;
  const content = new Set(p.map);
  while (pos < marked.length && !content.has(pos)) {
    const ch = marked[pos];
    if (ch === '}' || ch === '*' || ch === '_' || ch === ')') { pos++; continue; }
    break;
  }
  return pos;
}

/* علامةٌ فرغ متنها لا يقرؤها المصيّر فتظهر حرفياً للقارئ — تُنزع بعد
   كل تحرير. يقع هذا حين يمسح الكاتب كلمةً ملوّنة كاملة. */
function dropEmpty(marked: string): string {
  return marked
    .replace(/\{[ch]:#[0-9a-fA-F]{3,6}\|\}/g, '')
    .replace(/\*\*\*\*/g, '')
    .replace(/____/g, '')
    .replace(/\[\]\([^)\s]+\)/g, '');
}

/**
 * يترجم تحريراً وقع على النصّ النظيف إلى المصدر المعلَّم.
 *
 * الفرق يُحسب ببادئةٍ ولاحقةٍ مشتركتين — أبسط ما يكفي: المحرّر النصّي
 * يغيّر مدىً متّصلاً واحداً في كل حدث، إدراجاً كان أو حذفاً أو لصقاً.
 *
 * والإدراج عند طرف كلمةٍ ملوّنة يقع **خارجها**: `map` تعطي موضع أول
 * حرفٍ غير محذوف، وهو ما بعد قوس الإغلاق. فمن كتب بعد كلمةٍ ملوّنة لا
 * يجد كلامه قد اصطبغ بلا أن يطلب.
 */
export function applyCleanEdit(marked: string, parsed: Parsed, nextClean: string): string {
  const prev = parsed.clean;
  if (prev === nextClean) return marked;

  let p = 0;
  while (p < prev.length && p < nextClean.length && prev[p] === nextClean[p]) p++;
  let s = 0;
  while (
    s < prev.length - p && s < nextClean.length - p
    && prev[prev.length - 1 - s] === nextClean[nextClean.length - 1 - s]
  ) s++;

  const delStart = p;
  const delEnd = prev.length - s;
  const inserted = nextClean.slice(p, nextClean.length - s);

  /* الحذف بإحداثيات الحروف لا الفجوات: تُحذف حروف المتن وحدها وتبقى
     حدود العلامة، ثم يمسح `dropEmpty` ما فرغ متنه. فحذفُ كلمةٍ ملوّنة
     لا يبتلع قوس الإغلاق ولا يترك علامةً مفتوحة.

     والإدراج المحض في فجوةٍ خارج العلامات — انظر `gapAfter`. */
  let from = delEnd > delStart ? parsed.map[delStart] : gapAfter(parsed, delStart, marked);
  let to = delEnd > delStart ? parsed.map[delEnd - 1] + 1 : from;

  /* علامةٌ ذهب متنها كلُّه تذهب حدودها معه.

     بلا هذا يترك الحذفُ فاتحةً بلا إغلاق — `{c:#937133|` وحدها —
     فتصل القارئ نصّاً حرفياً. و`dropEmpty` لا يكفي: هو يمسح ما فرغ
     متنه بين حدّين قائمين، والحذف هنا قد يبتلع أحد الحدّين.

     والشرط «متنه كلُّه»: حذفُ حرفٍ من كلمةٍ غامقة يبقيها غامقة، ولا
     تُنزع نجمتاها إلا إذا لم يبقَ منها شيء. */
  for (const mk of parsed.marks) {
    if (mk.bodyStart >= from && mk.bodyEnd <= to) {
      from = Math.min(from, mk.start);
      to = Math.max(to, mk.end);
    }
  }
  return dropEmpty(marked.slice(0, from) + inserted + marked.slice(to));
}

/**
 * يلفّ مدىً من النصّ النظيف بعلامةٍ في المصدر.
 *
 * والطرفان بإحداثيات الحروف لا الفجوات: يبدأ اللفّ عند أول حرفٍ محدَّد
 * وينتهي **بعد آخر حرفٍ فيه** — لا عند الحرف الذي يليه.
 *
 * الفرق ليس تجميلاً. موضع الحرف التالي يقع بعد فاتحة العلامة التي
 * تليه، فينغلق اللفّ خلفها ويترك فاتحةً بلا متن: لفُّ «السلام» في
 * `السلام{c:#937133| عليكم}` كان يعطي `{h:…|السلام{c:#937133|}` —
 * علامةٌ داخل علامة، وأخرى فارغة، ونصٌّ لا يقرؤه المصيّر فيصل القارئ
 * حرفياً. ووقع هذا فعلاً عند تظليل أوّل كلمةٍ من فقرةٍ ملوّنة.
 */
export function wrapClean(
  marked: string, parsed: Parsed, start: number, end: number, open: string, close: string,
): string {
  const a = toSource(parsed, start, marked);
  const b = end > start && end <= parsed.map.length
    ? parsed.map[end - 1] + 1
    : toSource(parsed, end, marked);
  return marked.slice(0, a) + open + marked.slice(a, b) + close + marked.slice(b);
}

/** علاماتُ الغامق والمائل والتسطير متوازنةٌ في المقطع؟ */
function balanced(s: string): boolean {
  const bold = (s.match(/\*\*/g) || []).length;
  const under = (s.match(/__/g) || []).length;
  const italic = (s.replace(/\*\*/g, '').match(/\*/g) || []).length;
  return bold % 2 === 0 && under % 2 === 0 && italic % 2 === 0;
}

/**
 * يعيد مدىً إلى الافتراضي: ينزع عنه اللون والتظليل ولا يمسّ سواهما.
 *
 * والعمل يجري على المصدر مباشرةً لا بإعادة بنائه من النظيف: إعادة
 * البناء تفقد ما لا تعرفه الدالّة — رابطاً بعنوانه مثلاً — والنسخ
 * الحرفيّ لا يفقد شيئاً.
 *
 * والعلامة التي يتقاطع معها المدى جزئياً تُقسَّم لا تُلغى كاملة: من
 * أزال اللون عن كلمةٍ من ثلاث لا يفقد لون الكلمتين الأخريين. فإن جاء
 * القسم بعلامةِ غامقٍ مفتوحةٍ بلا إغلاق — أي أن المدى شقّ كلمةً
 * غامقة — أُزيل اللون عن المتن كلّه: نتيجةٌ يفهمها الكاتب، خيرٌ من
 * علامةٍ مكسورة تظهر حرفياً للقارئ.
 */
export function clearColorIn(
  marked: string, parsed: Parsed, start: number, end: number, kind?: 'c' | 'h',
): string {
  if (end <= start) return marked;
  const cleanOf = new Map<number, number>();
  parsed.map.forEach((mi, ci) => cleanOf.set(mi, ci));

  const out: string[] = [];
  let cursor = 0;
  COLOR.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = COLOR.exec(marked))) {
    // «الافتراضي» في قائمة اللون يعيد اللون وحده، وفي قائمة التظليل
    // التظليلَ وحده — فمن أزال تظليلاً لا يفقد لوناً لم يمسّه
    if (kind && m[1] !== kind) continue;
    const whole = m[0];
    const mStart = m.index;
    const mEnd = mStart + whole.length;
    const openLen = whole.indexOf('|') + 1;
    const open = whole.slice(0, openLen);
    const bodyStart = mStart + openLen;
    const bodyEnd = mEnd - 1; // قبل قوس الإغلاق

    const seg = ['', '', ''];
    let phase = 0; // 0 قبل المدى · 1 داخله · 2 بعده
    let pending = '';
    for (let i = bodyStart; i < bodyEnd; i++) {
      const ci = cleanOf.get(i);
      /* حدٌّ داخليّ — قوس رابطٍ أو نجمتا غامق — يتبع الحرف الذي
         **يليه** لا الذي سبقه: `[` في أول المتن يخصّ ما بعده، ولو
         تبع ما قبله لخرج وحده في قسمٍ فانكسرت العلامة. */
      if (ci === undefined) { pending += marked[i]; continue; }
      phase = (ci >= start && ci < end) ? 1 : (phase === 1 ? 2 : phase);
      seg[phase] += pending + marked[i];
      pending = '';
    }
    seg[phase] += pending;
    const [before, inside, after] = seg;

    if (!inside) continue; // لا تقاطع — تُترك العلامة كما هي
    out.push(marked.slice(cursor, mStart));
    if (!balanced(before) || !balanced(inside) || !balanced(after)) {
      out.push(before + inside + after);
    } else {
      out.push((before ? `${open}${before}}` : '') + inside + (after ? `${open}${after}}` : ''));
    }
    cursor = mEnd;
  }
  out.push(marked.slice(cursor));
  return dropEmpty(out.join(''));
}
