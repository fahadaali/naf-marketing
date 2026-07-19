import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth, requirePermission } from '../middleware';
import { hasPermission } from '../permissions';
import { newId } from '../util';

export const templateRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

templateRoutes.use('*', requireAuth);

templateRoutes.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT t.*, u.name AS creator_name FROM content_templates t
     LEFT JOIN users u ON u.id = t.created_by ORDER BY t.created_at DESC`,
  ).all();
  return c.json({ templates: results });
});

templateRoutes.post('/', requirePermission('draft.edit'), async (c) => {
  const user = c.get('user');
  const { name, body, content_type } = await c.req.json<{ name: string; body: string; content_type?: string }>();
  if (!name?.trim() || !body?.trim()) return c.json({ error: 'الاسم والمحتوى مطلوبان' }, 400);
  const id = newId('tpl');
  await c.env.DB.prepare(
    'INSERT INTO content_templates (id, name, body, content_type, created_by) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(id, name.trim(), body, content_type || 'text', user.id)
    .run();
  return c.json({ ok: true, id });
});

templateRoutes.delete('/:id', requirePermission('draft.edit'), async (c) => {
  const user = c.get('user');
  const tpl = await c.env.DB.prepare('SELECT created_by FROM content_templates WHERE id = ?')
    .bind(c.req.param('id'))
    .first<{ created_by: string }>();
  if (!tpl) return c.json({ error: 'غير موجود' }, 404);
  const isGM = await hasPermission(c.env, user.role_name, 'content.approve_final');
  if (tpl.created_by !== user.id && !isGM) return c.json({ error: 'لا يمكنك حذف قالب غيرك' }, 403);
  await c.env.DB.prepare('DELETE FROM content_templates WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});
