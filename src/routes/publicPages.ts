import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { newId } from '../util';
import { parseBlocks, renderBlocks, publicSettings, articleUrl, escapeHtml } from '../services/newsletter';
import { sendWelcome } from '../services/newsletterSend';

// الصفحات العامة (بلا مصادقة): المقالات، الاشتراك، إلغاء الاشتراك.
// تُخدَّم HTML من الخادم كي تُفهرس وتظهر معاينتها عند المشاركة (وسوم OG).
export const publicRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

type Row = {
  id: string; title: string; slug: string; excerpt: string | null; blocks_json: string;
  cover_media_id: string | null; published_at: string | null;
};

function layout(opts: {
  title: string; description: string; canonical: string; image?: string; body: string; siteName: string;
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
<meta property="og:type" content="article">
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
  h1 { font-size: 32px; line-height:1.4; margin: 0 0 10px; }
  .meta { color: var(--muted-foreground); font-size:14px; margin-bottom:24px; }
  img { max-width:100%; height:auto; border-radius: calc(var(--radius) + 4px); }
  figure { margin: 20px 0; }
  figcaption { font-size:13px; color: var(--muted-foreground); text-align:center; margin-top:8px; }
  blockquote { margin:20px 0; padding:12px 16px;
               border-inline-start:3px solid var(--primary); background: var(--primary-soft); }
  hr { border:none; border-top:1px solid var(--border); margin:28px 0; }
  .btn { display:inline-block; background: var(--primary); color: var(--primary-foreground);
         text-decoration:none; padding:12px 24px; border-radius: var(--radius); font-weight:600; }
  .btn:focus-visible { outline:2px solid var(--ring); outline-offset:2px; }
  .sub { margin-top:44px; padding:20px; border:1px solid var(--border);
         border-radius: calc(var(--radius) + 4px); background: var(--card); }
  .sub input { padding:12px; border:1px solid var(--input); border-radius: var(--radius);
               font-family:inherit; font-size:15px; width:100%; margin-bottom:8px;
               background: var(--background); color: var(--foreground); }
  .sub input:focus-visible { outline:2px solid var(--ring); outline-offset:1px; }
  .sub button { background: var(--primary); color: var(--primary-foreground); border:none;
                padding:12px 20px; border-radius: var(--radius); font-weight:600; cursor:pointer;
                font-family:inherit; font-size:15px; }
  .sub button:focus-visible { outline:2px solid var(--ring); outline-offset:2px; }
  .card { border:1px solid var(--border); border-radius: calc(var(--radius) + 4px);
          padding:16px; margin-bottom:12px; background: var(--card); }
  .card a { color: var(--card-foreground); text-decoration:none; font-weight:700; font-size:19px; }
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
  <p style="margin:0 0 12px;color:var(--muted-foreground);font-size:14px">تصلك مقالاتنا القانونية أولاً بأول. يمكنك إلغاء الاشتراك في أي وقت.</p>
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
  const row = await c.env.DB.prepare(
    `SELECT id, title, slug, excerpt, blocks_json, cover_media_id, published_at
     FROM newsletters WHERE slug = ? AND web_published = 1`,
  )
    .bind(slug)
    .first<Row>();

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
  const html = renderBlocks(blocks, 'web', base);

  return c.html(layout({
    title: row.title,
    description: row.excerpt || row.title,
    canonical: articleUrl(base, path, row.slug),
    image: cover,
    siteName: name,
    body: `<article>
      <h1>${escapeHtml(row.title)}</h1>
      ${row.published_at ? `<div class="meta">${publicDate(row.published_at)}</div>` : ''}
      ${cover ? `<img src="${escapeHtml(cover)}" alt="${escapeHtml(row.title)}">` : ''}
      ${html}
    </article>${subscribeForm(`${base}${path}`)}`,
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

  return page('تم تسجيل اشتراكك بنجاح. ستصلك مقالاتنا القادمة على بريدك.');
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
