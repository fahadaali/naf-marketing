import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth, requirePermission } from '../middleware';
import { getEmailProvider, emailReadiness } from '../services/email';
import { newId, nowIso } from '../util';
import {
  parseBlocks, renderBlocks, blocksToText, slugify, publicSettings, articleUrl,
  toXThread, socialText, socialTargets, SOCIAL_LIMIT, SOCIAL_MEDIA_FIRST,
} from '../services/newsletter';
import type { Block } from '../services/newsletter';
import { getProvider } from '../adapters';
import { proofreadArabic } from '../services/claude';
import { buildDocx } from '../services/docx';
import { printDocument } from '../services/printDoc';
import { buildArticlePdf } from '../services/pdf';
import { queueNewsletter, newsletterStats, sendQueuedBatch, abResults, decideAbWinner } from '../services/newsletterSend';
import { parseTheme } from '../services/blockStyle';
import {
  builtinSummaries, builtinById, isBuiltinId, sanitizeBlocks, readTemplateFile, buildTemplateFile,
} from '../services/newsletterTemplates';
import { htmlToBlocks, htmlTitle } from '../services/newsletterImport';
import { hasPermission } from '../permissions';

export const newsletterRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

newsletterRoutes.use('*', requireAuth);
newsletterRoutes.use('*', requirePermission('newsletter.manage'));

// قائمة النشرات مع عدّادات الإرسال
newsletterRoutes.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT n.*, u.name AS author_name,
            (SELECT COUNT(*) FROM newsletter_sends s WHERE s.newsletter_id = n.id AND s.status = 'sent') AS sent_count
     FROM newsletters n LEFT JOIN users u ON u.id = n.author_id
     ORDER BY n.updated_at DESC LIMIT 100`,
  ).all();
  const active = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM subscribers WHERE status = 'active'",
  ).first<{ n: number }>();
  return c.json({ newsletters: results, active_subscribers: active?.n || 0 });
});

// نشرة واحدة مع رابطها العام
newsletterRoutes.get('/:id', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM newsletters WHERE id = ?')
    .bind(c.req.param('id'))
    .first<any>();
  if (!row) return c.json({ error: 'النشرة غير موجودة' }, 404);
  const { base, path } = await publicSettings(c.env, c.req.url);
  return c.json({ newsletter: row, public_url: articleUrl(base, path, row.slug) });
});

// إنشاء
newsletterRoutes.post('/', async (c) => {
  const b = await c.req.json<{ title?: string }>();
  const title = (b.title || '').trim() || 'نشرة بلا عنوان';
  const id = newId('nl');

  // نضمن تفرّد الـ slug بإضافة لاحقة عند التعارض
  let slug = slugify(title);
  const exists = await c.env.DB.prepare('SELECT 1 FROM newsletters WHERE slug = ?').bind(slug).first();
  if (exists) slug = `${slug}-${id.slice(-5)}`;

  await c.env.DB.prepare(
    'INSERT INTO newsletters (id, title, slug, subject, author_id) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(id, title, slug, title, c.get('user').id)
    .run();
  return c.json({ ok: true, id });
});

// تحديث (محتوى/إعدادات/نشر الصفحة العامة)
newsletterRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const b = await c.req.json<Record<string, unknown>>();
  const allowed = ['title', 'subject', 'subject_b', 'ab_percent', 'segment_tag',
    'preheader', 'excerpt', 'blocks_json', 'cover_media_id', 'slug', 'scheduled_at',
    'theme_json'];
  const sets: string[] = [];
  const binds: unknown[] = [];

  for (const k of allowed) {
    if (b[k] !== undefined) {
      sets.push(`${k} = ?`);
      binds.push(k === 'slug' ? slugify(String(b[k])) : (b[k] ?? null));
    }
  }

  // نشر/إخفاء الصفحة العامة
  if (b.web_published !== undefined) {
    const on = !!b.web_published;
    sets.push('web_published = ?');
    binds.push(on ? 1 : 0);
    if (on) { sets.push('published_at = COALESCE(published_at, ?)'); binds.push(nowIso()); }
  }

  if (!sets.length) return c.json({ ok: true });
  sets.push('updated_at = ?');
  binds.push(nowIso(), id);

  await c.env.DB.prepare(`UPDATE newsletters SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  return c.json({ ok: true });
});

newsletterRoutes.delete('/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM newsletters WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

// معاينة البريد كما سيصل المشترك
newsletterRoutes.get('/:id/preview', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM newsletters WHERE id = ?')
    .bind(c.req.param('id'))
    .first<any>();
  if (!row) return c.json({ error: 'النشرة غير موجودة' }, 404);
  const { base } = await publicSettings(c.env, c.req.url);
  const theme = parseTheme(row.theme_json);
  return c.json({
    html: renderBlocks(parseBlocks(row.blocks_json), 'email', base, theme),
    text: blocksToText(parseBlocks(row.blocks_json)),
    // المعاينة تُحاكي غلاف الرسالة أيضاً: بطاقةٌ بيضاء حول متنٍ داكن
    // تُري الكاتب رسالةً غير التي تصل المشترك.
    theme,
  });
});

// إحصاءات الإرسال (مُسلَّم/فتح/نقر)
newsletterRoutes.get('/:id/stats', async (c) => {
  const s = await newsletterStats(c.env, c.req.param('id'));
  return c.json({ stats: s || {} });
});

// بدء الإرسال — يُدرج صفاً لكل مشترك نشط، ثم يرسل الدفعات عبر Cron
newsletterRoutes.post('/:id/send', async (c) => {
  try {
    /* الجاهزية قبل الطابور: بلا مفتاحٍ يرمي `getEmailProvider` داخل
       الدفعة — وهي تجري في `waitUntil` بلا مستمع، فتبقى النشرة «قيد
       الإرسال» وصفوفُها «في الطابور» بلا سببٍ ظاهر للمستخدم. فيُقال له
       هنا، قبل أن يُنشأ صفٌّ واحد. */
    const email = await emailReadiness(c.env);
    if (!email.configured) return c.json({ error: email.reason }, 400);

    const queued = await queueNewsletter(c.env, c.req.param('id'));
    // نبدأ الدفعة الأولى فوراً كي يرى المستخدم تقدّماً مباشرة
    c.executionCtx.waitUntil(sendQueuedBatch(c.env, c.req.url).catch(() => {}));
    return c.json({ ok: true, queued });
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, 400);
  }
});

/* تصدير PDF — يُصيَّر في متصفّح Cloudflare لا في مكتبة PDF: العربية
   تحتاج تشكيلاً وربطَ حروف، وأي بديل خفيف يُخرجها منفصلةً مقلوبة.

   والربط غير متاح على كل خطة، فالواجهة تسأل عنه أولاً عبر
   ‎/meta/export-capabilities ولا تعرض زرّاً يفشل عند الضغط. */
newsletterRoutes.get('/meta/export-capabilities', (c) => c.json({ pdf: !!c.env.BROWSER }));

/* جاهزية البريد — تسألها الإعدادات كما تسأل بيسكامب وBuffer عن حالتهما.
   وكان البريد وحده بلا فحصٍ، وهو الوحيد الذي كان يبتلع الإرسال صامتاً. */
newsletterRoutes.get('/meta/email-status', async (c) => c.json(await emailReadiness(c.env)));

newsletterRoutes.get('/:id/export.pdf', async (c) => {
  const row = await c.env.DB.prepare('SELECT title, slug, blocks_json, theme_json FROM newsletters WHERE id = ?')
    .bind(c.req.param('id')).first<{ title: string; slug: string; blocks_json: string; theme_json: string | null }>();
  if (!row) return c.json({ error: 'النشرة غير موجودة' }, 404);
  try {
    const bytes = await buildArticlePdf(c.env, row.title, row.blocks_json, row.theme_json);
    return new Response(bytes, {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="article.pdf"; filename*=UTF-8''${encodeURIComponent(row.slug || 'article')}.pdf`,
      },
    });
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, 503);
  }
});

/* تصدير Word — مستند OOXML حقيقي لا HTML بامتداد doc. */
newsletterRoutes.get('/:id/export.docx', async (c) => {
  const row = await c.env.DB.prepare('SELECT title, slug, blocks_json FROM newsletters WHERE id = ?')
    .bind(c.req.param('id')).first<{ title: string; slug: string; blocks_json: string }>();
  if (!row) return c.json({ error: 'النشرة غير موجودة' }, 404);
  // الأصل المطلق: رابطٌ نسبيّ في مستندٍ يُفتح من سطح المكتب لا يفتح شيئاً
  const { base } = await publicSettings(c.env, c.req.url);
  const bytes = buildDocx(row.title, parseBlocks(row.blocks_json), base);
  return new Response(bytes, {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      // اسم الملف بترميز RFC 5987 — العنوان عربي ولا يمرّ في ASCII
      'content-disposition': `attachment; filename="article.docx"; filename*=UTF-8''${encodeURIComponent(row.slug || 'article')}.docx`,
    },
  });
});

/* نسخة الطباعة — يفتحها المتصفح ويطبعها القارئ إلى PDF بنفسه.

   وهي البديل حين لا يكون ربط BROWSER متاحاً، وتبقى مفيدةً معه: من
   أراد ضبط الهوامش أو اختيار الصفحات يفعل ذلك من حوار الطباعة.
   (كان مكتوباً هنا أن PDF لا تُولَّد في الخادم — صار ذلك ممكناً
   بـBrowser Rendering، فسقطت الجملة مع بقاء المسار.)

   وهذه هي حالة «مستند يُولَّد في نافذته» في CLAUDE.md §1 حرفياً:
   لا يرث ورقة أنماط التطبيق ولا يقرأ var(--…)، ويبقى فاتحاً مهما كان
   وضع القارئ — مذكّرةٌ داكنة لا تُقدَّم وفاتورةٌ داكنة تُهدر الحبر. */
newsletterRoutes.get('/:id/print', async (c) => {
  const row = await c.env.DB.prepare('SELECT title, blocks_json, theme_json FROM newsletters WHERE id = ?')
    .bind(c.req.param('id')).first<{ title: string; blocks_json: string; theme_json: string | null }>();
  if (!row) return c.json({ error: 'النشرة غير موجودة' }, 404);
  const { base } = await publicSettings(c.env, c.req.url);
  /* ألوان الكاتب تصل المستند المطبوع كما تصل الرسالة — هي محتواه لا
     ثيم التطبيق. والمستند يبقى فاتحاً بذاته: السمة الافتراضية فاتحة،
     ومن اختار سطحاً داكناً اختاره لنشرته لا لوضع قارئه. */
  const body = renderBlocks(parseBlocks(row.blocks_json), 'web', base, parseTheme(row.theme_json));
  return c.html(printDocument(row.title, body));
});

/* التدقيق اللغوي — يقرأ نصّ الكتل ويعيد ملاحظات لا نصّاً مستبدَلاً.
   الصلاحية نفسها التي تحكم التوليد: كلاهما نداءٌ مدفوع إلى Claude. */
newsletterRoutes.post('/:id/proofread', requirePermission('ai.generate'), async (c) => {
  const row = await c.env.DB.prepare('SELECT blocks_json, title FROM newsletters WHERE id = ?')
    .bind(c.req.param('id')).first<{ blocks_json: string; title: string }>();
  if (!row) return c.json({ error: 'النشرة غير موجودة' }, 404);
  const text = blocksToText(parseBlocks(row.blocks_json));
  if (!text.trim()) return c.json({ notes: [] });
  try {
    return c.json({ notes: await proofreadArabic(c.env, text) });
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, 502);
  }
});

/* جدولة الإرسال. الموعد يصل بصيغة ISO بتوقيت UTC — الواجهة تُدخله
   بتوقيت الرياض وتحوّله، كما في جدولة المنشورات. الكرون هو الذي يُدخل
   النشرة الطابور عند بلوغه (queueDueNewsletters). */
newsletterRoutes.post('/:id/schedule', async (c) => {
  const { scheduled_at } = await c.req.json<{ scheduled_at: string }>();
  const at = Date.parse(scheduled_at || '');
  if (!Number.isFinite(at)) return c.json({ error: 'الموعد غير صالح' }, 400);
  if (at <= Date.now()) return c.json({ error: 'الموعد مضى. اختر وقتاً لاحقاً.' }, 400);

  const row = await c.env.DB.prepare('SELECT status FROM newsletters WHERE id = ?')
    .bind(c.req.param('id')).first<{ status: string }>();
  if (!row) return c.json({ error: 'النشرة غير موجودة' }, 404);
  // نفس حكم queueNewsletter، وبنفس ألفاظه — نشرةٌ غادرت المسودة لا تُجدول.
  if (row.status === 'sending') return c.json({ error: 'النشرة قيد الإرسال بالفعل' }, 400);
  if (row.status === 'sent') return c.json({ error: 'أُرسلت هذه النشرة مسبقاً' }, 400);

  await c.env.DB.prepare(
    "UPDATE newsletters SET status = 'scheduled', scheduled_at = ?, updated_at = ? WHERE id = ?",
  ).bind(new Date(at).toISOString(), nowIso(), c.req.param('id')).run();
  return c.json({ ok: true, scheduled_at: new Date(at).toISOString() });
});

// إلغاء الجدولة — تعود النشرة مسودةً بلا موعد
newsletterRoutes.post('/:id/schedule/cancel', async (c) => {
  const row = await c.env.DB.prepare('SELECT status FROM newsletters WHERE id = ?')
    .bind(c.req.param('id')).first<{ status: string }>();
  if (!row) return c.json({ error: 'النشرة غير موجودة' }, 404);
  if (row.status !== 'scheduled') return c.json({ error: 'النشرة غير مجدولة' }, 400);

  await c.env.DB.prepare(
    "UPDATE newsletters SET status = 'draft', scheduled_at = NULL, updated_at = ? WHERE id = ?",
  ).bind(nowIso(), c.req.param('id')).run();
  return c.json({ ok: true });
});

// إرسال تجريبي لبريد واحد قبل الإرسال الجماعي
newsletterRoutes.post('/:id/test', async (c) => {
  const { email } = await c.req.json<{ email: string }>();
  if (!email?.trim()) return c.json({ error: 'أدخل بريداً للاختبار' }, 400);
  const row = await c.env.DB.prepare('SELECT * FROM newsletters WHERE id = ?')
    .bind(c.req.param('id'))
    .first<any>();
  if (!row) return c.json({ error: 'النشرة غير موجودة' }, 404);
  try {
    const { base } = await publicSettings(c.env, c.req.url);
    const provider = await getEmailProvider(c.env);
    const html = renderBlocks(parseBlocks(row.blocks_json), 'email', base, parseTheme(row.theme_json));
    await provider.send(email.trim(), `[اختبار] ${row.subject || row.title}`, html);
    return c.json({ ok: true });
  } catch (e: any) {
    return c.json({ error: `فشل الإرسال التجريبي: ${String(e?.message || e)}` }, 502);
  }
});

// معاينة صياغة المقالة لمنصات التواصل (قبل النشر)
newsletterRoutes.get('/:id/social', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM newsletters WHERE id = ?')
    .bind(c.req.param('id'))
    .first<any>();
  if (!row) return c.json({ error: 'النشرة غير موجودة' }, 404);
  const { base, path } = await publicSettings(c.env, c.req.url);
  const url = articleUrl(base, path, row.slug);
  const blocks = parseBlocks(row.blocks_json);
  // صياغةٌ لكل منصة تقبل النشر النصّي، لا صيغتان تُعمَّم إحداهما
  const drafts: Record<string, string> = {};
  for (const p of socialTargets()) drafts[p] = socialText(p, row.title, blocks, url, row.excerpt);
  return c.json({
    url,
    targets: socialTargets(),
    limits: SOCIAL_LIMIT,
    drafts,
    /* سلسلة إكس تُعرض أجزاءً مرقّمة فتبقى مصفوفةً مستقلة. ولا مفتاح
       linkedin بعد اليوم: كان يُبنى بـtoLinkedInPost بحدّ تسعمئة حرف
       بينما يُنشر فعلاً بـsocialText بحدّ ثلاثة آلاف — صيغتان لنفس
       المنصة، تُعرض إحداهما وتُرسل الأخرى. ولا مستهلك له في الواجهة. */
    x: toXThread(row.title, blocks, url),
  });
});

// نشر المقالة على منصات التواصل — تُصاغ لكل منصة بحدودها مع رابط المقالة
newsletterRoutes.post('/:id/social', async (c) => {
  const { platforms, text } = await c.req.json<{ platforms: string[]; text?: Record<string, string> }>();
  if (!platforms?.length) return c.json({ error: 'اختر منصة واحدة على الأقل' }, 400);

  const row = await c.env.DB.prepare('SELECT * FROM newsletters WHERE id = ?')
    .bind(c.req.param('id'))
    .first<any>();
  if (!row) return c.json({ error: 'النشرة غير موجودة' }, 404);
  if (!row.web_published) return c.json({ error: 'انشر الصفحة العامة أولاً — المنشور يحتاج رابط المقالة' }, 400);

  const { base, path } = await publicSettings(c.env, c.req.url);
  const url = articleUrl(base, path, row.slug);
  const blocks = parseBlocks(row.blocks_json);

  const provider = await getProvider(c.env);
  const results: { platform: string; ok: boolean; error?: string }[] = [];

  for (const p of platforms) {
    // نص مُخصّص من الواجهة إن وُجد، وإلا الصياغة التلقائية لكل منصة
    if (SOCIAL_MEDIA_FIRST.has(p)) {
      // منصةٌ وسائطُ أولاً: منشورٌ نصّيّ يُرفض من واجهتها، فيُقال ذلك
      // صراحةً بدل تمريره ليعود خطأً غامضاً من المزوّد.
      results.push({ platform: p, ok: false, error: 'هذه المنصة تحتاج صورة أو مقطعاً — انشر عليها من المحرر' });
      continue;
    }
    const body = text?.[p]?.trim() || socialText(p, row.title, blocks, url, row.excerpt);
    try {
      await provider.publish({ platforms: [p], text: body });
      results.push({ platform: p, ok: true });
    } catch (e: any) {
      results.push({ platform: p, ok: false, error: String(e?.message || e) });
    }
  }
  return c.json({ ok: results.some((r) => r.ok), results });
});

// نتائج اختبار العنوانين
newsletterRoutes.get('/:id/ab', async (c) => {
  return c.json(await abResults(c.env, c.req.param('id')));
});

// اعتماد العنوان الفائز (يدوياً أو آلياً بالأعلى فتحاً)
newsletterRoutes.post('/:id/ab/decide', async (c) => {
  const body = await c.req.json<{ winner?: 'a' | 'b' }>().catch(() => ({} as any));
  try {
    const winner = await decideAbWinner(c.env, c.req.param('id'), body.winner);
    return c.json({ ok: true, winner });
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, 400);
  }
});

/* ===== قوالب النشرة =====

   تحت `/meta/` كالوسوم وقدرات التصدير: المسار الثابت لا يزاحم `/:id`،
   وقارئُ الملف يرى القوالب مجموعةً واحدة لا مبعثرةً بين المسارات.

   والمعرض يجمع صنفين: قوالبُ جاهزة من الشيفرة وقوالبُ محفوظة من
   القاعدة. تُعادان في حقلين منفصلين لا في قائمةٍ واحدة — الواجهة تعرض
   لكلٍّ ما يخصّه، والحذف لا يُعرض على ما لا يُحذف. */
newsletterRoutes.get('/meta/templates', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT t.id, t.name, t.description, t.origin, t.created_at, t.blocks_json, u.name AS creator_name
     FROM newsletter_templates t LEFT JOIN users u ON u.id = t.created_by
     ORDER BY t.created_at DESC LIMIT 100`,
  ).all<any>();
  const saved = results.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description || '',
    origin: r.origin,
    blocks: parseBlocks(r.blocks_json).length,
    creator_name: r.creator_name,
    created_at: r.created_at,
  }));
  return c.json({ builtin: builtinSummaries(), saved });
});

// حفظ نشرةٍ قائمة قالباً — الكتل والسمة معاً، فالقالب يحمل مظهره
newsletterRoutes.post('/meta/templates', async (c) => {
  const b = await c.req.json<{ newsletter_id?: string; name?: string; description?: string }>();
  const name = (b.name || '').trim();
  if (!name) return c.json({ error: 'أدخل اسماً للقالب' }, 400);

  const row = await c.env.DB.prepare(
    'SELECT title, subject, preheader, blocks_json, theme_json FROM newsletters WHERE id = ?',
  ).bind(b.newsletter_id || '').first<any>();
  if (!row) return c.json({ error: 'النشرة غير موجودة' }, 404);

  const blocks = sanitizeBlocks(parseBlocks(row.blocks_json));
  if (!blocks.length) return c.json({ error: 'القالب فارغ. أضف كتلاً ثم احفظه.' }, 400);

  const id = newId('nlt');
  await c.env.DB.prepare(
    `INSERT INTO newsletter_templates (id, name, description, subject, preheader, blocks_json, theme_json, origin, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'saved', ?)`,
  ).bind(
    id, name, (b.description || '').trim() || null, row.subject || null, row.preheader || null,
    JSON.stringify(blocks), row.theme_json || null, c.get('user').id,
  ).run();
  return c.json({ ok: true, id });
});

/* حذف قالب. صاحبه أو من يملك الاعتماد النهائي — نفس حكم قوالب
   المحتوى في routes/templates.ts، فلا حكمان لفعلٍ واحد في منصة. */
newsletterRoutes.delete('/meta/templates/:tid', async (c) => {
  const tid = c.req.param('tid');
  if (isBuiltinId(tid)) return c.json({ error: 'القالب الجاهز لا يُحذف' }, 400);
  const row = await c.env.DB.prepare('SELECT created_by FROM newsletter_templates WHERE id = ?')
    .bind(tid).first<{ created_by: string | null }>();
  if (!row) return c.json({ error: 'القالب غير موجود' }, 404);
  const user = c.get('user');
  const isGM = await hasPermission(c.env, user.role_name, 'content.approve_final');
  if (row.created_by !== user.id && !isGM) return c.json({ error: 'لا يمكنك حذف قالب غيرك' }, 403);
  await c.env.DB.prepare('DELETE FROM newsletter_templates WHERE id = ?').bind(tid).run();
  return c.json({ ok: true });
});

/* استيراد قالب — صيغتان لا واحدة، وكلتاهما تنتهيان قالباً محفوظاً:

   `naf` ملفٌّ خرج من هنا فيدخل بلا فقد.
   `html` قالبُ بريدٍ من أداةٍ أخرى: يُقرأ محتواه ويُحوَّل كتلاً، ولا
   يُخزَّن منه وسمٌ واحد — السبب في `newsletterImport.ts`.

   والردّ يحمل عدد الكتل ليقوله للكاتب: استيرادٌ صامتٌ يُقرأ فشلاً
   حين ينقص القالب عمّا كان، وهو ناجحٌ في حدوده المكتوبة. */
newsletterRoutes.post('/meta/templates/import', async (c) => {
  const b = await c.req.json<{ format?: string; payload?: string; name?: string }>();
  const payload = String(b.payload || '');
  if (!payload.trim()) return c.json({ error: 'الملف فارغ' }, 400);

  let name = (b.name || '').trim();
  let description = '';
  let subject = '';
  let preheader = '';
  let blocks: Block[] = [];
  let themeJson: string | null = null;
  let origin: 'imported' | 'imported_html' = 'imported';

  if (b.format === 'html') {
    origin = 'imported_html';
    blocks = sanitizeBlocks(htmlToBlocks(payload));
    if (!blocks.length) {
      return c.json({ error: 'لم يُعثر على محتوى في الملف. تأكّد أنه قالب بريد كامل.' }, 400);
    }
    name = name || htmlTitle(payload) || 'قالب مستورد';
  } else {
    const read = readTemplateFile(payload);
    if (!read.ok) return c.json({ error: read.error }, 400);
    blocks = read.file.blocks;
    name = name || read.file.name || 'قالب مستورد';
    description = read.file.description || '';
    subject = read.file.subject || '';
    preheader = read.file.preheader || '';
    themeJson = JSON.stringify(read.file.theme);
  }

  const id = newId('nlt');
  await c.env.DB.prepare(
    `INSERT INTO newsletter_templates (id, name, description, subject, preheader, blocks_json, theme_json, origin, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, name.slice(0, 120), description || null, subject || null, preheader || null,
    JSON.stringify(blocks), themeJson, origin, c.get('user').id,
  ).run();
  return c.json({ ok: true, id, blocks: blocks.length, origin });
});

/* إنشاء نشرة من قالب — أو من الصفر حين لا يُمرَّر قالب.

   وهو المسار الوحيد للإنشاء منذ اليوم: `POST /` القديم يبقى لمن
   يناديه برمجياً، وهذا يقبل العنوان والقالب معاً في نداءٍ واحد فلا
   تُنشأ نشرةٌ فارغة ثم تُحشى. */
newsletterRoutes.post('/from-template', async (c) => {
  const b = await c.req.json<{ template_id?: string; title?: string }>();
  const tid = (b.template_id || '').trim();

  let name = '';
  let subject = '';
  let preheader = '';
  let blocks: Block[] = [];
  let themeJson: string | null = null;

  if (tid) {
    if (isBuiltinId(tid)) {
      const t = builtinById(tid);
      if (!t) return c.json({ error: 'القالب غير موجود' }, 404);
      name = t.name;
      subject = t.subject;
      preheader = t.preheader;
      blocks = sanitizeBlocks(t.blocks);
      themeJson = JSON.stringify(t.theme);
    } else {
      const row = await c.env.DB.prepare(
        'SELECT name, subject, preheader, blocks_json, theme_json FROM newsletter_templates WHERE id = ?',
      ).bind(tid).first<any>();
      if (!row) return c.json({ error: 'القالب غير موجود' }, 404);
      name = row.name;
      subject = row.subject || '';
      preheader = row.preheader || '';
      blocks = sanitizeBlocks(parseBlocks(row.blocks_json));
      themeJson = row.theme_json || null;
    }
  }

  const title = (b.title || '').trim() || name || 'نشرة بلا عنوان';
  const id = newId('nl');
  let slug = slugify(title);
  const exists = await c.env.DB.prepare('SELECT 1 FROM newsletters WHERE slug = ?').bind(slug).first();
  if (exists) slug = `${slug}-${id.slice(-5)}`;

  await c.env.DB.prepare(
    `INSERT INTO newsletters (id, title, slug, subject, preheader, blocks_json, theme_json, author_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, title, slug, subject || title, preheader || null,
    JSON.stringify(blocks), themeJson, c.get('user').id,
  ).run();
  return c.json({ ok: true, id, blocks: blocks.length });
});

/* تصدير النشرة ملفَّ قالب — تُنقل إلى مستودعٍ آخر أو تُحفظ خارج
   المنصة. الوسائط المرفوعة تسقط في `sanitizeBlocks`: معرّفها يشير إلى
   صفٍّ لا يوجد هناك. */
newsletterRoutes.get('/:id/export.json', async (c) => {
  const row = await c.env.DB.prepare(
    'SELECT title, slug, subject, preheader, excerpt, blocks_json, theme_json FROM newsletters WHERE id = ?',
  ).bind(c.req.param('id')).first<any>();
  if (!row) return c.json({ error: 'النشرة غير موجودة' }, 404);
  const file = buildTemplateFile({
    name: row.title,
    description: row.excerpt || '',
    subject: row.subject || '',
    preheader: row.preheader || '',
    blocksJson: row.blocks_json,
    themeJson: row.theme_json,
  });
  return new Response(JSON.stringify(file, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // اسم الملف بترميز RFC 5987 — العنوان عربي ولا يمرّ في ASCII
      'content-disposition': `attachment; filename="template.json"; filename*=UTF-8''${encodeURIComponent(row.slug || 'template')}.json`,
    },
  });
});

// الوسوم المتاحة للشرائح (من بيانات المشتركين الفعلية)
newsletterRoutes.get('/meta/tags', async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT tags FROM subscribers WHERE tags IS NOT NULL AND tags != ''",
  ).all<{ tags: string }>();
  const set = new Set<string>();
  for (const r of results) {
    try { for (const t of JSON.parse(r.tags) || []) if (t) set.add(String(t)); } catch { /* وسم تالف */ }
  }
  return c.json({ tags: [...set].sort() });
});
