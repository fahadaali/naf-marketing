import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth } from '../middleware';

export const notificationRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

notificationRoutes.use('*', requireAuth);

notificationRoutes.get('/', async (c) => {
  const user = c.get('user');
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
  )
    .bind(user.id)
    .all();
  const unread = await c.env.DB.prepare(
    'SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND read_at IS NULL',
  )
    .bind(user.id)
    .first<{ c: number }>();
  return c.json({ notifications: results, unread: unread?.c || 0 });
});

notificationRoutes.post('/:id/read', async (c) => {
  const user = c.get('user');
  await c.env.DB.prepare(
    "UPDATE notifications SET read_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ? AND user_id = ?",
  )
    .bind(c.req.param('id'), user.id)
    .run();
  return c.json({ ok: true });
});

notificationRoutes.post('/read-all', async (c) => {
  const user = c.get('user');
  await c.env.DB.prepare(
    "UPDATE notifications SET read_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE user_id = ? AND read_at IS NULL",
  )
    .bind(user.id)
    .run();
  return c.json({ ok: true });
});
