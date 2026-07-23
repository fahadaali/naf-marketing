import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth, requirePermission } from '../middleware';

export const bufferRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

bufferRoutes.use('*', requireAuth);

// حالة تكامل Buffer: هل رمز الوصول مضبوط، وكم حساباً مربوطاً
bufferRoutes.get('/status', requirePermission('settings.manage'), async (c) => {
  const configured = !!c.env.PROVIDER_API_KEY;
  const row = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'buffer_profiles'").first<{ value: string }>();
  let mapped = 0;
  try { mapped = Object.values(row?.value ? JSON.parse(row.value) : {}).filter(Boolean).length; } catch { /* */ }
  return c.json({ configured, mapped });
});

// جلب حسابات Buffer (profiles) لربطها بمنصات المنصة
bufferRoutes.get('/profiles', requirePermission('settings.manage'), async (c) => {
  const key = c.env.PROVIDER_API_KEY;
  if (!key) return c.json({ error: 'PROVIDER_API_KEY (رمز وصول Buffer) غير مضبوط عبر Cloudflare Secrets' }, 400);
  try {
    const res = await fetch(`https://api.bufferapp.com/1/profiles.json?access_token=${encodeURIComponent(key)}`);
    const text = await res.text();
    let data: any = null;
    try { data = JSON.parse(text); } catch { /* رد غير JSON */ }
    if (!res.ok || data == null) {
      return c.json({ error: `تعذّر الاتصال بـ Buffer (${res.status})${data?.message ? `: ${data.message}` : ''}` }, 502);
    }
    const profiles = (Array.isArray(data) ? data : []).map((p: any) => ({
      id: String(p.id),
      service: p.service || '',
      username: p.formatted_username || p.service_username || p.formatted_service || p.service || String(p.id),
    }));
    return c.json({ profiles });
  } catch (e: any) {
    return c.json({ error: `تعذّر الاتصال بـ Buffer: ${String(e?.message || e)}` }, 502);
  }
});
