import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth, requirePermission } from '../middleware';
import { syncComments, replyToComment } from '../services/commentsSync';

export const commentRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

commentRoutes.use('*', requireAuth);
commentRoutes.use('*', requirePermission('comments.manage'));

// قائمة التعليقات/الرسائل مع فلاتر (platform, replied)
commentRoutes.get('/', async (c) => {
  const platform = c.req.query('platform');
  const replied = c.req.query('replied'); // '1' | '0'
  const where: string[] = [];
  const binds: unknown[] = [];
  if (platform) { where.push('pc.platform = ?'); binds.push(platform); }
  if (replied === '1') where.push('pc.reply_body IS NOT NULL');
  if (replied === '0') where.push('pc.reply_body IS NULL');
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { results } = await c.env.DB.prepare(
    `SELECT pc.*, p.title AS post_title, u.name AS replier_name
     FROM platform_comments pc
     LEFT JOIN content_posts p ON p.id = pc.post_id
     LEFT JOIN users u ON u.id = pc.replied_by
     ${clause}
     ORDER BY pc.created_at DESC LIMIT 200`,
  )
    .bind(...binds)
    .all();
  return c.json({ comments: results });
});

// جلب فوري (إضافةً إلى الدورة الآلية كل ساعة)
commentRoutes.post('/refresh', async (c) => {
  const added = await syncComments(c.env);
  return c.json({ ok: true, added });
});

// الرد على تعليق/رسالة
commentRoutes.post('/:id/reply', async (c) => {
  const { text } = await c.req.json<{ text: string }>();
  if (!text?.trim()) return c.json({ error: 'اكتب نص الرد' }, 400);
  try {
    await replyToComment(c.env, c.req.param('id'), text.trim(), c.get('user').id);
    return c.json({ ok: true });
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, 502);
  }
});
