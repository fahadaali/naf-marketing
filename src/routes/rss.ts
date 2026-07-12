import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth, requirePermission } from '../middleware';
import { newId } from '../util';
import { refreshAllFeeds } from '../services/rss';
import { generateText } from '../services/claude';

export const rssRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

rssRoutes.use('*', requireAuth);

// خلاصات RSS — الإدارة للمدير العام (settings.manage)
rssRoutes.get('/feeds', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM rss_feeds ORDER BY created_at DESC').all();
  return c.json({ feeds: results });
});

rssRoutes.post('/feeds', requirePermission('settings.manage'), async (c) => {
  const user = c.get('user');
  const { url, title } = await c.req.json<{ url: string; title?: string }>();
  if (!url || !/^https?:\/\//.test(url)) return c.json({ error: 'رابط غير صالح' }, 400);
  const id = newId('feed');
  try {
    await c.env.DB.prepare(
      'INSERT INTO rss_feeds (id, url, title, added_by) VALUES (?, ?, ?, ?)',
    )
      .bind(id, url, title || url, user.id)
      .run();
  } catch {
    return c.json({ error: 'الخلاصة مضافة مسبقاً' }, 400);
  }
  return c.json({ ok: true, id });
});

rssRoutes.delete('/feeds/:id', requirePermission('settings.manage'), async (c) => {
  await c.env.DB.prepare('DELETE FROM rss_feeds WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

// تحديث فوري (سحب يدوي) — إضافةً إلى Cron الدوري
rssRoutes.post('/refresh', requirePermission('settings.manage'), async (c) => {
  const added = await refreshAllFeeds(c.env);
  return c.json({ ok: true, added });
});

// قائمة الأخبار المجلوبة
rssRoutes.get('/news', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT n.*, f.title AS feed_title FROM news_items n
     LEFT JOIN rss_feeds f ON f.id = n.feed_id
     ORDER BY COALESCE(n.published_at, n.created_at) DESC LIMIT 100`,
  ).all();
  return c.json({ news: results });
});

// صياغة/تلخيص خبر عبر Claude (اختياري) — يعيد النص فقط دون حفظ
rssRoutes.post('/news/:id/rewrite', requirePermission('ai.generate'), async (c) => {
  const id = c.req.param('id');
  const item = await c.env.DB.prepare('SELECT title, summary FROM news_items WHERE id = ?')
    .bind(id)
    .first<{ title: string; summary: string }>();
  if (!item) return c.json({ error: 'الخبر غير موجود' }, 404);
  const opts = await c.req.json<any>().catch(() => ({}));
  try {
    const text = await generateText(c.env, {
      mode: 'rewrite',
      topic: item.title,
      sourceText: `${item.title}\n\n${item.summary || ''}`,
      ...opts,
    });
    return c.json({ text });
  } catch (err: any) {
    return c.json({ error: String(err?.message || err) }, 502);
  }
});
