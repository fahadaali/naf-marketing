/* ═══ نموذج الأسطر: ما يُرى في المحرر هو ما يُنشر وما يصل بيسكامب ═══

   كان لنصّ المنشور ثلاث قراءات لا تتفق: المحرر يعرضه بقواعد المتصفح،
   و`htmlToText` يجرّده للنشر بقواعده، وبيسكامب يُرسل إليه بعد استبدال
   وسمين أو ثلاثة. فبيسكامب لا يقبل إلا `div h1 br strong em strike a pre
   ul ol li blockquote` ويحذف ما سواها: `<b>` الذي يكتبه زرّ «غامق» يُحذف
   فيضيع الغامق، و`<span style="white-space: pre-wrap">` الذي يلصقه المتصفح
   من مستندات جوجل ونحوها يُحذف فتلتصق أسطره. ثم يُسحب النصّ من بيسكامب
   بعد أي تعديلٍ فيه، فيعود إلى المنصة بلا أسطر ولا غامق، ويُنشر كذلك.
   وكان التجريد نفسه يفصل النقطة عن نصّها في قائمةٍ ملصوقة (`<li><p>`)،
   ويُسقط السطر الفارغ بين فقرتين ملصوقتين (`</p><br><p>`)، وينشر فراغ
   الشيفرة داخل الفقرة سطراً.

   فالآن قراءةٌ واحدة بقواعد المتصفح نفسها، تُخرج أسطراً؛ ومنها يُكتب نصّ
   النشر (`linesToText`) ووصف بطاقة بيسكامب (`linesToBasecamp`). وما يُرى في
   المحرر سطراً يُنشر سطراً ويظهر في بيسكامب سطراً، ويعود منه كما ذهب.

   قواعد المتصفح المعتمدة:
   - الكتلة تبدأ سطراً وتنهيه، والكتلة الفارغة سطرٌ فارغ.
   - `<br>` ينهي السطر الجاري، فإن لم يكن ثمّة سطرٌ جارٍ كان هو سطراً فارغاً.
     ولذلك لا يزيد `<br>` الأخير في الكتلة سطراً، ويزيده الثاني.
   - الفراغ (مسافة، سطر جديد، جدولة) يُطوى مسافةً واحدة ولا يبدأ سطراً،
     إلا في `<pre>` أو ما نُسّق `white-space: pre*` — هناك يبقى كما كُتب.
   - `&nbsp;` حرفٌ لا يُطوى.
   - بطاقة الوسيط كتلةٌ بلا نصّ: تفصل ما قبلها عمّا بعدها ولا تزيد سطراً. */

const HTML_ENTITIES: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
};

/** فكّ الكيانات في مرورٍ واحد — فـ`&amp;lt;` يصير `&lt;` لا `<`. والمسافة غير الفاصلة تبقى حرفها. */
function decodeRaw(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return HTML_ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** الكيانات مفكوكةً، والمسافة غير الفاصلة مسافة — للنصّ المنشور. */
export function decodeEntities(s: string): string {
  return decodeRaw(s).replace(/ /g, ' ');
}

const BLOCK = new Set([
  'p', 'div', 'li', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'figure', 'figcaption',
  'tr', 'table', 'section', 'article', 'pre',
]);
const VOID = new Set(['br', 'img', 'hr', 'input', 'meta', 'link', 'source', 'wbr', 'col', 'area', 'base', 'track', 'embed']);

/** ما يحمله السطر من تنسيقٍ يفهمه بيسكامب. والتسطير لا يعرفه بيسكامب فلا يُحمل. */
type Fmt = 'strong' | 'em' | 'strike' | `a:${string}`;

type Inline = { tag: string; fmts: Fmt[]; pre: boolean };

/** قائمةٌ وعناصرها. العنصر يعرف عنصرَ القائمة التي تحويه إن كانت متداخلة. */
type List = { ordered: boolean; count: number; parent: Item | null };
export type Item = { list: List; n: number; lines: number };

export type Line =
  | { kind: 'p' | 'h' | 'quote' | 'pre'; text: string; html: string; block: object; item: Item | null }
  | { kind: 'embed'; raw: string; id: string; name: string };

const attr = (attrs: string, name: string): string =>
  (attrs.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i')) || attrs.match(new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, 'i')) || [])[1] || '';

function inlineOf(tag: string, attrs: string): Inline {
  const fmts: Fmt[] = [];
  const style = attr(attrs, 'style').toLowerCase();
  if (tag === 'b' || tag === 'strong' || /font-weight\s*:\s*(bold|bolder|[6-9]00)/.test(style)) fmts.push('strong');
  if (tag === 'i' || tag === 'em' || /font-style\s*:\s*italic/.test(style)) fmts.push('em');
  if (tag === 's' || tag === 'strike' || tag === 'del' || /line-through/.test(style)) fmts.push('strike');
  if (tag === 'a') {
    const href = attr(attrs, 'href');
    if (/^(https?:|mailto:)/i.test(decodeRaw(href).trim())) fmts.push(`a:${href}`);
  }
  return { tag, fmts, pre: /white-space\s*:\s*(pre|pre-wrap|pre-line|break-spaces)\b/.test(style) };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;');
const openTag = (f: Fmt) => (f.startsWith('a:') ? `<a href="${f.slice(2)}">` : `<${f}>`);
const closeTag = (f: Fmt) => (f.startsWith('a:') ? '</a>' : `</${f}>`);

/* بطاقة الوسيط كتلةٌ واحدة بما فيها — تُقرأ بعمقها كي لا يقطعها `</div>` داخلها. */
function cutEmbeds(html: string): { rest: string; embeds: { raw: string; id: string; name: string }[] } {
  const embeds: { raw: string; id: string; name: string }[] = [];
  let rest = '';
  let i = 0;
  const open = /<div\b[^>]*\bclass="[^"]*\bmedia-embed\b[^"]*"[^>]*>/gi;
  for (;;) {
    open.lastIndex = i;
    const m = open.exec(html);
    if (!m) { rest += html.slice(i); break; }
    rest += html.slice(i, m.index);
    let depth = 0;
    let j = m.index;
    while (j < html.length) {
      if (/^<div\b/i.test(html.slice(j, j + 5))) { depth++; j += 4; }
      else if (/^<\/div>/i.test(html.slice(j, j + 6))) { depth--; j += 6; if (depth === 0) break; }
      else j++;
    }
    const raw = html.slice(m.index, j);
    embeds.push({ raw, id: attr(raw, 'data-media-id'), name: decodeRaw(attr(raw, 'data-media-name')) });
    rest += `<naf-embed data-i="${embeds.length - 1}"></naf-embed>`;
    i = j;
  }
  return { rest, embeds };
}

/** النصّ أسطراً كما يرسمه المتصفح. */
export function bodyLines(html: string): Line[] {
  if (!html) return [];
  // نصٌّ بلا وسوم: كل سطرٍ فيه سطر، وفراغه كما كُتب
  const plain = !/<[a-z!/]/i.test(html);
  let src = html;
  src = src.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '');
  src = src.replace(/<!--[\s\S]*?-->/g, '');
  const { rest, embeds } = cutEmbeds(src);
  /* اسم الوسيط ووصفه نصٌّ في البطاقة لا من كلام المنشور — وما بقي منهما
     خارج بطاقةٍ (شكلٌ قديم) يُحذف كذلك. */
  src = rest.replace(/<(span|div)\b[^>]*\bclass="[^"]*\bmedia-(?:cap|sub|ic)\b[^"]*"[^>]*>[\s\S]*?<\/\1>/gi, '');

  const lines: Line[] = [];
  const blocks: { tag: string; ctx: object; item: Item | null; list: List | null }[] = [];
  const inlines: Inline[] = [];
  let cur: { text: string; lead: number; html: string; kind: 'p' | 'h' | 'quote' | 'pre'; block: object; item: Item | null } | null = null;
  let space = false; // فراغٌ مطويّ ينتظر حرفاً بعده في السطر نفسه
  let empty = false; // كتلةٌ فُتحت ولم يقع فيها شيء بعد

  const active = (): Fmt[] => inlines.flatMap((x) => x.fmts);
  const pre = () => plain || inlines.some((x) => x.pre) || blocks.some((b) => b.tag === 'pre');
  const item = (): Item | null => {
    for (let k = blocks.length - 1; k >= 0; k--) if (blocks[k].item) return blocks[k].item;
    return null;
  };
  const kind = (): 'p' | 'h' | 'quote' | 'pre' => {
    for (let k = blocks.length - 1; k >= 0; k--) {
      const t = blocks[k].tag;
      if (t === 'li') return 'p';
      if (/^h[1-6]$/.test(t)) return 'h';
      if (t === 'blockquote') return 'quote';
      if (t === 'pre') return 'pre';
    }
    return 'p';
  };
  // الكتلة التي تحمل السطر: أسطرُ الكتلة الواحدة يجمعها بيسكامب في عنصرٍ واحد
  const holder = (): object => {
    for (let k = blocks.length - 1; k >= 0; k--) {
      const t = blocks[k].tag;
      if (t === 'li' || t === 'blockquote' || t === 'pre' || /^h[1-6]$/.test(t)) return blocks[k].ctx;
    }
    return ROOT;
  };
  const start = () => {
    if (cur) return;
    const it = item();
    let prefix = '';
    if (it && it.lines === 0) prefix = it.list.ordered ? `${it.n}. ` : '• ';
    if (it) it.lines++;
    cur = { text: prefix, lead: prefix.length, html: active().map(openTag).join(''), kind: kind(), block: holder(), item: it };
  };
  const end = () => {
    if (!cur) return;
    cur.html += active().reverse().map(closeTag).join('');
    // المسافة في آخر السطر لا تُرى ولا تُنشر — ولا تُرسل، كي لا يختلف الذهاب الثاني عن الأول
    cur.html = cur.html.replace(/ +((?:<\/[a-z]+>)*)$/, '$1');
    // السطر الفارغ لا وسم فيه: غامقٌ فارغ يُخفي في بيسكامب أنه سطرٌ فارغ
    if (cur.text.length === cur.lead) cur.html = '';
    lines.push({ kind: cur.kind, text: cur.text, html: cur.html, block: cur.block, item: cur.item });
    cur = null;
    space = false;
  };
  const char = (ch: string, kept = false) => {
    start();
    if (space && cur!.text !== '' && !/[ \n]$/.test(cur!.text)) { cur!.text += ' '; cur!.html += ' '; }
    space = false;
    /* مسافةٌ محفوظة (`pre-wrap`) في أول السطر أو بعد مسافة يطويها بيسكامب —
       فتُكتب له غير فاصلة، ويبقى عددها. */
    const fold = kept && ch === ' ' && (cur!.text.length === cur!.lead || cur!.text.endsWith(' '));
    cur!.text += ch;
    cur!.html += fold ? '&nbsp;' : esc(ch);
    empty = false;
  };
  const brk = () => {
    if (cur) end();
    else { start(); end(); }
    empty = false;
  };
  const text = (raw: string) => {
    const s = decodeRaw(raw);
    const keep = pre();
    for (const ch of s) {
      if (ch === '\r') continue;
      if (keep) {
        if (ch === '\n') brk();
        else char(ch, true);
      } else if (/[ \t\n\f]/.test(ch)) {
        if (cur) space = true;
      } else char(ch);
    }
  };

  const tok = /<\/?([a-zA-Z][\w-]*)([^>]*)>|[^<]+|</g;
  for (const m of src.matchAll(tok)) {
    const whole = m[0];
    if (!m[1]) { text(whole); continue; }
    const tag = m[1].toLowerCase();
    const closing = whole[1] === '/';
    const attrs = m[2] || '';
    if (tag === 'naf-embed') {
      if (closing) continue;
      end();
      lines.push({ kind: 'embed', ...embeds[Number(attr(attrs, 'data-i'))] });
      empty = false;
      continue;
    }
    if (tag === 'br') { brk(); continue; }
    if (BLOCK.has(tag)) {
      if (!closing) {
        end();
        let it: Item | null = null;
        let list: List | null = null;
        if (tag === 'ul' || tag === 'ol') list = { ordered: tag === 'ol', count: 0, parent: item() };
        if (tag === 'li') {
          let host: List | null = null;
          for (let k = blocks.length - 1; k >= 0 && !host; k--) if (blocks[k].list) host = blocks[k].list;
          host ??= { ordered: false, count: 0, parent: item() };
          it = { list: host, n: ++host.count, lines: 0 };
        }
        blocks.push({ tag, ctx: {}, item: it, list });
        empty = true;
      } else {
        const b = blocks.pop();
        if (cur) end();
        else if (empty) {
          // الكتلة الفارغة سطرٌ فارغ؛ وعنصر القائمة الفارغ نقطةٌ بلا نصّ
          if (b) blocks.push(b);
          start();
          if (b) blocks.pop();
          end();
        }
        empty = false;
      }
      continue;
    }
    if (VOID.has(tag)) continue;
    if (!closing) inlinePush(tag, attrs);
    else inlinePop(tag);
  }
  end();
  return lines;

  function inlinePush(tag: string, attrs: string) {
    const x = inlineOf(tag, attrs);
    inlines.push(x);
    if (cur) cur.html += x.fmts.map(openTag).join('');
  }
  function inlinePop(tag: string) {
    let k = inlines.length - 1;
    while (k >= 0 && inlines[k].tag !== tag) k--;
    if (k < 0) return;
    // يُغلق ما فُتح بعده أيضاً، ويُعاد فتحه — كي يبقى السطر متوازناً
    const after = inlines.slice(k + 1);
    if (cur) {
      cur.html += [...inlines.slice(k)].reverse().flatMap((x) => [...x.fmts].reverse()).map(closeTag).join('');
      cur.html += after.flatMap((x) => x.fmts).map(openTag).join('');
    }
    inlines.splice(k, 1);
  }
}

const ROOT = {};

/** النصّ المنشور: سطرٌ بسطر، والأسطر الفارغة بعددها. */
export function linesToText(lines: Line[]): string {
  const out: string[] = [];
  for (const l of lines) if (l.kind !== 'embed') out.push(l.text.replace(/ /g, ' '));
  return out.join('\n').replace(/[ \t]+\n/g, '\n').trim();
}

/**
 * وصف بطاقة بيسكامب بوسومه وحدها: أسطرُ الفقرات في `<div>` يفصلها `<br>`
 * (كما يكتب محرر بيسكامب نفسه)، والقوائم `<ul>`/`<ol>` بتداخلها، والعنوان
 * `<h1>`، والاقتباس `<blockquote>`. والوسيط يُستبدل بما يردّه `embed`.
 */
export function linesToBasecamp(lines: Line[], embed: (e: { id: string; name: string; raw: string }) => string): string {
  let out = '';
  let open: Item[] = []; // العناصر المفتوحة من الأبعد إلى الأقرب
  let run: { kind: string; block: object; lines: string[] } | null = null;

  const flushRun = () => {
    if (!run) return;
    // السطر الفارغ الأخير يحتاج `<br>` زائداً: الأخير في الكتلة لا يُرى سطراً
    const sep = run.kind === 'pre' ? '\n' : '<br>';
    const body = run.lines.join(sep) + (run.lines[run.lines.length - 1] === '' ? sep : '');
    const tag = run.kind === 'h' ? 'h1' : run.kind === 'quote' ? 'blockquote' : run.kind === 'pre' ? 'pre' : 'div';
    out += `<${tag}>${body}</${tag}>`;
    run = null;
  };
  const chain = (it: Item | null): Item[] => {
    const c: Item[] = [];
    for (let x = it; x; x = x.list.parent) c.unshift(x);
    return c;
  };
  const listTag = (it: Item) => (it.list.ordered ? 'ol' : 'ul');
  const moveTo = (target: Item[]) => {
    let k = 0;
    while (k < open.length && k < target.length && open[k] === target[k]) k++;
    for (let j = open.length - 1; j >= k; j--) {
      out += '</li>';
      // القائمة نفسها تستمر إن كان التالي عنصراً منها
      if (!(j === k && target[k] && target[k].list === open[j].list)) out += `</${listTag(open[j])}>`;
    }
    for (let j = k; j < target.length; j++) {
      const sameList = j === k && open[j] && open[j].list === target[j].list;
      if (!sameList) out += `<${listTag(target[j])}>`;
      out += '<li>';
    }
    open = target;
  };

  let itemLines: string[] = [];
  let itemOf: Item | null = null;
  const flushItem = () => {
    if (itemOf) out += itemLines.join('<br>') + (itemLines[itemLines.length - 1] === '' ? '<br>' : '');
    itemLines = [];
    itemOf = null;
  };

  for (const l of lines) {
    if (l.kind === 'embed') {
      flushRun(); flushItem(); moveTo([]);
      out += embed(l);
      continue;
    }
    if (l.item) {
      flushRun();
      if (l.item !== itemOf) {
        flushItem();
        moveTo(chain(l.item));
        itemOf = l.item;
      }
      itemLines.push(l.html);
      continue;
    }
    flushItem(); moveTo([]);
    const key = l.kind === 'p' ? 'p' : l.kind;
    if (!run || run.kind !== key || (key !== 'p' && run.block !== l.block) || key === 'h') {
      flushRun();
      run = { kind: key, block: l.block, lines: [] };
    }
    run.lines.push(l.html);
  }
  flushRun(); flushItem(); moveTo([]);
  return out;
}
