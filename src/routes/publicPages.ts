import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { newId } from '../util';
import { parseBlocks, renderBlocks, publicSettings, articleUrl, escapeHtml } from '../services/newsletter';
import { parseTheme, isCustomTheme, WIDTH_PX, RADIUS_PX } from '../services/blockStyle';
import { sendWelcome } from '../services/newsletterSend';

// الصفحات العامة (بلا مصادقة): المقالات، الاشتراك، إلغاء الاشتراك.
// تُخدَّم HTML من الخادم كي تُفهرس وتظهر معاينتها عند المشاركة (وسوم OG).
export const publicRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

type Row = {
  id: string; title: string; slug: string; excerpt: string | null; blocks_json: string;
  cover_media_id: string | null; published_at: string | null; theme_json?: string | null;
};

/* ===== لوحة المقالة المخصّصة =====

   الصفحة العامة تعيش داخل ثيم الموقع وتتبع وضع القارئ — وهو الصحيح
   لمقالةٍ لم يخصّص كاتبها شيئاً، فتُقرأ فاتحةً نهاراً وداكنةً ليلاً.

   لكن كاتباً اختار متناً بلونٍ فاتح على سطحٍ داكن اختار الزوجَ معاً.
   وتطبيقُ نصف اختياره — لونُه على خلفية الموقع — يُخرج نصّاً لا يُقرأ
   في أحد الوضعين حتماً. فحين تُخصَّص السمة تُفرض لوحتها على المقالة
   وحدها: سطحُها وعرضها واستدارتها ولون متنها، و`color-scheme:light`
   كي لا يقلب المتصفّح ألوان النموذج داخلها.

   والحدّ ضيّق عمداً: المقالة وحدها. الترويسة والتذييل ونموذج الاشتراك
   تبقى على ثيم الموقع، فلا تصير صفحةً بهويتين. */
function articleCanvas(themeJson: string | null | undefined): { open: string; close: string } {
  const t = parseTheme(themeJson);
  if (!isCustomTheme(t)) return { open: '', close: '' };
  const decls = [
    `background:${t.cardBackground}`,
    `color:${t.text}`,
    `max-width:${WIDTH_PX[t.width]}px`,
    `border-radius:${RADIUS_PX[t.radius]}`,
    'color-scheme:light',
    'margin-inline:auto',
    'padding:var(--space-6)',
  ].join(';');
  return { open: `<div class="article-canvas" style="${decls}">`, close: '</div>' };
}

/* بيانات منظّمة للمقالة — شقّ AEO.

   الوسوم أعلاه تكفي محرّكات البحث ولا تكفي نماذج الإجابة: تلك تقرأ
   schema.org لتعرف من كتب ومتى نُشر وأيّ جهة تقف خلف النصّ. وبلا
   JSON-LD تُقتبس المقالة بلا نسبة أو لا تُقتبس.

   والقيم كلّها من الصفحة نفسها — لا يُخترع تاريخ ولا مؤلّف. حقلٌ
   بلا قيمة يسقط من الكائن ولا يُملأ بفراغ: بياناتٌ منظّمة كاذبة أسوأ
   من غيابها. */
export type JsonLdKind = 'Article' | 'CollectionPage';

export function articleJsonLd(o: {
  title: string; description: string; canonical: string; image?: string; siteName: string;
  published?: string | null; modified?: string | null; author?: string | null;
  kind?: JsonLdKind;
}): string {
  const data: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': o.kind || 'Article',
    headline: o.title,
    inLanguage: 'ar',
    mainEntityOfPage: { '@type': 'WebPage', '@id': o.canonical },
    url: o.canonical,
    publisher: { '@type': 'Organization', name: o.siteName },
  };
  if (o.description) data.description = o.description;
  if (o.image) data.image = [o.image];
  if (o.published) data.datePublished = o.published;
  if (o.modified) data.dateModified = o.modified;
  if (o.author) data.author = { '@type': 'Person', name: o.author };

  /* JSON داخل <script> يُنهى بـ`</script>` لو حملت قيمةٌ ذلك النصّ.
     نهرّب الشرطة المائلة فيبقى JSON صحيحاً ويستحيل كسر الوسم. */
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

function layout(opts: {
  title: string; description: string; canonical: string; image?: string; body: string; siteName: string;
  published?: string | null; modified?: string | null; author?: string | null;
  /* البيانات المنظّمة اختيارية ولا تُصدَّر إلا حين تُطلب صراحةً.

     كانت تُصدَّر من هنا بلا شرط، فحملت صفحةُ الفهرس و٤٠٤ وتأكيدُ
     الاشتراك وإلغاؤه كلُّها `"@type":"Article"` — أربعُ صفحاتٍ تُخبر
     المفهرس أنها مقالات وليست. وهو ما يمنعه التعليق فوق الدالة
     نفسها: بياناتٌ منظّمة كاذبة أسوأ من غيابها. */
  jsonLd?: JsonLdKind;
}): string {
  const { title, description, canonical, image, body, siteName } = opts;
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(canonical)}">
<meta property="og:type" content="${opts.jsonLd === 'Article' ? 'article' : 'website'}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(canonical)}">
<meta property="og:site_name" content="${escapeHtml(siteName)}">
${image ? `<meta property="og:image" content="${escapeHtml(image)}">` : ''}
<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
${image ? `<meta name="twitter:image" content="${escapeHtml(image)}">` : ''}
<link rel="icon" type="image/svg+xml" href="/brand/naf-mark.svg">
<link rel="stylesheet" href="/naf-public.css">
${opts.jsonLd ? `<script type="application/ld+json">${articleJsonLd({
  title, description, canonical, image, siteName, kind: opts.jsonLd,
  published: opts.published, modified: opts.modified, author: opts.author,
})}</script>` : ''}
<style>
  /* رموز ناف كلها من /naf-public.css المولَّد من naf-theme.css في السجلّ.
     لا قيمة لون ولا خط هنا — الوضع الداكن يتبع تفضيل النظام تلقائياً. */
  * { box-sizing: border-box; }
  body { margin:0; font-family: var(--font-sans);
         background: var(--background); color: var(--foreground); line-height:1.9; }
  .wrap { max-width: 720px; margin: 0 auto; padding: 32px 20px 64px; }
  header.site { border-bottom:1px solid var(--border); padding:16px 0; margin-bottom:28px;
                display:flex; align-items:center; gap:12px; }
  header.site picture, header.site img { height:36px; width:auto; }
  header.site a { color: var(--primary); text-decoration:none; font-weight:700; }
  h1 { font-size:var(--text-3xl); line-height:1.4; margin: 0 0 10px; }
  .meta { color: var(--muted-foreground); font-size:var(--text-sm); margin-bottom:24px; }
  img { max-width:100%; height:auto; border-radius: calc(var(--radius) + 4px); }
  figure { margin: 20px 0; }
  figcaption { font-size:var(--text-xs); color: var(--muted-foreground); text-align:center; margin-top:8px; }
  blockquote { margin:20px 0; padding:12px 16px;
               border-inline-start:3px solid var(--primary); background: var(--primary-soft); }
  hr { border:none; border-top:1px solid var(--border); margin:28px 0; }

  /* كتل المقال الجديدة. الصفحة العامة تقرأ الرموز — لا استثناء البريد
     هنا — فكلّها من naf-theme.css وتتبع الوضعين. */
  .callout { margin:20px 0; padding:14px 16px; border-radius: var(--radius);
             border-inline-start:3px solid; }
  .callout-title { display:block; margin-bottom:6px; font-size:var(--text-sm); }
  .callout-info { background: var(--info-soft); border-color: var(--info-strong); }
  .callout-info .callout-title { color: var(--info-strong); }
  .callout-warning { background: var(--warning-soft); border-color: var(--warning-strong); }
  .callout-warning .callout-title { color: var(--warning-strong); }
  .callout-primary { background: var(--primary-soft); border-color: var(--primary); }
  .callout-primary .callout-title { color: var(--primary-strong); }

  .article-table { width:100%; border-collapse:collapse; margin:20px 0;
                   font-size:var(--text-sm); font-variant-numeric: tabular-nums; }
  .article-table th, .article-table td { border:1px solid var(--border);
                                         padding:8px 10px; text-align:start; }
  .article-table th { background: var(--muted); font-weight:600; }
  /* الجدول العريض يمرّر داخل حاويته ولا يمدّ الصفحة أفقياً */
  .table-scroll { overflow-x:auto; }

  /* الكود اتجاهه LTR بطبيعته — لغةُ برمجةٍ لا نصٌّ عربي. */
  .article-code { margin:20px 0; padding:14px 16px; background: var(--muted);
                  border:1px solid var(--border); border-radius: var(--radius);
                  font-family: var(--font-mono); font-size:var(--text-sm); line-height:1.7;
                  direction:ltr; text-align:start; overflow-x:auto; }
  .article-code code { font-family:inherit; }

  .article-toc { margin:20px 0; padding:14px 16px; background: var(--muted);
                 border-radius: var(--radius); }
  .toc-title, .fn-title { display:block; margin-bottom:8px; font-size:var(--text-sm); }
  .article-toc a { color: var(--foreground); }

  .article-footnotes { margin-top:32px; padding-top:16px; border-top:1px solid var(--border);
                       font-size:var(--text-sm); color: var(--muted-foreground); }
  .fn-ref { color: var(--primary); text-decoration:none; }
  .fn-back { font-size:var(--text-xs); margin-inline-start:6px; }
  .fn-ref:focus-visible, .fn-back:focus-visible, .article-toc a:focus-visible {
    outline:2px solid var(--ring); outline-offset:2px; }

  .link-card { display:block; margin:20px 0; padding:14px 16px; background: var(--muted);
               border:1px solid var(--border); border-radius: var(--radius); text-decoration:none; }
  .link-card-title, .link-card > span:first-child { display:block; font-weight:600;
                                                    color: var(--primary); margin-bottom:4px; }
  .link-card-note { display:block; font-size:var(--text-xs); color: var(--muted-foreground); }
  .link-card:focus-visible { outline:2px solid var(--ring); outline-offset:2px; }

  .media-block { margin:20px 0; }
  .media-block audio, .media-block video { width:100%; border-radius: var(--radius); }
  /* الإطار يحفظ ارتفاعه قبل التحميل فلا تقفز الصفحة عند وصوله.
     والشكل من المزوّد لا من ذوقنا: مقطع تيك توك طوليّ، ومشغّل
     سبوتيفاي شريط، ومنشور إنستغرام بطاقة. */
  .embed-frame { position:relative; margin:20px 0; aspect-ratio:16/9;
                 border-radius: var(--radius); overflow:hidden; border:1px solid var(--border); }
  .embed-frame iframe { position:absolute; inset:0; width:100%; height:100%; border:0; }
  .embed-wide { aspect-ratio:16/9; }
  .embed-tall { aspect-ratio:9/16; max-width:340px; margin-inline:auto; }
  .embed-card { aspect-ratio:4/5; max-width:540px; margin-inline:auto; }
  /* الشريط ارتفاعه ثابت لا نسبة — مشغّل الصوت لا يتمدّد بعرض الصفحة */
  .embed-strip { aspect-ratio:auto; height:180px; }

  /* عمودان ينهاران عمودياً على الجوّال — ١٨٧ بكسل للعمود لا يُقرأ */
  .columns { display:grid; grid-template-columns:1fr 1fr; gap:20px; margin:20px 0; }
  @media (max-width: 480px) { .columns { grid-template-columns:1fr; } }

  .checklist { list-style:none; margin:20px 0; padding:0; }
  .checklist li { margin:6px 0; }
  .checklist label { display:flex; align-items:flex-start; gap:8px; }
  .checklist input { margin-top:6px; flex:none; }
  .btn { display:inline-block; background: var(--primary); color: var(--primary-foreground);
         text-decoration:none; padding:12px 24px; border-radius: var(--radius); font-weight:600; }
  .btn:focus-visible { outline:2px solid var(--ring); outline-offset:2px; }
  .sub { margin-top:44px; padding:20px; border:1px solid var(--border);
         border-radius: calc(var(--radius) + 4px); background: var(--card); }
  .sub input { padding:12px; border:1px solid var(--input); border-radius: var(--radius);
               font-family:inherit; font-size:var(--text-sm); width:100%; margin-bottom:8px;
               background: var(--background); color: var(--foreground); }
  .sub input:focus-visible { outline:2px solid var(--ring); outline-offset:1px; }
  .sub button { background: var(--primary); color: var(--primary-foreground); border:none;
                padding:12px 20px; border-radius: var(--radius); font-weight:600; cursor:pointer;
                font-family:inherit; font-size:var(--text-sm); }
  .sub button:focus-visible { outline:2px solid var(--ring); outline-offset:2px; }
  .card { border:1px solid var(--border); border-radius: calc(var(--radius) + 4px);
          padding:16px; margin-bottom:12px; background: var(--card); }
  .card a { color: var(--card-foreground); text-decoration:none; font-weight:700; font-size:var(--text-lg); }
  .note { padding:16px; border-radius: calc(var(--radius) + 4px); background: var(--primary-soft); }
</style>
</head>
<body><div class="wrap">
<header class="site"><picture><source srcset="/brand/naf-mark-dark.svg" media="(prefers-color-scheme: dark)"><img src="/brand/naf-mark.svg" alt="شعار ناف"></picture><a href="${escapeHtml(canonical.split('/').slice(0, -1).join('/') || '/')}">${escapeHtml(siteName)}</a></header>
${body}
</div></body></html>`;
}

// نموذج الاشتراك — يظهر أسفل كل مقالة (حلقة النمو)
// التاريخ بصيغة naf-terms §5: ميلادي 2026/07/25، معزول اتجاهياً.
function publicDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return escapeHtml(iso);
  const riyadh = new Date(d.getTime() + 3 * 60 * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const text = `${riyadh.getUTCFullYear()}/${pad(riyadh.getUTCMonth() + 1)}/${pad(riyadh.getUTCDate())}`;
  return `<bdi>${text}</bdi>`;
}

function subscribeForm(actionBase: string): string {
  return `<div class="sub">
  <h3 style="margin:0 0 6px">اشترك في النشرة</h3>
  <p style="margin:0 0 12px;color:var(--muted-foreground);font-size:var(--text-sm)">تصلك مقالاتنا القانونية أولاً بأول. يمكنك إلغاء الاشتراك في أي وقت.</p>
  <form method="POST" action="${escapeHtml(actionBase)}/subscribe">
    <input type="email" name="email" required placeholder="بريدك الإلكتروني" aria-label="البريد الإلكتروني">
    <input type="text" name="name" placeholder="الاسم (اختياري)" aria-label="الاسم">
    <button type="submit">اشترك</button>
  </form>
</div>`;
}

async function siteName(env: Env): Promise<string> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'app_name'").first<{ value: string }>();
  return row?.value || env.APP_NAME || 'شركة ناف القانونية';
}

// فهرس المقالات
publicRoutes.get('/', async (c) => {
  const { base, path } = await publicSettings(c.env, c.req.url);
  const { results } = await c.env.DB.prepare(
    `SELECT id, title, slug, excerpt, published_at FROM newsletters
     WHERE web_published = 1 ORDER BY COALESCE(published_at, created_at) DESC LIMIT 50`,
  ).all<Row>();

  const name = await siteName(c.env);
  const items = results.length
    ? results.map((r) => `<div class="card">
        <a href="${escapeHtml(articleUrl(base, path, r.slug))}">${escapeHtml(r.title)}</a>
        ${r.excerpt ? `<p style="color:var(--muted-foreground);margin:6px 0 0">${escapeHtml(r.excerpt)}</p>` : ''}
        ${r.published_at ? `<div class="meta" style="margin:6px 0 0">${publicDate(r.published_at)}</div>` : ''}
      </div>`).join('')
    : '<p class="note">لا توجد مقالات منشورة بعد.</p>';

  return c.html(layout({
    title: `المقالات — ${name}`,
    description: `أحدث المقالات والنشرات من ${name}`,
    canonical: `${base}${path}`,
    siteName: name,
    jsonLd: 'CollectionPage',
    body: `<h1>المقالات</h1>${items}${subscribeForm(`${base}${path}`)}`,
  }));
});

// تغذية RSS — لمجمّعات الأخبار وللاستهلاك الخارجي
publicRoutes.get('/feed.xml', async (c) => {
  const { base, path } = await publicSettings(c.env, c.req.url);
  const name = await siteName(c.env);
  const { results } = await c.env.DB.prepare(
    `SELECT title, slug, excerpt, published_at FROM newsletters
     WHERE web_published = 1 ORDER BY COALESCE(published_at, created_at) DESC LIMIT 30`,
  ).all<Row>();

  const items = results.map((r) => {
    const link = articleUrl(base, path, r.slug);
    return `<item><title>${escapeHtml(r.title)}</title><link>${escapeHtml(link)}</link>` +
      `<guid isPermaLink="true">${escapeHtml(link)}</guid>` +
      (r.excerpt ? `<description>${escapeHtml(r.excerpt)}</description>` : '') +
      (r.published_at ? `<pubDate>${new Date(r.published_at).toUTCString()}</pubDate>` : '') +
      `</item>`;
  }).join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>${escapeHtml(name)} — المقالات</title>
<link>${escapeHtml(base + path)}</link>
<description>${escapeHtml(`أحدث المقالات من ${name}`)}</description>
<language>ar</language>
${items}
</channel></rss>`;
  return new Response(xml, { headers: { 'content-type': 'application/rss+xml; charset=utf-8' } });
});

// تغذية JSON — ليعرض موقعكم الحالي «أحدث المقالات» بمقتطفات دون تكرار المحتوى
publicRoutes.get('/feed.json', async (c) => {
  const { base, path } = await publicSettings(c.env, c.req.url);
  const { results } = await c.env.DB.prepare(
    `SELECT title, slug, excerpt, published_at FROM newsletters
     WHERE web_published = 1 ORDER BY COALESCE(published_at, created_at) DESC LIMIT 30`,
  ).all<Row>();
  const items = results.map((r) => ({
    title: r.title,
    url: articleUrl(base, path, r.slug),
    excerpt: r.excerpt || '',
    published_at: r.published_at,
  }));
  // مسموح للموقع الخارجي بقراءتها
  return c.json({ items }, 200, { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=300' });
});

// مقالة واحدة (يُسجَّل بعد المسارات الثابتة كي لا يبتلعها)
publicRoutes.get('/:slug', async (c) => {
  const slug = c.req.param('slug');
  // updated_at واسم الكاتب للبيانات المنظّمة — لا يظهران في الصفحة
  // نفسها، ويقرأهما من يفهرس المقالة.
  const row = await c.env.DB.prepare(
    `SELECT n.id, n.title, n.slug, n.excerpt, n.blocks_json, n.cover_media_id,
            n.published_at, n.updated_at, n.theme_json, u.name AS author_name
     FROM newsletters n LEFT JOIN users u ON u.id = n.author_id
     WHERE n.slug = ? AND n.web_published = 1`,
  )
    .bind(slug)
    .first<Row & { updated_at?: string; author_name?: string | null }>();

  const { base, path } = await publicSettings(c.env, c.req.url);
  const name = await siteName(c.env);
  if (!row) {
    return c.html(layout({
      title: `الصفحة غير موجودة — ${name}`,
      description: 'الصفحة المطلوبة غير متاحة',
      canonical: `${base}${path}/${slug}`,
      siteName: name,
      body: '<h1>الصفحة غير موجودة</h1><p class="note">قد تكون المقالة غير منشورة أو حُذفت.</p>',
    }), 404);
  }

  const blocks = parseBlocks(row.blocks_json);
  const cover = row.cover_media_id ? `${base}/api/media/${row.cover_media_id}` : undefined;
  const theme = parseTheme(row.theme_json);
  const html = renderBlocks(blocks, 'web', base, theme);
  const canvas = articleCanvas(row.theme_json);

  return c.html(layout({
    title: row.title,
    description: row.excerpt || row.title,
    canonical: articleUrl(base, path, row.slug),
    image: cover,
    siteName: name,
    jsonLd: 'Article',
    published: row.published_at,
    modified: row.updated_at || row.published_at,
    author: row.author_name || null,
    body: `${canvas.open}<article>
      <h1${canvas.open ? ` style="color:${theme.heading}"` : ''}>${escapeHtml(row.title)}</h1>
      ${row.published_at ? `<div class="meta">${publicDate(row.published_at)}</div>` : ''}
      ${cover ? `<img src="${escapeHtml(cover)}" alt="${escapeHtml(row.title)}">` : ''}
      ${html}
    </article>${canvas.close}${subscribeForm(`${base}${path}`)}`,
  }));
});

// اشتراك من صفحة المقالة (نموذج عادي — يعمل بلا جافاسكربت)
publicRoutes.post('/subscribe', async (c) => {
  const form = await c.req.parseBody();
  const email = String(form.email || '').trim().toLowerCase();
  const nameField = String(form.name || '').trim();
  const { base, path } = await publicSettings(c.env, c.req.url);
  const site = await siteName(c.env);

  const page = (msg: string, ok = true) => c.html(layout({
    title: ok ? `تم الاشتراك — ${site}` : `تعذّر الاشتراك — ${site}`,
    description: msg,
    canonical: `${base}${path}`,
    siteName: site,
    body: `<h1>${ok ? 'شكراً لاشتراكك' : 'تعذّر الاشتراك'}</h1><p class="note">${escapeHtml(msg)}</p>
           <p style="margin-top:20px"><a class="btn" href="${escapeHtml(base + path)}">عودة للمقالات</a></p>`,
  }), ok ? 200 : 400);

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return page('البريد الإلكتروني غير صالح.', false);

  // سجل الموافقة: المصدر والوقت وعنوان IP — مطلب نظامي
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || null;
  await c.env.DB.prepare(
    `INSERT INTO subscribers (id, email, name, status, consent_source, consent_at, consent_ip, token)
     VALUES (?, ?, ?, 'active', 'article_page', strftime('%Y-%m-%dT%H:%M:%SZ','now'), ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       status = CASE WHEN subscribers.status = 'unsubscribed' THEN 'active' ELSE subscribers.status END,
       name = COALESCE(NULLIF(excluded.name, ''), subscribers.name),
       unsubscribed_at = NULL`,
  )
    .bind(newId('sub'), email, nameField || null, ip, newId('tok') + newId('tok'))
    .run();

  // رسالة الترحيب في الخلفية — أفضل جهد فلا تؤخّر الرد ولا تُفشل الاشتراك
  const row = await c.env.DB.prepare('SELECT token FROM subscribers WHERE email = ?')
    .bind(email)
    .first<{ token: string }>();
  if (row?.token) c.executionCtx.waitUntil(sendWelcome(c.env, email, row.token, c.req.url).catch(() => {}));

  return page('تم الاشتراك. ستصلك مقالاتنا القادمة على بريدك.');
});

// إلغاء الاشتراك بنقرة واحدة (رابط في كل رسالة — مطلب نظامي)
publicRoutes.get('/unsubscribe/:token', async (c) => {
  const token = c.req.param('token');
  const { base, path } = await publicSettings(c.env, c.req.url);
  const site = await siteName(c.env);

  const res = await c.env.DB.prepare(
    `UPDATE subscribers SET status = 'unsubscribed',
       unsubscribed_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE token = ?`,
  )
    .bind(token)
    .run();

  const ok = res.meta.changes > 0;
  return c.html(layout({
    title: ok ? `أُلغي الاشتراك — ${site}` : `رابط غير صالح — ${site}`,
    description: ok ? 'تم إلغاء اشتراكك' : 'الرابط غير صالح',
    canonical: `${base}${path}`,
    siteName: site,
    body: ok
      ? `<h1>أُلغي اشتراكك</h1><p class="note">لن تصلك رسائل بعد الآن. يمكنك الاشتراك مجدداً في أي وقت.</p>
         <p style="margin-top:20px"><a class="btn" href="${escapeHtml(base + path)}">عودة للمقالات</a></p>`
      : '<h1>رابط غير صالح</h1><p class="note">قد يكون الرابط منتهياً أو غير صحيح.</p>',
  }), ok ? 200 : 404);
});
