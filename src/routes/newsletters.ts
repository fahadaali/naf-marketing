import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth, requirePermission } from '../middleware';
import { getEmailProvider } from '../services/email';
import { newId, nowIso } from '../util';
import {
  parseBlocks, renderBlocks, blocksToText, slugify, publicSettings, articleUrl,
  toXThread, toLinkedInPost,
} from '../services/newsletter';
import { getProvider } from '../adapters';
import { queueNewsletter, newsletterStats, sendQueuedBatch, abResults, decideAbWinner } from '../services/newsletterSend';

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
    'preheader', 'excerpt', 'blocks_json', 'cover_media_id', 'slug', 'scheduled_at'];
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
  return c.json({
    html: renderBlocks(parseBlocks(row.blocks_json), 'email', base),
    text: blocksToText(parseBlocks(row.blocks_json)),
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
    const queued = await queueNewsletter(c.env, c.req.param('id'));
    // نبدأ الدفعة الأولى فوراً كي يرى المستخدم تقدّماً مباشرة
    c.executionCtx.waitUntil(sendQueuedBatch(c.env, c.req.url).catch(() => {}));
    return c.json({ ok: true, queued });
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, 400);
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
    const html = renderBlocks(parseBlocks(row.blocks_json), 'email', base);
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
  return c.json({
    url,
    x: toXThread(row.title, blocks, url),
    linkedin: toLinkedInPost(row.title, blocks, url, row.excerpt),
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
    const body = text?.[p]?.trim()
      || (p === 'x' ? toXThread(row.title, blocks, url).join('\n\n') : toLinkedInPost(row.title, blocks, url, row.excerpt));
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
