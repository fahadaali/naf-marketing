import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth } from '../middleware';

export const searchRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

searchRoutes.use('*', requireAuth);

// يهرب أحرف FTS5 الخاصة ويحوّل الاستعلام لصيغة بحث بادئة (prefix) على كل كلمة
function ftsQuery(q: string): string {
  const words = q
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `"${w.replace(/"/g, '""')}"*`);
  return words.join(' ');
}

// بحث نصي كامل عبر المحتوى وخلاصة الأخبار (FTS5)
searchRoutes.get('/', async (c) => {
  const q = (c.req.query('q') || '').trim();
  if (!q) return c.json({ posts: [], news: [] });
  const match = ftsQuery(q);

  const posts = await c.env.DB.prepare(
    `SELECT p.id, p.title, p.status, snippet(content_search, 1, '«', '»', '…', 12) AS snippet
     FROM content_search cs
     JOIN content_posts p ON p.rowid = cs.rowid
     WHERE content_search MATCH ?
     ORDER BY rank LIMIT 30`,
  )
    .bind(match)
    .all()
    .catch(() => ({ results: [] }));

  const news = await c.env.DB.prepare(
    `SELECT n.id, n.title, n.link, snippet(news_search, 1, '«', '»', '…', 12) AS snippet
     FROM news_search ns
     JOIN news_items n ON n.rowid = ns.rowid
     WHERE news_search MATCH ?
     ORDER BY rank LIMIT 30`,
  )
    .bind(match)
    .all()
    .catch(() => ({ results: [] }));

  return c.json({ posts: posts.results, news: news.results });
});
