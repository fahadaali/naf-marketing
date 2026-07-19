import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth, requirePermission } from '../middleware';
import { hashPassword, newId } from '../util';
import { logAudit } from '../services/audit';

export const userRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

userRoutes.use('*', requireAuth);

userRoutes.get('/', requirePermission('users.manage'), async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, name, email, role_name, is_active, created_at FROM users ORDER BY created_at DESC',
  ).all();
  return c.json({ users: results });
});

userRoutes.post('/', requirePermission('users.manage'), async (c) => {
  const { name, email, password, role_name } = await c.req.json<{
    name: string;
    email: string;
    password: string;
    role_name: string;
  }>();
  const roles = ['writer', 'marketing_manager', 'general_manager'];
  if (!name || !email || !password || password.length < 8 || !roles.includes(role_name)) {
    return c.json({ error: 'بيانات غير مكتملة أو كلمة مرور قصيرة' }, 400);
  }
  const exists = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(email.toLowerCase())
    .first();
  if (exists) return c.json({ error: 'البريد مستخدم مسبقاً' }, 400);

  const id = newId('usr');
  await c.env.DB.prepare(
    'INSERT INTO users (id, name, email, password_hash, role_name) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(id, name, email.toLowerCase(), await hashPassword(password), role_name)
    .run();
  const actor = c.get('user');
  c.executionCtx.waitUntil(logAudit(c.env, { id: actor.id, name: actor.name }, 'user_create', 'user', id, `${email} (${role_name})`));
  return c.json({ ok: true, id });
});

userRoutes.patch('/:id', requirePermission('users.manage'), async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ role_name?: string; is_active?: boolean; password?: string }>();
  const roles = ['writer', 'marketing_manager', 'general_manager'];
  const actor = c.get('user');
  const changes: string[] = [];

  if (body.role_name && roles.includes(body.role_name)) {
    await c.env.DB.prepare('UPDATE users SET role_name = ? WHERE id = ?').bind(body.role_name, id).run();
    changes.push(`الدور → ${body.role_name}`);
  }
  if (typeof body.is_active === 'boolean') {
    await c.env.DB.prepare('UPDATE users SET is_active = ? WHERE id = ?')
      .bind(body.is_active ? 1 : 0, id)
      .run();
    changes.push(body.is_active ? 'تفعيل' : 'تعطيل');
  }
  if (body.password && body.password.length >= 8) {
    await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .bind(await hashPassword(body.password), id)
      .run();
    changes.push('إعادة تعيين كلمة المرور');
  }
  if (changes.length) {
    c.executionCtx.waitUntil(logAudit(c.env, { id: actor.id, name: actor.name }, 'user_update', 'user', id, changes.join('، ')));
  }
  return c.json({ ok: true });
});
