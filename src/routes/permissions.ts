import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth, requirePermission } from '../middleware';
import { allPermissions, PERMISSION_LABELS } from '../permissions';
import { logAudit } from '../services/audit';

export const permissionRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

permissionRoutes.use('*', requireAuth);

// عرض المصفوفة الكاملة (المدير العام)
permissionRoutes.get('/', requirePermission('permissions.manage'), async (c) => {
  const rows = await allPermissions(c.env);
  return c.json({ permissions: rows, labels: PERMISSION_LABELS });
});

// تعديل خانة واحدة — يسري الأثر فوراً (يُقرأ من قاعدة البيانات في كل تحقّق)
permissionRoutes.patch('/', requirePermission('permissions.manage'), async (c) => {
  const { role_name, permission_key, allowed } = await c.req.json<{
    role_name: string;
    permission_key: string;
    allowed: boolean;
  }>();
  const roles = ['writer', 'marketing_manager', 'general_manager'];
  if (!roles.includes(role_name) || !permission_key) {
    return c.json({ error: 'قيم غير صالحة' }, 400);
  }
  await c.env.DB.prepare(
    `INSERT INTO roles_permissions (role_name, permission_key, allowed) VALUES (?, ?, ?)
     ON CONFLICT(role_name, permission_key) DO UPDATE SET allowed = excluded.allowed`,
  )
    .bind(role_name, permission_key, allowed ? 1 : 0)
    .run();
  const actor = c.get('user');
  c.executionCtx.waitUntil(
    logAudit(c.env, { id: actor.id, name: actor.name }, 'permission_change', 'role', role_name, `${permission_key} = ${allowed ? 'مسموح' : 'ممنوع'}`),
  );
  return c.json({ ok: true });
});
