import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth, requirePermission } from '../middleware';
import { logAudit } from '../services/audit';

export const settingsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

settingsRoutes.use('*', requireAuth);

/* ═══ البادئة المحجوزة ═══

   `secret:` لا يخرج من هنا ولا يدخل من `PUT` أدناه. والحاجة إليها ثبتت
   بعطلٍ وقع: مسار تسجيل خطّاف SocialAPI صار يكتب سرّ توقيع HMAC في هذا
   الجدول، وهذه القراءة تردّ الجدول كلَّه لأي عضوٍ مسجَّل — والدور
   الافتراضي لأول داخلٍ من المركز `writer`. فقرأ السرَّ من لا يملك شيئاً.

   والحارس أدناه كان قائماً ولم يلتقطه: `SECRET_KEYS` تفحص `auth_secret`
   لا `webhook_secret`. وقائمةُ أسماء تُنسى، والبادئة لا تُنسى. */
const SECRET_PREFIX = 'secret:';

// قراءة الإعدادات غير السرية (متاحة لأي مستخدم مسجّل)
settingsRoutes.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT key, value FROM settings WHERE key NOT LIKE ?',
  )
    .bind(`${SECRET_PREFIX}%`)
    .all<{ key: string; value: string }>();
  const map: Record<string, unknown> = {};
  for (const r of results) {
    try {
      map[r.key] = JSON.parse(r.value);
    } catch {
      map[r.key] = r.value;
    }
  }
  return c.json({ settings: map });
});

// تحديث إعداد (المدير العام فقط) — لا تُقبل أي مفاتيح سرية هنا إطلاقاً
settingsRoutes.put('/', requirePermission('settings.manage'), async (c) => {
  const body = await c.req.json<Record<string, unknown>>();
  // `secret` و`token` مجرَّدين لا `auth_secret` وحدها: الاسم المركَّب
  // يمرّ من مصفاة تفحص مركَّباً آخر — وهو ما مرّ به `socialapi_webhook_secret`.
  const SECRET_KEYS = ['secret', 'token', 'api_key', 'password'];
  for (const [key, value] of Object.entries(body)) {
    const k = key.toLowerCase();
    if (k.startsWith(SECRET_PREFIX) || SECRET_KEYS.some((s) => k.includes(s))) {
      return c.json({ error: 'المفاتيح السرية تُدار عبر Cloudflare Secrets فقط' }, 400);
    }
    const stored = typeof value === 'string' ? value : JSON.stringify(value);
    await c.env.DB.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    )
      .bind(key, stored)
      .run();
  }
  const actor = c.get('user');
  c.executionCtx.waitUntil(
    logAudit(c.env, { id: actor.id, name: actor.name }, 'settings_update', 'settings', undefined, Object.keys(body).join('، ')),
  );
  return c.json({ ok: true });
});
