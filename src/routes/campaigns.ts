import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth, requirePermission } from '../middleware';
import { newId } from '../util';

export const campaignRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

campaignRoutes.use('*', requireAuth);

campaignRoutes.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT cm.*, (SELECT COUNT(*) FROM content_posts p WHERE p.campaign_id = cm.id) AS posts_count
     FROM campaigns cm ORDER BY cm.created_at DESC`,
  ).all();
  return c.json({ campaigns: results });
});

campaignRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const campaign = await c.env.DB.prepare('SELECT * FROM campaigns WHERE id = ?').bind(id).first();
  if (!campaign) return c.json({ error: 'غير موجودة' }, 404);
  const posts = await c.env.DB.prepare(
    'SELECT id, title, status, content_type FROM content_posts WHERE campaign_id = ? ORDER BY updated_at DESC',
  )
    .bind(id)
    .all();
  return c.json({ campaign, posts: posts.results });
});

// إنشاء/تعديل الحملات يتطلّب صلاحية الجدولة (مدير تسويق/عام)
campaignRoutes.post('/', requirePermission('content.schedule'), async (c) => {
  const b = await c.req.json<any>();
  if (!b.name) return c.json({ error: 'اسم الحملة مطلوب' }, 400);
  const id = newId('camp');
  await c.env.DB.prepare(
    `INSERT INTO campaigns (id, name, objective, start_date, end_date, target_platforms, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      b.name,
      b.objective || null,
      b.start_date || null,
      b.end_date || null,
      JSON.stringify(b.target_platforms || []),
      b.status || 'active',
    )
    .run();
  return c.json({ ok: true, id });
});

campaignRoutes.patch('/:id', requirePermission('content.schedule'), async (c) => {
  const id = c.req.param('id');
  const b = await c.req.json<any>();
  const fields: string[] = [];
  const binds: unknown[] = [];
  for (const key of ['name', 'objective', 'start_date', 'end_date', 'status']) {
    if (b[key] !== undefined) (fields.push(`${key} = ?`), binds.push(b[key]));
  }
  if (b.target_platforms !== undefined) {
    fields.push('target_platforms = ?');
    binds.push(JSON.stringify(b.target_platforms));
  }
  if (!fields.length) return c.json({ ok: true });
  binds.push(id);
  await c.env.DB.prepare(`UPDATE campaigns SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...binds)
    .run();
  return c.json({ ok: true });
});
