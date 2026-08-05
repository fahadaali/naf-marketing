import type { Env } from '../types';
import { EMAIL } from './emailTheme';
import { escapeHtml, renderInline, stripInline } from './inline';
import {
  DEFAULT_THEME, baseSize, inkDecls, surfaceDecls, alignDecl, mergeDecls, styleAttr,
  RADIUS_PX, sizePx,
} from './blockStyle';
import type { BlockStyle, NewsletterTheme, StyleCtx } from './blockStyle';

// ===== تصيير كتل النشرة =====
// مصدر واحد (blocks) يُصيَّر لوجهتين:
//   • بريد: أنماط مضمّنة سطرياً لأن عملاء البريد يتجاهلون <style> الخارجي.
//   • ويب: HTML نظيف يعتمد ورقة أنماط الصفحة.

export type CalloutTone = 'info' | 'warning' | 'primary';

/* كل كتلة تقبل `style` اختيارياً — تخصيص الكاتب. غيابه يعني «اتبع
   السمة»، وهو حال كل نشرةٍ كُتبت قبل هذه الميزة: تُصيَّر كما كانت. */
export type Block = ({ style?: BlockStyle }) & (
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
  | { type: 'checklist'; items: { text: string; done?: boolean }[] }
);

/* ===== التضمين الخارجي =====

   الصفحة العامة لا تضمّن أي عنوان يكتبه الكاتب داخل iframe. القائمة
   بيضاء لا سوداء: مزوّدٌ مسجَّل هنا يُضمَّن، وما عداه يُعرض بطاقة رابط.

   السبب أمنيّ لا ذوقيّ — iframe لموقع عشوائي يشغّل شيفرة طرفٍ ثالث في
   سياق صفحتنا، ويكسر سياسة المحتوى، وقد يُستعمل في التصيّد. وبطاقة
   الرابط ليست تنازلاً: القارئ يرى الوجهة ويقرّر.

   والحدّ الفاصل ليس «منصة تواصل أو لا»، بل: **هل يعطي المزوّد نقطةَ
   تضمينٍ بإطارٍ من عنده؟** من يعطيها يدخل القائمة، ومن يشترط تحميل
   شيفرته في صفحتنا لا يدخل — تلك تقرأ القارئ وتتبعه ونحن لم نَعِده
   بذلك، وتكسر سياسة المحتوى معها.

   ولهذا تدخل تيك توك وإنستغرام وفيسبوك وسبوتيفاي وساوندكلاود وخرائط
   جوجل ومستندات جوجل، **وتبقى إكس خارجها**: منصة إكس لا تنشر نقطة
   إطارٍ عامة، وتضمين منشورها يمرّ حصراً عبر widgets.js. فتُعرض بطاقة
   رابط، وهو حدٌّ قائم لا نقصٌ مؤقت.

   ولينكدإن تدخل بنقطتها المعلنة `/embed/feed/update/…` وحدها — وهي
   عنوانٌ يعطيه لينكدإن نفسه من زرّ «تضمين هذا المنشور»، لا رابط
   المنشور العادي. */
const EMBED_PROVIDERS: { name: string; test: RegExp; src: (m: RegExpMatchArray) => string }[] = [
  // فيديو
  { name: 'youtube', test: /^https:\/\/(?:www\.)?youtube\.com\/watch\?v=([\w-]{6,})/i, src: (m) => `https://www.youtube-nocookie.com/embed/${m[1]}` },
  { name: 'youtube', test: /^https:\/\/youtu\.be\/([\w-]{6,})/i, src: (m) => `https://www.youtube-nocookie.com/embed/${m[1]}` },
  { name: 'youtube', test: /^https:\/\/(?:www\.)?youtube\.com\/shorts\/([\w-]{6,})/i, src: (m) => `https://www.youtube-nocookie.com/embed/${m[1]}` },
  { name: 'vimeo', test: /^https:\/\/(?:www\.)?vimeo\.com\/(\d{6,})/i, src: (m) => `https://player.vimeo.com/video/${m[1]}` },
  { name: 'dailymotion', test: /^https:\/\/(?:www\.)?dailymotion\.com\/video\/([a-z0-9]{5,})/i, src: (m) => `https://www.dailymotion.com/embed/video/${m[1]}` },
  { name: 'loom', test: /^https:\/\/(?:www\.)?loom\.com\/share\/([a-f0-9]{16,})/i, src: (m) => `https://www.loom.com/embed/${m[1]}` },

  // صوت
  { name: 'spotify', test: /^https:\/\/open\.spotify\.com\/(track|episode|show|album|playlist)\/([A-Za-z0-9]{10,})/i, src: (m) => `https://open.spotify.com/embed/${m[1].toLowerCase()}/${m[2]}` },
  { name: 'soundcloud', test: /^https:\/\/soundcloud\.com\/[\w-]+\/[\w-]+/i, src: (m) => `https://w.soundcloud.com/player/?url=${encodeURIComponent(m[0])}` },

  // تواصل — من ينشر نقطة إطار
  { name: 'tiktok', test: /^https:\/\/(?:www\.)?tiktok\.com\/@[\w.-]+\/video\/(\d{6,})/i, src: (m) => `https://www.tiktok.com/embed/v2/${m[1]}` },
  { name: 'instagram', test: /^https:\/\/(?:www\.)?instagram\.com\/(p|reel)\/([\w-]{5,})/i, src: (m) => `https://www.instagram.com/${m[1]}/${m[2]}/embed` },
  { name: 'facebook', test: /^https:\/\/(?:www\.)?facebook\.com\/[\w.-]+\/(?:posts|videos)\/[\w.-]+/i, src: (m) => `https://www.facebook.com/plugins/post.php?href=${encodeURIComponent(m[0])}` },
  { name: 'linkedin', test: /^https:\/\/(?:www\.)?linkedin\.com\/embed\/feed\/update\/([\w:-]+)/i, src: (m) => `https://www.linkedin.com/embed/feed/update/${m[1]}` },

  // مستندات وخرائط
  { name: 'google-maps', test: /^https:\/\/(?:www\.)?google\.com\/maps\/embed\?pb=([^"'\s]+)/i, src: (m) => `https://www.google.com/maps/embed?pb=${m[1]}` },
  { name: 'google-docs', test: /^https:\/\/docs\.google\.com\/(document|spreadsheets|presentation|forms)\/d\/(?:e\/)?([\w-]{10,})/i, src: (m) => `https://docs.google.com/${m[1]}/d/${m[2]}/preview` },
];

/* شكل الإطار. مقطع تيك توك في صندوق 16:9 يظهر شريطين أسودين وصورةً
   صغيرة في وسطهما، ومشغّل ساوندكلاود في الصندوق نفسه يترك ثلاثة أرباعه
   فارغة. الشكل من المزوّد لا من ذوقنا. */
export type EmbedShape = 'wide' | 'tall' | 'card' | 'strip';

const SHAPE: Record<string, EmbedShape> = {
  youtube: 'wide', vimeo: 'wide', dailymotion: 'wide', loom: 'wide', 'google-maps': 'wide',
  tiktok: 'tall',
  instagram: 'card', facebook: 'card', linkedin: 'card', 'google-docs': 'card',
  spotify: 'strip', soundcloud: 'strip',
};

export type EmbedInfo = { src: string; name: string; shape: EmbedShape };

/** بيانات الإطار لمزوّد مسجَّل، أو null فتُعرض بطاقة رابط. */
export function embedInfo(url: string): EmbedInfo | null {
  const u = String(url || '').trim();
  for (const p of EMBED_PROVIDERS) {
    const m = u.match(p.test);
    if (m) return { src: p.src(m), name: p.name, shape: SHAPE[p.name] || 'wide' };
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
function headingId(text: string, index: number): string {
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
function paragraphs(text: string, ctx: StyleCtx, ink = ''): string {
  const { inline, theme } = ctx;
  // الحبر يأتي آخراً فيغلب: لونٌ اختاره الكاتب يعلو لون المتن في السمة.
  const decls = inline
    ? mergeDecls(`margin:0 0 14px;line-height:1.9;font-size:${baseSize(theme)}px;color:${theme.text}`, ink)
    : ink;
  const attr = styleAttr(decls);
  return String(text || '')
    .split(/\n{2,}/)
    .filter((p) => p.trim())
    .map((p) => `<p${attr}>${renderInline(p, inline, theme.link).replace(/\n/g, '<br>')}</p>`)
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
function linkCard(url: string, title: string, note: string, inline: boolean, theme: NewsletterTheme = DEFAULT_THEME): string {
  const safe = /^https?:\/\//i.test(url) ? url : '';
  if (!safe) return '';
  const st = inline
    ? ` style="display:block;margin:18px 0;padding:14px 16px;background:${EMAIL.muted};border:1px solid ${theme.border};border-radius:${RADIUS_PX[theme.radius]};text-decoration:none"`
    : ' class="link-card"';
  const tSt = inline ? ` style="display:block;font-weight:600;color:${theme.link};margin-bottom:4px"` : '';
  const nSt = inline ? ` style="display:block;font-size:13px;color:${EMAIL.mutedForeground}"` : ' class="link-card-note"';
  return `<a href="${escapeHtml(safe)}"${st}>` +
    `<span${tSt}>${escapeHtml(title || safe)}</span>` +
    (note ? `<span${nSt}>${escapeHtml(note)}</span>` : '') +
    `</a>`;
}

/* إطار التضمين. الضوابط الثلاثة ليست زينة:
   referrerpolicy يمنع تسريب مسار المقالة إلى المزوّد، وloading=lazy
   يمنع تحميله قبل أن يبلغه القارئ، وsandbox يحرم الإطار من التنقّل
   بالصفحة الأمّ ومن فتح النوافذ — وهو ما يجعل تضميناً خبيثاً عاجزاً
   عن نقل القارئ إلى حيث لم يقصد. */
function iframeHtml(info: EmbedInfo, title: string): string {
  return `<div class="embed-frame embed-${info.shape}">` +
    `<iframe src="${escapeHtml(info.src)}" title="${escapeHtml(title)}" loading="lazy" allowfullscreen ` +
    `referrerpolicy="strict-origin-when-cross-origin" ` +
    `sandbox="allow-scripts allow-same-origin allow-presentation allow-popups-to-escape-sandbox"></iframe></div>`;
}

/* mediaBase: أصل مطلق لروابط الوسائط (البريد لا يعرض الروابط النسبية)
   theme: سمة النشرة. غيابها يعني الافتراضي، وهو مرايا رموز naf-theme
   نفسها — فنشرةٌ لم تُخصَّص تخرج كما كانت تخرج قبل التخصيص حرفياً. */
export function renderBlocks(
  blocks: Block[], mode: 'email' | 'web', mediaBase = '', theme: NewsletterTheme = DEFAULT_THEME,
): string {
  const out: string[] = [];
  const inline = mode === 'email';
  const ctx: StyleCtx = { inline, theme };
  const base = baseSize(theme);
  const mediaUrl = (b: any) => (b.url ? b.url : b.mediaId ? `${mediaBase}/api/media/${b.mediaId}` : '');

  /* لونٌ من السمة. البريد يكتبه دائماً — لا ورقة أنماط هناك. والويب لا
     يكتبه إلا إذا غيّره الكاتب فعلاً: الصفحة العامة تعيش داخل ثيم
     الموقع وتتبع وضع القارئ، وكتابةُ اللون الافتراضي عليها تجمّدها
     فاتحةً في الوضع الداكن بلا أن يطلب ذلك أحد. */
  const themed = (v: string, d: string) => (inline ? v : (v !== d ? v : ''));
  const ink = (b: Block) => inkDecls(b.style, ctx);
  const surface = (b: Block) => surfaceDecls(b.style, ctx);

  /* مصدرٌ يصلح لوسم <video>/<audio> فعلاً: وسيطٌ مرفوع، أو رابطٌ ينتهي
     بامتداد وسيط. ورابطُ صفحةٍ عادية ليس منهما — ووضعُه في src يُخرج
     مشغّلاً لا يشتغل، وهو فشلٌ صامت لا يراه الكاتب إلا بعد النشر. */
  const playable = (b: any, exts: RegExp): string => {
    if (b.mediaId) return `${mediaBase}/api/media/${b.mediaId}`;
    return b.url && exts.test(b.url) ? b.url : '';
  };
  const VIDEO_EXT = /\.(mp4|webm|ogg|ogv|mov|m4v)(\?|#|$)/i;
  const AUDIO_EXT = /\.(mp3|m4a|aac|wav|oga|ogg|opus|flac)(\?|#|$)/i;

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
        /* حجم العنوان ينسب إلى مقياس المتن في السمة: نشرةٌ متنُها ١٨
           وعناوينها ٢٢ تفقد التدرّج الذي يجعل العنوان عنواناً. */
        const px = Math.round((lvl === 2 ? 22 : 18) * (base / 16));
        const baseDecls = inline
          ? `margin:26px 0 12px;font-size:${px}px;font-weight:700;color:${theme.heading}`
          : (themed(theme.heading, DEFAULT_THEME.heading) ? `color:${theme.heading}` : '');
        const decls = mergeDecls(baseDecls, ink(b), surface(b));
        // المعرّف للويب وحده: Gmail يحذف id، ففهرسٌ برابط داخلي في
        // البريد يعطي القارئ روابط لا تصل إلى شيء.
        const idAttr = inline ? '' : ` id="${escapeHtml(headingIds.get(bi) || '')}"`;
        out.push(`<h${lvl}${idAttr}${styleAttr(decls)}>${escapeHtml(b.text)}</h${lvl}>`);
        break;
      }
      case 'text': {
        const box = surface(b);
        const body = paragraphs(b.text, ctx, ink(b));
        // الحاوية لا تُكتب إلا حين يصبغ الكاتب سطحاً أو يحاذي — وإلا
        // بقيت الفقرات كما كانت بلا `<div>` زائد حول كل نصّ في النشرة.
        out.push(box ? `<div${styleAttr(mergeDecls('margin:18px 0', box))}>${body}</div>` : body);
        break;
      }
      case 'image': {
        const src = mediaUrl(b);
        if (!src) break;
        const radius = b.style?.radius ? RADIUS_PX[b.style.radius] : EMAIL.radius;
        const st = inline
          ? ` style="max-width:100%;height:auto;border-radius:${radius};display:block;margin:0 auto"`
          : (b.style?.radius ? ` style="border-radius:${radius}"` : '');
        const figDecls = mergeDecls(inline ? 'margin:18px 0' : '', alignDecl(b.style, ctx));
        out.push(`<figure${styleAttr(figDecls)}>` +
          `<img src="${escapeHtml(src)}" alt="${escapeHtml(b.alt || '')}"${st}>` +
          (b.caption ? `<figcaption${inline ? ` style="font-size:13px;color:${EMAIL.mutedForeground};text-align:center;margin-top:6px"` : ''}>${escapeHtml(b.caption)}</figcaption>` : '') +
          `</figure>`);
        break;
      }
      case 'button': {
        if (!b.url) break;
        // لون الزر: تخصيص الكتلة أولاً، ثم السمة، ثم الافتراضي.
        const bg = b.style?.background || theme.buttonBackground;
        const fg = b.style?.color || theme.buttonText;
        const radius = RADIUS_PX[b.style?.radius || theme.radius];
        const width = b.style?.full ? 'display:block;text-align:center' : 'display:inline-block';
        const sized = b.style?.size ? `;font-size:${inline ? `${sizePx(b.style.size, base)}px` : `var(--text-${b.style.size === 'md' ? 'base' : b.style.size})`}` : '';
        const st = inline
          ? ` style="${width};background:${bg};color:${fg};text-decoration:none;padding:12px 22px;border-radius:${radius};font-weight:600${sized}"`
          // الويب يبقى على صنف `.btn` ما لم يخصّص الكاتب شيئاً — فيتبع
          // الثيم ووضع القارئ. وأول لونٍ يختاره ينقل الزرّ إلى قيمه.
          : (b.style?.background || b.style?.color || b.style?.radius || b.style?.full || b.style?.size
              ? ` class="btn" style="${width};background:${bg};color:${fg};border-radius:${radius}${sized}"`
              : ' class="btn"');
        const align = b.style?.align ? (inline ? (b.style.align === 'center' ? 'center' : b.style.align === 'end' ? 'left' : 'right') : b.style.align) : 'center';
        out.push(`<p style="text-align:${align}${inline ? ';margin:22px 0' : ''}">` +
          `<a href="${escapeHtml(b.url)}"${st}>${escapeHtml(b.text || 'اقرأ المزيد')}</a></p>`);
        break;
      }
      case 'quote': {
        const edge = b.style?.border || theme.link;
        const st = inline
          // border-right لا border-inline-start: عملاء البريد المكتبية لا تدعم
          // الخصائص المنطقية. جهة RTL مكتوبة مباشرةً — استثناء CLAUDE.md §1.
          ? styleAttr(mergeDecls(
              `margin:18px 0;padding:12px 16px;border-right:3px solid ${edge};background:${b.style?.background || EMAIL.primarySoft};color:${theme.text}`,
              ink(b), alignDecl(b.style, ctx),
            ))
          : styleAttr(mergeDecls(
              b.style?.border ? `border-inline-start-color:${edge}` : '',
              b.style?.background ? `background:${b.style.background}` : '',
              ink(b), alignDecl(b.style, ctx),
            ));
        // الاقتباس يقبل التنسيق داخله — شاهدٌ من نظام يحمل رابطاً إلى مصدره.
        // والمصدر (cite) اسمٌ مجرّد فيبقى مهرّباً بلا علامات.
        out.push(`<blockquote${st}>${renderInline(b.text, inline, theme.link)}${b.cite ? `<cite> — ${escapeHtml(b.cite)}</cite>` : ''}</blockquote>`);
        break;
      }
      case 'divider': {
        const line = b.style?.border || b.style?.color || theme.border;
        out.push(inline
          ? `<hr style="border:none;border-top:1px solid ${line};margin:26px 0">`
          : (b.style?.border || b.style?.color ? `<hr style="border:none;border-top:1px solid ${line}">` : '<hr>'));
        break;
      }

      case 'callout': {
        const tone = CALLOUT[b.tone as CalloutTone] ? (b.tone as CalloutTone) : 'primary';
        const c = CALLOUT[tone];
        const title = (b.title || '').trim() || c.label;
        /* التخصيص يعلو النغمة ولا يمحوها: العنوان يبقى ظاهراً كما هو —
           §6 يمنع نقل المعنى باللون وحده، ولونٌ يختاره الكاتب لبطاقة
           تحذيرٍ لا يُسقط كلمة «تحذير» عنها. */
        const bg = b.style?.background || c.bg;
        const edge = b.style?.border || c.fg;
        const radius = RADIUS_PX[b.style?.radius || 'md'];
        // border-right لا border-inline-start — عملاء البريد المكتبية لا
        // تدعم الخصائص المنطقية. جهة RTL مكتوبة مباشرةً، استثناء §1.
        const st = inline
          ? styleAttr(mergeDecls(
              `margin:18px 0;padding:14px 16px;background:${bg};border-right:3px solid ${edge};border-radius:${radius}`,
              alignDecl(b.style, ctx),
            ))
          : ` class="callout callout-${tone}"${styleAttr(mergeDecls(
              b.style?.background ? `background:${bg}` : '',
              b.style?.border ? `border-inline-start-color:${edge}` : '',
              b.style?.radius ? `border-radius:${radius}` : '',
              alignDecl(b.style, ctx),
            ))}`;
        const head = title
          ? (inline
              ? `<strong style="display:block;margin-bottom:6px;color:${edge};font-size:${Math.round(15 * (base / 16))}px">${escapeHtml(title)}</strong>`
              : `<strong class="callout-title"${b.style?.border ? ` style="color:${edge}"` : ''}>${escapeHtml(title)}</strong>`)
          : '';
        const body = inline
          ? `<span style="${mergeDecls(`color:${theme.text};line-height:1.9;font-size:${base}px`, inkDecls(b.style, ctx))}">${renderInline(b.text, true, theme.link)}</span>`
          : (ink(b) ? `<span style="${ink(b)}">${renderInline(b.text, false, theme.link)}</span>` : renderInline(b.text, false, theme.link));
        out.push(`<div${st}>${head}${body}</div>`);
        break;
      }

      case 'table': {
        const rows = Array.isArray(b.rows) ? b.rows.filter((r) => Array.isArray(r)) : [];
        if (!rows.length) break;
        const tSt = inline
          ? ` style="width:100%;border-collapse:collapse;margin:18px 0;font-size:${Math.round(15 * (base / 16))}px"`
          : ' class="article-table"';
        // الخلايا محاذاة يمين صراحةً في البريد: text-start غير مدعوم،
        // والجدول بلا محاذاة يعود يساراً في عملاء لا تقرأ dir.
        const edge = b.style?.border || theme.border;
        const headBg = b.style?.background || EMAIL.muted;
        const cell = (v: string, head: boolean) => {
          const st = inline
            ? styleAttr(mergeDecls(
                `border:1px solid ${edge};padding:8px 10px;text-align:${b.style?.align === 'center' ? 'center' : b.style?.align === 'end' ? 'left' : 'right'};${head ? `background:${headBg};font-weight:600;` : ''}color:${theme.text}`,
                inkDecls(b.style, ctx),
              ))
            : styleAttr(mergeDecls(
                b.style?.border ? `border-color:${edge}` : '',
                head && b.style?.background ? `background:${headBg}` : '',
                alignDecl(b.style, ctx),
                inkDecls(b.style, ctx),
              ));
          const tag = head ? 'th' : 'td';
          return `<${tag}${st}>${renderInline(v, inline, theme.link)}</${tag}>`;
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
          ? ` style="margin:18px 0;padding:14px 16px;background:${b.style?.background || EMAIL.muted};border:1px solid ${b.style?.border || theme.border};border-radius:${RADIUS_PX[b.style?.radius || 'md']};font-family:${EMAIL.monoStack};font-size:${Math.round(14 * (base / 16))}px;line-height:1.7;white-space:pre-wrap;word-break:break-word;direction:ltr;text-align:left;color:${b.style?.color || theme.text}"`
          : ` class="article-code"${styleAttr(mergeDecls(
              b.style?.background ? `background:${b.style.background}` : '',
              b.style?.border ? `border-color:${b.style.border}` : '',
              b.style?.color ? `color:${b.style.color}` : '',
            ))}`;
        // الكود لا يمرّ على renderInline: نجمةٌ في الكود نجمة لا مائل.
        out.push(`<pre${st}><code>${escapeHtml(b.text)}</code></pre>`);
        break;
      }

      case 'footnote': {
        noteNo += 1;
        const st = inline
          ? ` style="color:${b.style?.color || theme.link};font-size:12px;vertical-align:super"`
          : (b.style?.color ? ` class="fn-ref" style="color:${b.style.color}"` : ' class="fn-ref"');
        const href = inline ? '' : ` href="#fn-${noteNo}" id="fnref-${noteNo}"`;
        out.push(`<sup><a${href}${st}>${noteNo}</a></sup>`);
        break;
      }

      case 'audio': {
        const title = b.title || 'صوت';
        const src = playable(b, AUDIO_EXT);
        // البريد لا يشغّل صوتاً — ولا عميلَ واحداً يُعوَّل عليه — فبطاقة رابط.
        if (inline) {
          const target = b.url || src;
          if (target) out.push(linkCard(target, title, 'استماع', true, theme));
          break;
        }
        if (src) {
          out.push(`<figure class="media-block"><figcaption>${escapeHtml(title)}</figcaption>` +
            `<audio controls preload="none" src="${escapeHtml(src)}"></audio></figure>`);
        } else if (b.url) {
          out.push(linkCard(b.url, title, 'استماع', false, theme));
        }
        break;
      }

      case 'file': {
        const src = mediaUrl(b);
        if (!src) break;
        // «تنزيل» وصفُ الفعل في البطاقة، من naf-terms.md §١.
        out.push(inline
          ? linkCard(src, b.title || 'ملف', b.note || 'تنزيل', true, theme)
          : `<a class="link-card" href="${escapeHtml(src)}" download>` +
            `<span class="link-card-title">${escapeHtml(b.title || 'ملف')}</span>` +
            `<span class="link-card-note">${escapeHtml(b.note || 'تنزيل')}</span></a>`);
        break;
      }

      case 'video': {
        const provider = b.url ? embedInfo(b.url) : null;
        const src = playable(b, VIDEO_EXT);
        if (inline) {
          // لا فيديو في صندوق الوارد: بطاقة رابط أياً كان المصدر.
          const target = b.url || src;
          if (target) out.push(linkCard(target, 'فيديو', 'مشاهدة', true, theme));
          break;
        }
        if (provider) out.push(iframeHtml(provider, 'فيديو'));
        else if (src) out.push(`<figure class="media-block"><video controls preload="none" src="${escapeHtml(src)}"></video></figure>`);
        else if (b.url) out.push(linkCard(b.url, 'فيديو', 'مشاهدة', false, theme));
        break;
      }

      case 'embed': {
        const provider = embedInfo(b.url);
        // البريد يحذف iframe دائماً، والويب لا يضمّن إلا مزوّداً مسجّلاً.
        if (inline || !provider) {
          out.push(linkCard(b.url, b.title || '', 'فتح الرابط', inline, theme));
          break;
        }
        out.push(iframeHtml(provider, b.title || 'تضمين'));
        break;
      }

      case 'columns': {
        /* البريد يبني الأعمدة بجدول لا بـflex — عملاء أوتلوك يتجاهلون
           flex وgrid فتنهار الأعمدة فوق بعضها بلا فاصل. والجدول يعمل
           في كل عميل منذ عشرين سنة.

           والويب يستعمل grid ينهار عمودياً تحت 480px: عمودان بعرض
           ١٨٧ بكسل على شاشة ٣٧٥ لا يُقرآن. */
        const a = renderInline(b.start, inline, theme.link);
        const z = renderInline(b.end, inline, theme.link);
        if (inline) {
          const cSt = styleAttr(mergeDecls(
            `width:50%;vertical-align:top;padding:0 8px;line-height:1.9;font-size:${base}px;color:${theme.text}`,
            inkDecls(b.style, ctx), alignDecl(b.style, ctx),
          ));
          out.push(`<table${styleAttr(mergeDecls('width:100%;border-collapse:collapse;margin:18px 0', surface(b)))}><tr>` +
            `<td${cSt}>${a}</td><td${cSt}>${z}</td></tr></table>`);
        } else {
          const cSt = styleAttr(mergeDecls(inkDecls(b.style, ctx), alignDecl(b.style, ctx)));
          out.push(`<div class="columns"${styleAttr(surfaceDecls({ ...b.style, align: undefined }, ctx))}>` +
            `<div${cSt}>${a}</div><div${cSt}>${z}</div></div>`);
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
        const liSt = inline
          ? styleAttr(mergeDecls(`margin:6px 0;line-height:1.9;font-size:${base}px;color:${theme.text}`, inkDecls(b.style, ctx)))
          : styleAttr(inkDecls(b.style, ctx));
        const body = items.map((it) => {
          const text = renderInline(it.text || '', inline, theme.link);
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
          ? ` style="margin:18px 0;padding:14px 16px;background:${b.style?.background || EMAIL.muted};border-radius:${RADIUS_PX[b.style?.radius || 'md']}"`
          : ` class="article-toc"${styleAttr(b.style?.background ? `background:${b.style.background}` : '')}`;
        const items = headings.map((h, n) => {
          const label = escapeHtml(h.b.text);
          // البريد بلا روابط داخلية — Gmail يحذف id، فالبند نصّ لا رابط.
          const inner = inline
            ? `<span style="color:${b.style?.color || theme.text}">${label}</span>`
            : `<a href="#${escapeHtml(headingIds.get(h.i) || '')}"${styleAttr(b.style?.color ? `color:${b.style.color}` : '')}>${label}</a>`;
          const liSt = inline ? ` style="margin:4px 0;line-height:1.9;font-size:${Math.round(15 * (base / 16))}px"` : '';
          return `<li${liSt}>${inner}</li>`;
        }).join('');
        const head = inline
          ? `<strong style="display:block;margin-bottom:8px;color:${b.style?.color || theme.text};font-size:${Math.round(15 * (base / 16))}px">المحتويات</strong>`
          : '<strong class="toc-title">المحتويات</strong>';
        const listSt = inline ? ' style="margin:0;padding-right:20px"' : '';
        out.push(`<div${st}>${head}<ol${listSt}>${items}</ol></div>`);
        break;
      }
    }
  }

  // الحواشي في آخر المقال بترتيب ورودها — بعد كل الكتل لا بينها.
  if (notes.length) {
    const secSt = inline ? ` style="margin:26px 0 0;padding-top:14px;border-top:1px solid ${theme.border}"` : ' class="article-footnotes"';
    const head = inline
      ? `<strong style="display:block;margin-bottom:8px;color:${theme.text};font-size:${Math.round(15 * (base / 16))}px">الحواشي</strong>`
      : '<strong class="fn-title">الحواشي</strong>';
    const listSt = inline ? ' style="margin:0;padding-right:20px"' : '';
    const items = notes.map((n, i) => {
      const liSt = inline ? ` style="margin:6px 0;line-height:1.8;font-size:13px;color:${EMAIL.mutedForeground}"` : '';
      // «رجوع» كلمةً لا سهماً: السهم المعقوف U+21A9 يُعرض إيموجي ملوّناً
      // في أنظمة، و§3 يمنعه. والكلمة مسجّلة في naf-terms.md §١.
      const back = inline ? '' : ` <a href="#fnref-${i + 1}" class="fn-back">رجوع</a>`;
      return `<li${liSt}${inline ? '' : ` id="fn-${i + 1}"`}>${renderInline(n.text, inline, theme.link)}${back}</li>`;
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
    } else if (b.type === 'columns') {
      // العمودان متنٌ يقرؤه القارئ لا بنية — إسقاطهما كان يحذف فقرتين
      // كاملتين من المقتطف ومن منشور التواصل بلا أثر ظاهر.
      parts.push(stripInline(b.start), stripInline(b.end));
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

/* ===== صياغة المقالة لكل منصة =====

   كان النشر يعرف صيغتين: سلسلةَ إكس، ونصَّ لينكدإن لكل ما عداها. فمن
   نشر على ثريدز أرسل نصّاً بطول تسعمئة حرف إلى منصةٍ حدّها خمسمئة،
   فقُطع في منتصف جملة — أو رُفض كاملاً.

   الحدود أدناه من المنصات نفسها. وهي حدُّ قَبولٍ لا حدُّ ذوق: تجاوزها
   يعني رفض المنشور أو بتره، لا مجرّد طول. */
export const SOCIAL_LIMIT: Record<string, number> = {
  x: 280,
  threads: 500,
  google: 1500,
  instagram: 2200,
  tiktok: 2200,
  linkedin: 3000,
  linkedin_page: 3000,
  youtube: 5000,
  facebook: 5000,
  snapchat: 250,
};

/* منصاتٌ لا يُنشر عليها منشورٌ نصّيّ للمقالة.

   إنستغرام وتيك توك وسناب شات وسائطُ أولاً: منشورٌ بلا صورة ولا مقطع
   يُرفض من واجهاتها أصلاً. وإدراجها في قائمة النشر يَعِد الكاتب بما
   يفشل عند الضغط، فتُستثنى ويُقال له لماذا. */
export const SOCIAL_MEDIA_FIRST = new Set(['instagram', 'tiktok', 'snapchat']);

/** المنصات التي تقبل نشر مقالةٍ نصّاً. */
export function socialTargets(): string[] {
  return Object.keys(SOCIAL_LIMIT).filter((p) => !SOCIAL_MEDIA_FIRST.has(p));
}

/**
 * يصوغ المقالة لمنصة بعينها. إكس سلسلة، وما عداها منشورٌ واحد يُقصّ
 * على حدّ المنصة مع إبقاء الرابط كاملاً — رابطٌ مبتور لا يفتح شيئاً.
 */
export function socialText(
  platform: string, title: string, blocks: Block[], url: string, excerpt?: string | null,
): string {
  if (platform === 'x') return toXThread(title, blocks, url).join('\n\n');

  const limit = SOCIAL_LIMIT[platform] || 1000;
  const body = (excerpt || blocksToText(blocks)).trim();
  const tail = `\n\nاقرأ المقالة كاملة:\n${url}`;
  // الرابط والعنوان يُحجزان أولاً، وما بقي هو مساحة المتن.
  const room = limit - title.length - tail.length - 2; // 2 لسطرَي الفصل
  if (room <= 0) return `${title}\n${url}`.slice(0, limit);
  /* القصّ إلى room-1 لا room: علامة الحذف حرفٌ يُضاف بعده. ومتنٌ بلا
     فراغ (لا يجد ما يتراجع إليه) كان يُخرج limit+1 فيُرفض المنشور
     على منصةٍ تحسب الحرف. */
  const trimmed = body.length > room ? `${body.slice(0, room - 1).replace(/\s+\S*$/, '')}…` : body;
  return `${title}\n\n${trimmed}${tail}`;
}

