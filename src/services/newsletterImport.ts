import type { Block } from './newsletter';
import { hexColor, parseStyle } from './blockStyle';
import type { BlockStyle } from './blockStyle';

/* ============================================================
   استيراد قالب بريدٍ خارجي — من ميلشيمب أو Stripo أو ما شابه.

   والقاعدة التي تحكم هذا الملف كلَّه: **لا يدخل HTML إلى المخزن.**
   القالب يُقرأ ويُحوَّل كتلاً، وما لا يقابله كتلة يسقط. السبب هو نفسه
   المكتوب في `inline.ts`: نصٌّ يصل من الخارج ويُحقن في رسالةٍ تُفتح في
   عميلٍ لا نتحكّم به يحتاج مُعقِّماً، والمُعقِّم الذي يخطئ مرة واحدة
   يرسل الخطأ إلى كل مشترك. فالمحوِّل يقرأ البنية ويكتب كتلاً من عنده،
   ولا ينقل وسماً واحداً كما هو.

   وثمن ذلك مكتوبٌ في `naf-terms.md` ويُعرض للكاتب: يُنقل المحتوى، ولا
   يُنقل تخطيط القالب الأصلي. جداولُ التخطيط التي تبني الأعمدة
   والحشوات لا تقابلها كتلة، فتُفتح ويُقرأ ما بداخلها.

   والمحلّل هنا صغيرٌ مكتوبٌ باليد لا مكتبة: Workers بلا DOM،
   و`HTMLRewriter` تيّاريّ يصعب أن يبني منه شجرةً متداخلة. وهذه دالّة
   خالصة تُختبر بمدخلٍ ومخرَج.
   ============================================================ */

type El = { tag: string; attrs: Record<string, string>; children: Node[] };
type Node = El | { text: string };

const isEl = (n: Node): n is El => (n as El).tag !== undefined;

/** وسومٌ لا تُغلق. `<br>` بلا `</br>`، ووضعُها في المكدّس يبتلع ما بعدها. */
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr']);

/** ما لا يُقرأ محتواه أصلاً — شيفرةٌ وأنماطٌ وبياناتُ رأس. */
const DROP = new Set(['script', 'style', 'head', 'meta', 'link', 'noscript', 'svg']);

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–',
  hellip: '…', laquo: '«', raquo: '»', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

const ATTR = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of raw.matchAll(ATTR)) out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  return out;
}

/** يبني شجرةً متسامحة: وسمٌ لم يُغلق لا يُسقط المستند. */
export function parseHtml(html: string): El {
  const root: El = { tag: '#root', attrs: {}, children: [] };
  const stack: El[] = [root];
  // التعليقات و`<!doctype>` تُنزع أولاً — لا معنى لهما في الشجرة،
  // وتعليقٌ شرطيّ لأوتلوك يحمل وسوماً كاملة تُقرأ مرتين لو بقي.
  const src = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
    .replace(/<![^>]*>/g, '');

  const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const push = (n: Node) => stack[stack.length - 1].children.push(n);

  while ((m = TAG.exec(src))) {
    if (m.index > last) {
      const text = decodeEntities(src.slice(last, m.index));
      if (text.trim()) push({ text });
    }
    last = TAG.lastIndex;
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();

    if (closing) {
      // نغلق حتى أقرب مطابق. وإن لم يوجد فالوسم يتيم ويُهمل.
      const at = stack.map((e) => e.tag).lastIndexOf(tag);
      if (at > 0) stack.length = at;
      continue;
    }

    const el: El = { tag, attrs: parseAttrs(m[3] || ''), children: [] };
    push(el);
    // المحتوى الخام لا يُحلَّل: `if (a < b)` داخل script ليس وسماً
    if (DROP.has(tag)) {
      const end = new RegExp(`</${tag}\\s*>`, 'i');
      const rest = src.slice(TAG.lastIndex);
      const closeAt = rest.search(end);
      if (closeAt >= 0) {
        if (tag === 'head') {
          // العنوان وحده يُنتشل من الرأس — اسمُ القالب المقترح
          const t = rest.slice(0, closeAt).match(/<title[^>]*>([\s\S]*?)<\/title>/i);
          if (t) el.children.push({ text: decodeEntities(t[1]) });
        }
        TAG.lastIndex += closeAt + rest.slice(closeAt).match(end)![0].length;
        last = TAG.lastIndex;
      }
      continue;
    }
    if (!VOID.has(tag) && !/\/\s*$/.test(m[3] || '')) stack.push(el);
  }
  if (src.length > last) {
    const text = decodeEntities(src.slice(last));
    if (text.trim()) push({ text });
  }
  return root;
}

/** قيمة خاصية في `style="…"` الوارد. */
function cssProp(style: string, prop: string): string {
  const m = String(style || '').match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i'));
  return m ? m[1].trim() : '';
}

/* الألوان الواردة تُقرأ `#RGB` و`#RRGGBB` و`rgb(r,g,b)` — الأخيرة شائعة
   في مخرَجات المحرّرات المرئية. وما عداها يسقط: أسماءُ CSS ودوالُّ
   اللون الحديثة تحتاج جدولاً ومُحلِّلاً، ولونٌ مفقودٌ في كتلةٍ
   مستوردة أهون من مُحلِّلٍ ثانٍ يُدخل قيمةً لم تُفحص. */
function readColor(v: string): string {
  const s = String(v || '').trim();
  const direct = hexColor(s);
  if (direct) return direct;
  const rgb = s.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
  if (!rgb) return '';
  const hex = [1, 2, 3].map((i) => Math.min(255, Number(rgb[i])).toString(16).padStart(2, '0')).join('');
  return `#${hex}`.toUpperCase();
}

/** تخصيصٌ مقروءٌ من أنماط العنصر الوارد. */
function readStyle(el: El): BlockStyle | undefined {
  const raw = el.attrs.style || '';
  const align = cssProp(raw, 'text-align').toLowerCase();
  return parseStyle({
    color: readColor(cssProp(raw, 'color')),
    background: readColor(cssProp(raw, 'background-color')) || readColor(cssProp(raw, 'background')),
    /* الوسط وحده يُنقل. القالب الوارد قد يكون لاتينياً يساريّ الأصل،
       و«يمين» فيه نهايةُ السطر لا بدايته — ونقلُها حرفياً يقلب محاذاة
       كل فقرةٍ في نشرةٍ عربية. فما لم يكن توسيطاً يُترك للسمة. */
    align: align === 'center' ? 'center' : undefined,
  });
}

/** هل يبدو الرابط زرّاً؟ خلفيةٌ وحشوة، أو صنفٌ يقول ذلك. */
function looksLikeButton(el: El): boolean {
  const style = el.attrs.style || '';
  const cls = (el.attrs.class || '').toLowerCase();
  if (/\bbtn\b|\bbutton\b/.test(cls)) return true;
  const bg = readColor(cssProp(style, 'background-color')) || readColor(cssProp(style, 'background'));
  return !!bg && (/padding/i.test(style) || /display\s*:\s*(inline-)?block/i.test(style));
}

const SAFE_HREF = /^(?:https?:\/\/|mailto:)/i;

/* ===== النصّ داخل الفقرة =====
   يُعاد بعلامات المحرر لا بوسوم: `**` و`*` و`__` و`[نص](رابط)`
   و`{c:#…|نصّ}`. فما يخرج من هنا يدخل نفس المسار الذي يكتبه الكاتب
   بيده، ويمرّ على `renderInline` ومحقّقه. */
function inlineText(nodes: Node[]): string {
  let out = '';
  for (const n of nodes) {
    if (!isEl(n)) { out += n.text.replace(/\s+/g, ' '); continue; }
    const inner = inlineText(n.children);
    switch (n.tag) {
      case 'br': out += '\n'; break;
      case 'strong': case 'b': out += inner.trim() ? `**${inner.trim()}**` : ''; break;
      case 'em': case 'i': out += inner.trim() ? `*${inner.trim()}*` : ''; break;
      case 'u': out += inner.trim() ? `__${inner.trim()}__` : ''; break;
      case 'a': {
        const href = n.attrs.href || '';
        out += SAFE_HREF.test(href) && inner.trim() ? `[${inner.trim()}](${href})` : inner;
        break;
      }
      case 'span': case 'font': {
        const color = readColor(cssProp(n.attrs.style || '', 'color') || n.attrs.color || '');
        const bg = readColor(cssProp(n.attrs.style || '', 'background-color'));
        if (bg && inner.trim()) out += `{h:${bg}|${inner.trim()}}`;
        else if (color && inner.trim()) out += `{c:${color}|${inner.trim()}}`;
        else out += inner;
        break;
      }
      default: out += inner;
    }
  }
  return out;
}

/** نصّ مجرّد — لخلايا الجدول وعناوين البطاقات. */
function plainText(nodes: Node[]): string {
  return inlineText(nodes).replace(/\s+/g, ' ').trim();
}

const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
/** وسومٌ تحمل نصّاً داخل الفقرة لا كتلةً مستقلّة. */
const INLINE_TAGS = new Set(['a', 'span', 'font', 'strong', 'b', 'em', 'i', 'u', 'small',
  'sub', 'sup', 'br', 'abbr', 'code', 'label']);

/** حدٌّ أعلى للكتل — قالبٌ فيه ألف صفٍّ تخطيطيّ لا يُغرق المحرر. */
const MAX_BLOCKS = 300;

/**
 * يحوّل قالب بريدٍ خارجياً إلى كتل. دالّة خالصة: مدخلٌ نصّ ومخرَجٌ كتل.
 */
export function htmlToBlocks(html: string): Block[] {
  const root = parseHtml(html);
  const blocks: Block[] = [];

  const pushText = (text: string, style?: BlockStyle) => {
    const t = text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!t) return;
    blocks.push(style ? { type: 'text', text: t, style } : { type: 'text', text: t });
  };

  /* حاويةٌ تُقرأ بالتجميع لا بالكلّ أو لا شيء.

     كانت الفقرة تصير فقرةً واحدة إن كان **كلّ** أبنائها نصّاً داخلياً،
     وإلا فُتحت ومُشي على أبنائها واحداً واحداً. و`<p>نصّ <img> وبقيّة
     الجملة</p>` — وهي شائعة في قوالب البريد — كانت تسقط في الفرع
     الثاني: ثلاث فقرات مبتورة، ولونُ ما بداخل `<span>` ضائع لأنه
     يُقرأ في `inlineText` وحدها.

     فالآن يُجمع كلّ ما تتابع من نصٍّ داخليّ في فقرة، ويُقطع الجمع عند
     أوّل ابنٍ كتليّ فيُصيَّر كتلةً في موضعه، ثم يُستأنف. */
  const walkContainer = (el: El, style?: BlockStyle) => {
    let run: Node[] = [];
    const flush = () => {
      if (!run.length) return;
      const text = inlineText(run).trim();
      run = [];
      if (text) pushText(text, style);
    };
    for (const c of el.children) {
      // رابطٌ يبدو زرّاً كتلةٌ ولو كان وسمه داخلياً
      const isInline = !isEl(c) || (INLINE_TAGS.has(c.tag) && !(c.tag === 'a' && looksLikeButton(c)));
      if (isInline) { run.push(c); continue; }
      flush();
      walk([c]);
    }
    flush();
  };

  const walk = (nodes: Node[]) => {
    for (const n of nodes) {
      if (blocks.length >= MAX_BLOCKS) return;
      if (!isEl(n)) {
        // نصٌّ عارٍ بين وسمين — يقع كثيراً في قوالب الجداول
        if (n.text.trim()) pushText(n.text);
        continue;
      }
      if (DROP.has(n.tag)) continue;
      const style = readStyle(n);

      if (HEADINGS.has(n.tag)) {
        const text = plainText(n.children);
        if (text) {
          const level = (n.tag === 'h1' || n.tag === 'h2') ? 2 : 3;
          blocks.push(style ? { type: 'heading', text, level, style } : { type: 'heading', text, level });
        }
        continue;
      }

      switch (n.tag) {
        case 'hr':
          blocks.push({ type: 'divider' });
          continue;

        case 'img': {
          const src = n.attrs.src || '';
          const w = Number(n.attrs.width || 0);
          const h = Number(n.attrs.height || 0);
          // بكسل التتبّع صورةٌ بحجم واحد — لا محتوى فيها تُنقله
          if (!/^https?:\/\//i.test(src) || (w === 1 && h === 1)) continue;
          blocks.push({ type: 'image', url: src, alt: n.attrs.alt || '' });
          continue;
        }

        case 'blockquote': {
          const text = inlineText(n.children).trim();
          if (text) blocks.push(style ? { type: 'quote', text, style } : { type: 'quote', text });
          continue;
        }

        case 'a': {
          const href = n.attrs.href || '';
          if (SAFE_HREF.test(href) && looksLikeButton(n)) {
            const label = plainText(n.children);
            const bg = readColor(cssProp(n.attrs.style || '', 'background-color') || cssProp(n.attrs.style || '', 'background'));
            const fg = readColor(cssProp(n.attrs.style || '', 'color'));
            const btnStyle = parseStyle({ background: bg, color: fg });
            blocks.push(btnStyle
              ? { type: 'button', text: label || 'اقرأ المزيد', url: href, style: btnStyle }
              : { type: 'button', text: label || 'اقرأ المزيد', url: href });
            continue;
          }
          pushText(inlineText([n]), style);
          continue;
        }

        case 'ul': case 'ol': {
          /* لا كتلة قائمةٍ في نموذج النشرة، فالبنود أسطرٌ في فقرة.
             والعلامة «•» محرفُ ترقيم لا إيموجي — §3 يمنع الثاني وحده،
             وسطرٌ بلا علامة يلتصق بما قبله فيُقرأ جملةً واحدة. */
          const items = n.children.filter((c): c is El => isEl(c) && c.tag === 'li');
          const text = items.map((li) => `• ${plainText(li.children)}`).filter((s) => s.length > 2).join('\n');
          if (text) pushText(text, style);
          continue;
        }

        case 'table': {
          const rows = collectRows(n);
          const dataRows = rows.filter((r) => r.length > 1);
          /* جدولُ بياناتٍ أم جدولُ تخطيط؟ الفاصل عمودان فأكثر في صفّين
             فأكثر — وما دون ذلك صندوقٌ يبني عموداً أو حشوة، فيُفتح
             ويُقرأ ما بداخله بدل أن يصير جدولاً بخانةٍ واحدة. */
          if (dataRows.length >= 2) {
            const cols = Math.max(...dataRows.map((r) => r.length));
            const cells = dataRows.map((r) => {
              const filled = r.map((c) => plainText(c.children));
              while (filled.length < cols) filled.push('');
              return filled;
            });
            const header = rows.length > 0 && rows[0].every((c) => c.tag === 'th');
            blocks.push({ type: 'table', rows: cells, header });
            continue;
          }
          walk(n.children);
          continue;
        }

        case 'p': case 'div': case 'td': case 'th': case 'li': case 'section':
        case 'article': case 'header': case 'footer': case 'center': {
          walkContainer(n, style);
          continue;
        }

        default:
          walk(n.children);
      }
    }
  };

  walk(root.children);
  return blocks;
}

/** صفوف الجدول بخلاياها، بلا نزول إلى جداولٍ متداخلة. */
function collectRows(table: El): El[][] {
  const rows: El[][] = [];
  const visitRow = (el: El) => {
    const cells = el.children.filter((c): c is El => isEl(c) && (c.tag === 'td' || c.tag === 'th'));
    if (cells.length) rows.push(cells);
  };
  const visit = (el: El) => {
    for (const c of el.children) {
      if (!isEl(c)) continue;
      if (c.tag === 'tr') visitRow(c);
      else if (c.tag === 'tbody' || c.tag === 'thead' || c.tag === 'tfoot') visit(c);
    }
  };
  visit(table);
  return rows;
}

/** عنوان المستند — اسمٌ مقترح للقالب المستورد. */
export function htmlTitle(html: string): string {
  const m = String(html || '').match(/<title[^>]*>([\s\S]{1,200}?)<\/title>/i);
  return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim() : '';
}
