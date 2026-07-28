// مسارا الجلسة الباقيان بعد إزالة الدخول المحلي.
//
// لا `‎/login` ولا `‎/setup` ولا `‎/setup-status`: الدخول كلُّه في `naf-id`،
// وأول عضو يُنشأ من لوحة المركز لا من شاشة تهيئة هنا. ومسارٌ يُنشئ مديراً
// عاماً حين يخلو الجدول من المستخدمين كان يبقى قنبلةً موقوتة: قاعدةٌ فارغة
// بعد ترحيل، أو بيئةٌ جديدة، تفتحه لأول من يصل.

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { endSession, getUserFromRequest } from '../auth';
import { permissionMap } from '../permissions';
import { logAudit } from '../services/audit';

export const authRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/** الخروج من هذه المنصة وحدها — جلسة المركز لا تُمسّ. */
authRoutes.post('/logout', async (c) => {
  const user = await getUserFromRequest(c.env, c.req.raw);
  c.header('set-cookie', await endSession(c.env, c.req.raw));
  if (user) {
    c.executionCtx.waitUntil(logAudit(c.env, { id: user.id, name: user.name }, 'logout', 'user', user.id));
  }
  return c.json({ ok: true });
});

// المستخدم الحالي + صلاحياته (لتكييف الواجهة — التحقق الفعلي يبقى على الخادم)
authRoutes.get('/me', async (c) => {
  const user = await getUserFromRequest(c.env, c.req.raw);
  if (!user) return c.json({ user: null });
  const permissions = await permissionMap(c.env, user.role_name);
  return c.json({ user, permissions });
});
