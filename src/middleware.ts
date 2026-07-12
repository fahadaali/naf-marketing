import type { MiddlewareHandler } from 'hono';
import type { Env, Variables } from './types';
import { getUserFromRequest } from './auth';
import { hasPermission } from './permissions';

type Bindings = { Bindings: Env; Variables: Variables };

// يتطلّب جلسة صالحة
export const requireAuth: MiddlewareHandler<Bindings> = async (c, next) => {
  const user = await getUserFromRequest(c.env, c.req.raw);
  if (!user) return c.json({ error: 'غير مصرّح: الرجاء تسجيل الدخول' }, 401);
  c.set('user', user);
  await next();
};

// يتطلّب صلاحية محددة (يُتحقق منها على الخادم دائماً)
export function requirePermission(permissionKey: string): MiddlewareHandler<Bindings> {
  return async (c, next) => {
    const user = c.get('user');
    if (!user) return c.json({ error: 'غير مصرّح' }, 401);
    const ok = await hasPermission(c.env, user.role_name, permissionKey);
    if (!ok) return c.json({ error: 'ليست لديك صلاحية لهذه العملية' }, 403);
    await next();
  };
}
