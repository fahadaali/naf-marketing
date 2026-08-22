import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth, requirePermission } from '../middleware';
import { listSocialApiAccounts, listSocialApiWebhooks, socialApiUsage } from '../adapters/socialapi';
import { providerKey } from '../adapters';

export const socialApiRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

socialApiRoutes.use('*', requireAuth);

/* حُذف `‎/status`: كان يردّ `configured` و`mapped` وحدهما، وهما داخل ردّ
   `‎/health` أدناه وأوسع منه — والواجهة تنادي `‎/health` لا سواه. مساران
   لسؤالٍ واحد يفترقان أوّل ما يُعدَّل أحدهما. */

// صحّة التكامل: الحسابات وحالتها، استهلاك الحصة، الويب هوكس، وآخر مزامنة ناجحة.
// كل جزء مستقل — فشل أحدها لا يُسقط البقية (نُعيد خطأه في حقله).
socialApiRoutes.get('/health', requirePermission('settings.manage'), async (c) => {
  const key = providerKey(c.env, 'socialapi');
  if (!key) return c.json({ configured: false });

  const out: Record<string, unknown> = { configured: true };

  try {
    const accounts = await listSocialApiAccounts(key);
    out.accounts = accounts.map((a) => ({ id: a.id, platform: a.platform, name: a.name }));
  } catch (e: any) { out.accounts_error = String(e?.message || e); }

  try { out.usage = await socialApiUsage(key); }
  catch (e: any) { out.usage_error = String(e?.message || e); }

  try {
    const hooks = await listSocialApiWebhooks(key);
    out.webhooks = hooks.map((h: any) => ({ id: h.id, url: h.url, is_active: h.is_active }));
  } catch (e: any) { out.webhooks_error = String(e?.message || e); }

  // آخر نشاط فعلي مسجّل لدينا (لا لدى المزوّد)
  const lastAnalytics = await c.env.DB.prepare(
    'SELECT MAX(captured_at) AS t, COUNT(*) AS n FROM analytics_snapshots',
  ).first<{ t: string | null; n: number }>();
  const lastComment = await c.env.DB.prepare(
    'SELECT MAX(created_at) AS t, COUNT(*) AS n FROM platform_comments',
  ).first<{ t: string | null; n: number }>();
  const pending = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM schedules WHERE status = 'pending'",
  ).first<{ n: number }>();
  const failed = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM schedules WHERE status = 'failed'",
  ).first<{ n: number }>();

  out.local = {
    analytics_last: lastAnalytics?.t || null,
    analytics_count: lastAnalytics?.n || 0,
    inbox_last: lastComment?.t || null,
    inbox_count: lastComment?.n || 0,
    schedules_pending: pending?.n || 0,
    schedules_failed: failed?.n || 0,
  };

  // خريطة الربط المحفوظة
  const row = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'socialapi_profiles'").first<{ value: string }>();
  try { out.mapping = row?.value ? JSON.parse(row.value) : {}; } catch { out.mapping = {}; }

  return c.json(out);
});

// جلب حسابات SocialAPI المربوطة لربطها بمنصات المنصة
socialApiRoutes.get('/profiles', requirePermission('settings.manage'), async (c) => {
  const key = providerKey(c.env, 'socialapi');
  if (!key) return c.json({ error: 'مفتاح SocialAPI.ai غير مضبوط (SOCIALAPI_API_KEY أو PROVIDER_API_KEY) عبر Cloudflare Secrets' }, 400);
  try {
    const accounts = await listSocialApiAccounts(key);
    const profiles = accounts.map((a) => ({ id: a.id, service: a.platform, username: a.name }));
    return c.json({ profiles });
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, 502);
  }
});
