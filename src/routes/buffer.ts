import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth, requirePermission } from '../middleware';
import { listBufferChannels } from '../adapters/buffer';

export const bufferRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

bufferRoutes.use('*', requireAuth);

// حالة تكامل Buffer: هل رمز الوصول مضبوط، وكم حساباً مربوطاً
bufferRoutes.get('/status', requirePermission('settings.manage'), async (c) => {
  const configured = !!(c.env.PROVIDER_API_KEY || '').trim();
  const row = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'buffer_profiles'").first<{ value: string }>();
  let mapped = 0;
  try { mapped = Object.values(row?.value ? JSON.parse(row.value) : {}).filter(Boolean).length; } catch { /* */ }
  return c.json({ configured, mapped });
});

// جلب قنوات Buffer (channels) لربطها بمنصات المنصة — عبر واجهة Buffer الحديثة (GraphQL)
bufferRoutes.get('/profiles', requirePermission('settings.manage'), async (c) => {
  // قصّ أي مسافات/أسطر زائدة قد تتسلّل عند إدخال السرّ (سبب شائع لخطأ 401)
  const key = (c.env.PROVIDER_API_KEY || '').trim();
  if (!key) return c.json({ error: 'PROVIDER_API_KEY (رمز وصول Buffer) غير مضبوط عبر Cloudflare Secrets' }, 400);
  try {
    const channels = await listBufferChannels(key);
    const profiles = channels.map((ch) => ({ id: ch.id, service: ch.service, username: ch.name }));
    return c.json({ profiles });
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, 502);
  }
});
