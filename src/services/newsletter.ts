import type { Env } from '../types';
import { EMAIL } from './emailTheme';
import { escapeHtml, renderInline, stripInline } from './inline';

// ===== تصيير كتل النشرة =====
// مصدر واحد (blocks) يُصيَّر لوجهتين:
//   • بريد: أنماط مضمّنة سطرياً لأن عملاء البريد يتجاهلون <style> الخارجي.
//   • ويب: HTML نظيف يعتمد ورقة أنماط الصفحة.

export type CalloutTone = 'info' | 'warning' | 'primary';

export type Block =
  | { type: 'heading'; text: string; level?: 2 | 3 }
  | { type: 'text'; text: string }
  | { type: 'image'; mediaId?: string; url?: string; alt?: string; caption?: string }
  | { type: 'button'; text: string; url: string }
  | { type: 'quote'; text: string; cite?: string }
  | { type: 'divider' }
  | { type: 'callout'; text: string; tone?: CalloutTone; title?: string }
  | { type: 'table'; rows: string[][]; header?: boolean }
  | { type: 'code'; text: string }
  | { type: 'footnote'; text: string }
  | { type: 'toc' }
  | { type: 'audio'; mediaId?: string; url?: string; title?: string }
  | { type: 'file'; mediaId?: string; url?: string; title?: string; note?: string }
  | { type: 'video'; mediaId?: string; url?: string }
  | { type: 'embed'; url: string; title?: string }
  | { type: 'columns'; start: string; end: string }
  | { type: 'checklist'; items: { text: string; done?: boolean }[] };

/* ===== التضمين الخارجي =====

   الصفحة العامة لا تضمّن أي عنوان يكتبه الكاتب داخل iframe. القائمة
   بيضاء لا سوداء: مزوّدٌ مسجَّل هنا يُضمَّن، وما عداه يُعرض بطاقة رابط.

   السبب أمنيّ لا ذوقيّ — iframe لموقع عشوائي يشغّل شيفرة طرفٍ ثالث في
   سياق صفحتنا، ويكسر سياسة المحتوى، وقد يُستعمل في التصيّد. وبطاقة
   الرابط ليست تنازلاً: القارئ يرى الوجهة ويقرّر.

   ومنصات التواصل ليست في القائمة عمداً: تضمين منشور إكس أو لينكدإن
   يحتاج تحميل شيفرة المنصة نفسها في صفحتنا — تتبّعٌ للقارئ لم يطلبه —
   فتُعرض بطاقة رابط. */
const EMBED_PROVIDERS: { test: RegExp; src: (m: RegExpMatchArray) => string }[] = [
  { test: /^https:\/\/(?:www\.)?youtube\.com\/watch\?v=([\w-]{6,})/i, src: (m) => `https://www.youtube-nocookie.com/embed/${m[1]}` },
  { test: /^https:\/\/youtu\.be\/([\w-]{6,})/i, src: (m) => `https://www.youtube-nocookie.com/embed/${m[1]}` },
  { test: /^https:\/\/(?:www\.)?vimeo\.com\/(\d{6,})/i, src: (m) => `https://player.vimeo.com/video/${m[1]}` },
];

/** عنوان الإطار لمزوّد مسجَّل، أو null فتُعرض بطاقة رابط. */
export function embedSrc(url: string): string | null {
  const u = String(url || '').trim();
  for (const p of EMBED_PROVIDERS) {
    const m = u.match(p.test);
    if (m) return p.src(m);
  }
  return null;
}

/* نغمات البطاقة. «معلومة» و«تحذير» حالتان مسجّلتان في naf-terms.md
   بلونيهما، فعنوانهما ظاهر دائماً — §6 يمنع نقل المعنى باللون وحده،
   والبريد يشدّده: أيقونة SVG لا تصل عملاء سطح المكتب أصلاً.
   و«تمييز» إبرازٌ بلا حكم، فلا عنوان افتراضي له. */
const CALLOUT: Record<CalloutTone, { label: string; bg: string; fg: string }> = {
  info: { label: 'معلومة', bg: EMAIL.infoSoft, fg: EMAIL.infoStrong },
  warning: { label: 'تحذير', bg: EMAIL.warningSoft, fg: EMAIL.warningStrong },
  primary: { label: '', bg: EMAIL.primarySoft, fg: EMAIL.primaryStrong },
};

/** معرّف عنوانٍ للربط من الفهرس. الترتيب يمنع تكرار المعرّف عند تشابه العناوين. */
export function headingId(text: string, index: number): string {
  return `h-${index + 1}-${slugify(text).slice(0, 40)}`;
}

// التهريب والتنسيق داخل الفقرة يعيشان في inline.ts. يُعاد تصديرها من
// هنا لأن escapeHtml كان يُستورد من هذا الملف قبل الفصل.
export { escapeHtml, renderInline, stripInline };

/* يحوّل أسطر النص إلى فقرات، مع الروابط والتنسيق داخل الفقرة.

   كان مكتوباً فوق هذه الدالة «مع دعم الروابط النصية» وهي تمرّ كل شيء
   عبر escapeHtml بلا معالجة رابط واحد. التعليق سبق التنفيذ بفارق
   طويل، فصار يصف نيّةً لا سلوكاً — وقارئٌ يصدّقه يبني عليه خطأً.
   الآن يصف ما يجري: renderInline يهرّب أولاً ثم يطبّق علاماتٍ مغلقة. */
function paragraphs(text: string, inline: boolean): string {
  const style = inline ? ` style="margin:0 0 14px;line-height:1.9;font-size:16px;color:${EMAIL.foreground}"` : '';
  return String(text || '')
    .split(/\n{2,}/)
    .filter((p) => p.trim())
    .map((p) => `<p${style}>${renderInline(p, inline).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export function parseBlocks(json: string | null): Block[] {
  try {
    const arr = JSON.parse(json || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/* بطاقة رابط — البديل الموحّد لكل ما لا يُشغَّل في موضعه.

   رسالة البريد لا تشغّل صوتاً ولا فيديو ولا تقبل iframe، والصفحة
   العامة لا تضمّن مزوّداً غير مسجَّل. الحالتان تنتهيان هنا: عنوانٌ
   ووصفٌ ورابطٌ ظاهر. القارئ يرى الوجهة قبل أن يضغط. */
function linkCard(url: string, title: string, note: string, inline: boolean): string {
  const safe = /^https?:\/\//i.test(url) ? url : '';
  if (!safe) return '';
  const st = inline
    ? ` style="display:block;margin:18px 0;padding:14px 16px;background:${EMAIL.muted};border:1px solid ${EMAIL.border};border-radius:${EMAIL.radius};text-decoration:none"`
    : ' class="link-card"';
  const tSt = inline ? ` style="display:block;font-weight:600;color:${EMAIL.primary};margin-bottom:4px"` : '';
  const nSt = inline ? ` style="display:block;font-size:13px;color:${EMAIL.mutedForeground}"` : ' class="link-card-note"';
  return `<a href="${escapeHtml(safe)}"${st}>` +
    `<span${tSt}>${escapeHtml(title || safe)}</span>` +
    (note ? `<span${nSt}>${escapeHtml(note)}</span>` : '') +
    `</a>`;
}

// mediaBase: أصل مطلق لروابط الوسائط (البريد لا يعرض الروابط النسبية)
export function renderBlocks(blocks: Block[], mode: 'email' | 'web', mediaBase = ''): string {
  const out: string[] = [];
  const inline = mode === 'email';
  const mediaUrl = (b: any) => (b.url ? b.url : b.mediaId ? `${mediaBase}/api/media/${b.mediaId}` : '');

  /* مرورٌ أوّل قبل التصيير: الحواشي تُرقَّم بترتيب ورودها، والعناوين
     تأخذ معرّفاتها. كلاهما يُقرأ من كتلٍ لاحقة أو سابقة — الفهرس قد
     يسبق العناوين، والحاشية تُعرض في آخر المقال — فلا يكفي مرور واحد. */
  const headings = blocks
    .map((b, i) => ({ b, i }))
    .filter((x) => x.b.type === 'heading') as { b: Extract<Block, { type: 'heading' }>; i: number }[];
  const headingIds = new Map<number, string>();
  headings.forEach((h, n) => headingIds.set(h.i, headingId(h.b.text, n)));
  const notes = blocks.filter((b) => b.type === 'footnote') as Extract<Block, { type: 'footnote' }>[];
  let noteNo = 0;

  for (const [bi, b] of blocks.entries()) {
    switch (b.type) {
      case 'heading': {
        const lvl = b.level === 3 ? 3 : 2;
        const st = inline
          ? ` style="margin:26px 0 12px;font-size:${lvl === 2 ? 22 : 18}px;font-weight:700;color:${EMAIL.foreground}"`
          : '';
        // المعرّف للويب وحده: Gmail يحذف id، ففهرسٌ برابط داخلي في
        // البريد يعطي القارئ روابط لا تصل إلى شيء.
        const idAttr = inline ? '' : ` id="${escapeHtml(headingIds.get(bi) || '')}"`;
        out.push(`<h${lvl}${idAttr}${st}>${escapeHtml(b.text)}</h${lvl}>`);
        break;
      }
      case 'text':
        out.push(paragraphs(b.text, inline));
        break;
      case 'image': {
        const src = mediaUrl(b);
        if (!src) break;
        const st = inline ? ` style="max-width:100%;height:auto;border-radius:${EMAIL.radius};display:block;margin:0 auto"` : '';
        out.push(`<figure${inline ? ' style="margin:18px 0"' : ''}>` +
          `<img src="${escapeHtml(src)}" alt="${escapeHtml(b.alt || '')}"${st}>` +
          (b.caption ? `<figcaption${inline ? ` style="font-size:13px;color:${EMAIL.mutedForeground};text-align:center;margin-top:6px"` : ''}>${escapeHtml(b.caption)}</figcaption>` : '') +
          `</figure>`);
        break;
      }
      case 'button': {
        if (!b.url) break;
        const st = inline
          ? ` style="display:inline-block;background:${EMAIL.primary};color:${EMAIL.primaryForeground};text-decoration:none;padding:12px 22px;border-radius:${EMAIL.radius};font-weight:600"`
          : ' class="btn"';
        out.push(`<p${inline ? ' style="text-align:center;margin:22px 0"' : ' style="text-align:center"'}>` +
          `<a href="${escapeHtml(b.url)}"${st}>${escapeHtml(b.text || 'اقرأ المزيد')}</a></p>`);
        break;
      }
      case 'quote': {
        const st = inline
          // border-right لا border-inline-start: عملاء البريد المكتبية لا تدعم
          // الخصائص المنطقية. جهة RTL مكتوبة مباشرةً — استثناء CLAUDE.md §1.
          ? ` style="margin:18px 0;padding:12px 16px;border-right:3px solid ${EMAIL.primary};background:${EMAIL.primarySoft};color:${EMAIL.foreground}"`
          : '';
        // الاقتباس يقبل التنسيق داخله — شاهدٌ من نظام يحمل رابطاً إلى مصدره.
        // والمصدر (cite) اسمٌ مجرّد فيبقى مهرّباً بلا علامات.
        out.push(`<blockquote${st}>${renderInline(b.text, inline)}${b.cite ? `<cite> — ${escapeHtml(b.cite)}</cite>` : ''}</blockquote>`);
        break;
      }
      case 'divider':
        out.push(inline ? `<hr style="border:none;border-top:1px solid ${EMAIL.border};margin:26px 0">` : '<hr>');
        break;

      case 'callout': {
        const tone = CALLOUT[b.tone as CalloutTone] ? (b.tone as CalloutTone) : 'primary';
        const c = CALLOUT[tone];
        const title = (b.title || '').trim() || c.label;
        // border-right لا border-inline-start — عملاء البريد المكتبية لا
        // تدعم الخصائص المنطقية. جهة RTL مكتوبة مباشرةً، استثناء §1.
        const st = inline
          ? ` style="margin:18px 0;padding:14px 16px;background:${c.bg};border-right:3px solid ${c.fg};border-radius:${EMAIL.radius}"`
          : ` class="callout callout-${tone}"`;
        const head = title
          ? (inline
              ? `<strong style="display:block;margin-bottom:6px;color:${c.fg};font-size:15px">${escapeHtml(title)}</strong>`
              : `<strong class="callout-title">${escapeHtml(title)}</strong>`)
          : '';
        const body = inline
          ? `<span style="color:${EMAIL.foreground};line-height:1.9;font-size:16px">${renderInline(b.text, true)}</span>`
          : renderInline(b.text, false);
        out.push(`<div${st}>${head}${body}</div>`);
        break;
      }

      case 'table': {
        const rows = Array.isArray(b.rows) ? b.rows.filter((r) => Array.isArray(r)) : [];
        if (!rows.length) break;
        const tSt = inline
          ? ' style="width:100%;border-collapse:collapse;margin:18px 0;font-size:15px"'
          : ' class="article-table"';
        // الخلايا محاذاة يمين صراحةً في البريد: text-start غير مدعوم،
        // والجدول بلا محاذاة يعود يساراً في عملاء لا تقرأ dir.
        const cell = (v: string, head: boolean) => {
          const st = inline
            ? ` style="border:1px solid ${EMAIL.border};padding:8px 10px;text-align:right;${head ? `background:${EMAIL.muted};font-weight:600;` : ''}color:${EMAIL.foreground}"`
            : '';
          const tag = head ? 'th' : 'td';
          return `<${tag}${st}>${renderInline(v, inline)}</${tag}>`;
        };
        const body = rows
          .map((r, ri) => `<tr>${r.map((v) => cell(v, !!b.header && ri === 0)).join('')}</tr>`)
          .join('');
        // الويب يلفّ الجدول بحاوية تمرّر أفقياً — جدولٌ عريض يجب أن
        // يمرّر داخل نفسه لا أن يمدّ الصفحة. والبريد بلا حاوية: عملاء
        // البريد لا يمرّرون، ولذلك عرض الجدول 100% ابتداءً.
        out.push(inline ? `<table${tSt}>${body}</table>` : `<div class="table-scroll"><table${tSt}>${body}</table></div>`);
        break;
      }

      case 'code': {
        // white-space:pre-wrap لا overflow-x:auto — التمرير الأفقي لا
        // يعمل في صندوق الوارد، فالسطر الطويل يُلَفّ ولا يكسر البطاقة.
        const st = inline
          ? ` style="margin:18px 0;padding:14px 16px;background:${EMAIL.muted};border:1px solid ${EMAIL.border};border-radius:${EMAIL.radius};font-family:${EMAIL.monoStack};font-size:14px;line-height:1.7;white-space:pre-wrap;word-break:break-word;direction:ltr;text-align:left;color:${EMAIL.foreground}"`
          : ' class="article-code"';
        // الكود لا يمرّ على renderInline: نجمةٌ في الكود نجمة لا مائل.
        out.push(`<pre${st}><code>${escapeHtml(b.text)}</code></pre>`);
        break;
      }

      case 'footnote': {
        noteNo += 1;
        const st = inline
          ? ` style="color:${EMAIL.primary};font-size:12px;vertical-align:super"`
          : ' class="fn-ref"';
        const href = inline ? '' : ` href="#fn-${noteNo}" id="fnref-${noteNo}"`;
        out.push(`<sup><a${href}${st}>${noteNo}</a></sup>`);
        break;
      }

      case 'audio': {
        const src = mediaUrl(b);
        if (!src) break;
        const title = b.title || 'صوت';
        // البريد لا يشغّل صوتاً — ولا عميلَ واحداً يُعوَّل عليه — فبطاقة رابط.
        out.push(inline
          ? linkCard(src, title, 'استماع', true)
          : `<figure class="media-block"><figcaption>${escapeHtml(title)}</figcaption>` +
            `<audio controls preload="none" src="${escapeHtml(src)}"></audio></figure>`);
        break;
      }

      case 'file': {
        const src = mediaUrl(b);
        if (!src) break;
        // «تنزيل» وصفُ الفعل في البطاقة، من naf-terms.md §١.
        out.push(inline
          ? linkCard(src, b.title || 'ملف', b.note || 'تنزيل', true)
          : `<a class="link-card" href="${escapeHtml(src)}" download>` +
            `<span class="link-card-title">${escapeHtml(b.title || 'ملف')}</span>` +
            `<span class="link-card-note">${escapeHtml(b.note || 'تنزيل')}</span></a>`);
        break;
      }

      case 'video': {
        const src = mediaUrl(b);
        const provider = b.url ? embedSrc(b.url) : null;
        if (inline) {
          // لا فيديو في صندوق الوارد: بطاقة رابط في الحالتين.
          const target = provider ? (b.url as string) : src;
          if (target) out.push(linkCard(target, 'فيديو', 'مشاهدة', true));
          break;
        }
        if (provider) {
          out.push(`<div class="embed-frame"><iframe src="${escapeHtml(provider)}" title="فيديو" ` +
            `loading="lazy" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`);
        } else if (src) {
          out.push(`<figure class="media-block"><video controls preload="none" src="${escapeHtml(src)}"></video></figure>`);
        } else if (b.url) {
          out.push(linkCard(b.url, 'فيديو', 'مشاهدة', false));
        }
        break;
      }

      case 'embed': {
        const provider = embedSrc(b.url);
        // البريد يحذف iframe دائماً، والويب لا يضمّن إلا مزوّداً مسجّلاً.
        if (inline || !provider) {
          out.push(linkCard(b.url, b.title || '', 'فتح الرابط', inline));
          break;
        }
        out.push(`<div class="embed-frame"><iframe src="${escapeHtml(provider)}" ` +
          `title="${escapeHtml(b.title || 'تضمين')}" loading="lazy" allowfullscreen ` +
          `referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`);
        break;
      }

      case 'columns': {
        /* البريد يبني الأعمدة بجدول لا بـflex — عملاء أوتلوك يتجاهلون
           flex وgrid فتنهار الأعمدة فوق بعضها بلا فاصل. والجدول يعمل
           في كل عميل منذ عشرين سنة.

           والويب يستعمل grid ينهار عمودياً تحت 480px: عمودان بعرض
           ١٨٧ بكسل على شاشة ٣٧٥ لا يُقرآن. */
        const a = renderInline(b.start, inline);
        const z = renderInline(b.end, inline);
        if (inline) {
          const cSt = ` style="width:50%;vertical-align:top;padding:0 8px;line-height:1.9;font-size:16px;color:${EMAIL.foreground}"`;
          out.push(`<table style="width:100%;border-collapse:collapse;margin:18px 0"><tr>` +
            `<td${cSt}>${a}</td><td${cSt}>${z}</td></tr></table>`);
        } else {
          out.push(`<div class="columns"><div>${a}</div><div>${z}</div></div>`);
        }
        break;
      }

      case 'checklist': {
        const items = Array.isArray(b.items) ? b.items : [];
        if (!items.length) break;
        /* لا مربّع تحديد تفاعليّ: البريد لا يحفظ حالته والصفحة العامة
           تُقرأ ولا تُملأ. فالويب يستعمل input معطَّلاً — دلالةٌ صحيحة
           يعلنها قارئ الشاشة بنفسه ويتبع رسمُها الثيم — والبريد يستعمل
           مؤشّراً نصّياً لأن العملاء تحذف input.

           والمؤشّر `[x]` لا U+2611: الثاني رمزٌ تصويري يُعرض إيموجي ملوّناً
           في أنظمة، و§3 يمنعه. ويُعزل اتجاهياً وإلا أعادت العربية
           ترتيب قوسيه. */
        const liSt = inline ? ` style="margin:6px 0;line-height:1.9;font-size:16px;color:${EMAIL.foreground}"` : '';
        const body = items.map((it) => {
          const text = renderInline(it.text || '', inline);
          if (inline) return `<li${liSt}><bdi>${it.done ? '[x]' : '[&nbsp;]'}</bdi> ${text}</li>`;
          return `<li><label><input type="checkbox" disabled${it.done ? ' checked' : ''}> <span>${text}</span></label></li>`;
        }).join('');
        const ulSt = inline ? ' style="margin:18px 0;padding-right:20px;list-style:none"' : ' class="checklist"';
        out.push(`<ul${ulSt}>${body}</ul>`);
        break;
      }

      case 'toc': {
        if (!headings.length) break; // فهرسٌ بلا عناوين لا يُعرض فارغاً
        const st = inline
          ? ` style="margin:18px 0;padding:14px 16px;background:${EMAIL.muted};border-radius:${EMAIL.radius}"`
          : ' class="article-toc"';
        const items = headings.map((h, n) => {
          const label = escapeHtml(h.b.text);
          // البريد بلا روابط داخلية — Gmail يحذف id، فالبند نصّ لا رابط.
          const inner = inline
            ? `<span style="color:${EMAIL.foreground}">${label}</span>`
            : `<a href="#${escapeHtml(headingIds.get(h.i) || '')}">${label}</a>`;
          const liSt = inline ? ` style="margin:4px 0;line-height:1.9;font-size:15px"` : '';
          return `<li${liSt}>${inner}</li>`;
        }).join('');
        const head = inline
          ? `<strong style="display:block;margin-bottom:8px;color:${EMAIL.foreground};font-size:15px">المحتويات</strong>`
          : '<strong class="toc-title">المحتويات</strong>';
        const listSt = inline ? ' style="margin:0;padding-right:20px"' : '';
        out.push(`<div${st}>${head}<ol${listSt}>${items}</ol></div>`);
        break;
      }
    }
  }

  // الحواشي في آخر المقال بترتيب ورودها — بعد كل الكتل لا بينها.
  if (notes.length) {
    const secSt = inline ? ` style="margin:26px 0 0;padding-top:14px;border-top:1px solid ${EMAIL.border}"` : ' class="article-footnotes"';
    const head = inline
      ? `<strong style="display:block;margin-bottom:8px;color:${EMAIL.foreground};font-size:15px">الحواشي</strong>`
      : '<strong class="fn-title">الحواشي</strong>';
    const listSt = inline ? ' style="margin:0;padding-right:20px"' : '';
    const items = notes.map((n, i) => {
      const liSt = inline ? ` style="margin:6px 0;line-height:1.8;font-size:13px;color:${EMAIL.mutedForeground}"` : '';
      // «رجوع» كلمةً لا سهماً: السهم المعقوف U+21A9 يُعرض إيموجي ملوّناً
      // في أنظمة، و§3 يمنعه. والكلمة مسجّلة في naf-terms.md §١.
      const back = inline ? '' : ` <a href="#fnref-${i + 1}" class="fn-back">رجوع</a>`;
      return `<li${liSt}${inline ? '' : ` id="fn-${i + 1}"`}>${renderInline(n.text, inline)}${back}</li>`;
    }).join('');
    out.push(`<div${secSt}>${head}<ol${listSt}>${items}</ol></div>`);
  }

  return out.join('\n');
}

/* نص عادي مختصر من الكتل (للمقتطف ولمنشورات التواصل).

   العلامات تُجرَّد هنا: منشور إكس لا يعرض `**` غامقاً، يعرضهما نجمتين.
   والرابط المكتوب يصير نصّه الظاهر — عنوانه يُلحق بالمنشور مرة واحدة
   في آخره، فتكراره داخل الجملة ضجيج. */
export function blocksToText(blocks: Block[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    // البطاقة نصٌّ يقرؤه القارئ فتدخل، والحاشية تعليقٌ على النصّ فتخرج —
    // مقتطفٌ يبدأ بحاشيةٍ يصف المرجع لا المقال. والكود والجدول والفهرس
    // بنيةٌ لا تُقرأ منشوراً على إكس.
    if (b.type === 'heading' || b.type === 'text' || b.type === 'quote' || b.type === 'callout') {
      parts.push(stripInline((b as any).text || ''));
    }
  }
  return parts.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ===== الإعدادات العامة للنشر =====
export async function publicSettings(env: Env, requestUrl: string): Promise<{ base: string; path: string }> {
  const rows = await env.DB.prepare(
    "SELECT key, value FROM settings WHERE key IN ('public_site_url','public_article_path')",
  ).all<{ key: string; value: string }>();
  const map: Record<string, string> = {};
  for (const r of rows.results) map[r.key] = r.value || '';
  // إن لم يُضبط نطاق عام نستخدم أصل الطلب الحالي — فتعمل الروابط فوراً بلا إعداد
  const base = (map.public_site_url || new URL(requestUrl).origin).replace(/\/$/, '');
  const path = (map.public_article_path || '/articles').replace(/\/$/, '');
  return { base, path };
}

export function articleUrl(base: string, path: string, slug: string): string {
  return `${base}${path}/${slug}`;
}

// يولّد slug عربي/لاتيني صالحاً للرابط
export function slugify(title: string): string {
  const s = String(title || '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return s || `article-${Date.now().toString(36)}`;
}

// ===== تحويل المقالة إلى منشورات تواصل =====
// نفس المصدر يُصاغ لكل منصة بحدودها، مع رابط المقالة دائماً (يقود القارئ للموقع).

const X_LIMIT = 275; // نترك هامشاً لحدّ ٢٨٠

// يقسّم نصاً طويلاً إلى تغريدات متتابعة دون قطع الكلمات
export function splitThread(text: string, limit = X_LIMIT): string[] {
  const parts: string[] = [];
  for (const para of String(text || '').split(/\n{2,}/)) {
    let cur = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if ((cur + ' ' + word).trim().length > limit) {
        if (cur.trim()) parts.push(cur.trim());
        cur = word;
      } else {
        cur = (cur + ' ' + word).trim();
      }
    }
    if (cur.trim()) parts.push(cur.trim());
  }
  return parts.filter(Boolean);
}

// سلسلة إكس: العنوان أولاً، ثم المحتوى مقسّماً، والرابط في آخر تغريدة
export function toXThread(title: string, blocks: Block[], url: string, maxParts = 6): string[] {
  const body = blocksToText(blocks);
  const chunks = splitThread(body).slice(0, Math.max(1, maxParts - 1));
  const head = splitThread(title, X_LIMIT)[0] || title.slice(0, X_LIMIT);
  const thread = [head, ...chunks];
  // نُلحق الرابط بآخر جزء إن اتسع، وإلا نضيفه جزءاً مستقلاً
  const last = thread[thread.length - 1];
  if ((last + '\n\n' + url).length <= X_LIMIT + 5) thread[thread.length - 1] = `${last}\n\n${url}`;
  else thread.push(url);
  return thread.map((t, i) => (thread.length > 1 ? `${i + 1}/${thread.length} ${t}` : t));
}

// لينكدإن: مقتطف مهني متوسط الطول مع دعوة لقراءة المقالة
export function toLinkedInPost(title: string, blocks: Block[], url: string, excerpt?: string | null): string {
  const body = (excerpt || blocksToText(blocks)).trim();
  const trimmed = body.length > 900 ? `${body.slice(0, 900).replace(/\s+\S*$/, '')}…` : body;
  return `${title}\n\n${trimmed}\n\nاقرأ المقالة كاملة:\n${url}`;
}
