import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth, requirePermission } from '../middleware';

export const auditRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

auditRoutes.use('*', requireAuth);
auditRoutes.use('*', requirePermission('audit.view'));

// سجل التدقيق — من فعل ماذا ومتى (فلاتر: action, entity_type, q على اسم الفاعل)
auditRoutes.get('/', async (c) => {
  const action = c.req.query('action');
  const entityType = c.req.query('entity_type');
  const q = c.req.query('q');

  const where: string[] = [];
  const binds: unknown[] = [];
  if (action) { where.push('action = ?'); binds.push(action); }
  if (entityType) { where.push('entity_type = ?'); binds.push(entityType); }
  if (q) { where.push('actor_name LIKE ?'); binds.push(`%${q}%`); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM audit_log ${clause} ORDER BY created_at DESC LIMIT 300`,
  )
    .bind(...binds)
    .all();
  const actions = await c.env.DB.prepare('SELECT DISTINCT action FROM audit_log ORDER BY action').all<{ action: string }>();
  return c.json({ entries: results, actions: actions.results.map((r) => r.action) });
});
