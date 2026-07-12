import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth, requirePermission } from '../middleware';

export const settingsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

settingsRoutes.use('*', requireAuth);

// قراءة الإعدادات غير السرية (متاحة لأي مستخدم مسجّل — لا أسرار هنا)
settingsRoutes.get('/', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT key, value FROM settings').all<{
    key: string;
    value: string;
  }>();
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
  const SECRET_KEYS = ['claude_api_key', 'provider_api_key', 'auth_secret', 'password'];
  for (const [key, value] of Object.entries(body)) {
    if (SECRET_KEYS.some((s) => key.toLowerCase().includes(s))) {
      return c.json({ error: 'المفاتيح السرية تُدار عبر Cloudflare Secrets فقط' }, 400);
    }
    const stored = typeof value === 'string' ? value : JSON.stringify(value);
    await c.env.DB.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    )
      .bind(key, stored)
      .run();
  }
  return c.json({ ok: true });
});
