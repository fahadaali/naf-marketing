import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth, requirePermission } from '../middleware';
import { listSocialApiAccounts } from '../adapters/socialapi';

export const socialApiRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

socialApiRoutes.use('*', requireAuth);

socialApiRoutes.get('/status', requirePermission('settings.manage'), async (c) => {
  const configured = !!(c.env.PROVIDER_API_KEY || '').trim();
  const row = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'socialapi_profiles'").first<{ value: string }>();
  let mapped = 0;
  try { mapped = Object.values(row?.value ? JSON.parse(row.value) : {}).filter(Boolean).length; } catch { /* */ }
  return c.json({ configured, mapped });
});

// جلب حسابات SocialAPI المربوطة لربطها بمنصات المنصة
socialApiRoutes.get('/profiles', requirePermission('settings.manage'), async (c) => {
  const key = (c.env.PROVIDER_API_KEY || '').trim();
  if (!key) return c.json({ error: 'PROVIDER_API_KEY (مفتاح SocialAPI.ai) غير مضبوط عبر Cloudflare Secrets' }, 400);
  try {
    const accounts = await listSocialApiAccounts(key);
    const profiles = accounts.map((a) => ({ id: a.id, service: a.platform, username: a.name }));
    return c.json({ profiles });
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, 502);
  }
});
