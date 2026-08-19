import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth, requirePermission } from '../middleware';
import { logAudit } from '../services/audit';
import { notifyAccessChange } from '../sso';

export const userRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

userRoutes.use('*', requireAuth);

userRoutes.get('/', requirePermission('users.manage'), async (c) => {
  const { results } = await c.env.DB.prepare(
    /* `last_seen_at` معه: تكتبه حزمة naf-auth مع كل طلب منذ الترحيل
       ‏0022 — أُضيف لهذا الغرض بعينه — ولم يكن يقرؤه أحد. وهو الفرق
       بين «أما زال يستعمل المنصة؟» وتخمين. */
    `SELECT id, name, email, role_name, is_active, created_at, last_seen_at
     FROM users ORDER BY created_at DESC`,
  ).all();
  return c.json({ users: results });
});

/* لا إنشاء عضو من هنا، ولا إعادة تعيين كلمة مرور.

   العضوية تأتي من نظام الدخول الموحّد والصلاحية تُقرّر هنا: العضو يظهر
   في القائمة بعد أوّل دخول له من المركز، فيُنشأ سجلّه بالدور الافتراضي.
   وسجلٌّ يُنشأ هنا ببريد لا يطابق ما في المركز حرفياً يبقى معلّقاً إلى
   الأبد — لا يدخله صاحبه ولا يُربط به.

   وكلمة المرور لم يبقَ لها قارئ بعد إغلاق الدخول المحلي، فإعادة تعيينها
   تعطي المسؤول إحساس فعلٍ لا أثر له. */

userRoutes.patch('/:id', requirePermission('users.manage'), async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ role_name?: string; is_active?: boolean }>();
  const roles = ['writer', 'marketing_manager', 'general_manager'];
  const actor = c.get('user');
  const changes: string[] = [];

  if (body.role_name && roles.includes(body.role_name)) {
    await c.env.DB.prepare('UPDATE users SET role_name = ? WHERE id = ?').bind(body.role_name, id).run();
    changes.push(`الدور: ${body.role_name}`);
    // تبليغ المركز بالدور وحده — بلا حالة، فالمنح لم يتغيّر. يعرضه المركز
    // في صفّ الوصول ولا يقرّره. وخارج مسار الطلب: الترقية تمّت في القاعدة
    // فعلاً، وتعذّر الوصول إلى المركز خلل في العرض لا في العملية.
    if (typeof body.is_active !== 'boolean') {
      c.executionCtx.waitUntil(notifyAccessChange(c.env, id));
    }
  }
  if (typeof body.is_active === 'boolean') {
    await c.env.DB.prepare('UPDATE users SET is_active = ? WHERE id = ?')
      .bind(body.is_active ? 1 : 0, id)
      .run();
    changes.push(body.is_active ? 'تفعيل' : 'تعطيل');
    // تبليغ المركز ليظهر السبب للمستخدم في شبكته.
    // خارج مسار الطلب: تعطيل العضو تمّ في القاعدة فعلاً، وتعذّر الوصول
    // إلى المركز لا يجوز أن يردّ العملية على المسؤول بخطأ.
    c.executionCtx.waitUntil(notifyAccessChange(c.env, id, body.is_active));
  }
  if (changes.length) {
    c.executionCtx.waitUntil(logAudit(c.env, { id: actor.id, name: actor.name }, 'user_update', 'user', id, changes.join('، ')));
  }
  return c.json({ ok: true });
});
