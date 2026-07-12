import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import {
  createSession,
  destroySession,
  getSessionToken,
  getUserFromRequest,
  sessionCookie,
  clearSessionCookie,
  userCount,
} from '../auth';
import { hashPassword, verifyPassword, newId } from '../util';
import { permissionMap } from '../permissions';

export const authRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// التهيئة الأولى: إنشاء أول مدير عام عندما لا يوجد أي مستخدم.
authRoutes.get('/setup-status', async (c) => {
  const count = await userCount(c.env);
  return c.json({ needsSetup: count === 0 });
});

authRoutes.post('/setup', async (c) => {
  if ((await userCount(c.env)) > 0) return c.json({ error: 'تمت التهيئة مسبقاً' }, 400);
  const { name, email, password } = await c.req.json<{ name: string; email: string; password: string }>();
  if (!name || !email || !password || password.length < 8) {
    return c.json({ error: 'الاسم والبريد وكلمة مرور (٨ أحرف فأكثر) مطلوبة' }, 400);
  }
  const id = newId('usr');
  await c.env.DB.prepare(
    "INSERT INTO users (id, name, email, password_hash, role_name) VALUES (?, ?, ?, ?, 'general_manager')",
  )
    .bind(id, name, email.toLowerCase(), await hashPassword(password))
    .run();
  const token = await createSession(c.env, id);
  c.header('set-cookie', sessionCookie(token));
  return c.json({ ok: true });
});

authRoutes.post('/login', async (c) => {
  const { email, password } = await c.req.json<{ email: string; password: string }>();
  const user = await c.env.DB.prepare(
    'SELECT id, password_hash, is_active FROM users WHERE email = ?',
  )
    .bind((email || '').toLowerCase())
    .first<{ id: string; password_hash: string; is_active: number }>();

  if (!user || !(await verifyPassword(password || '', user.password_hash))) {
    return c.json({ error: 'البريد أو كلمة المرور غير صحيحة' }, 401);
  }
  if (!user.is_active) return c.json({ error: 'الحساب معطّل' }, 403);

  const token = await createSession(c.env, user.id);
  c.header('set-cookie', sessionCookie(token));
  return c.json({ ok: true });
});

authRoutes.post('/logout', async (c) => {
  const token = getSessionToken(c.req.raw);
  if (token) await destroySession(c.env, token);
  c.header('set-cookie', clearSessionCookie());
  return c.json({ ok: true });
});

// المستخدم الحالي + صلاحياته (لتكييف الواجهة — التحقق الفعلي يبقى على الخادم)
authRoutes.get('/me', async (c) => {
  const user = await getUserFromRequest(c.env, c.req.raw);
  if (!user) return c.json({ user: null });
  const permissions = await permissionMap(c.env, user.role_name);
  return c.json({ user, permissions });
});
