import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth, requirePermission } from '../middleware';
import { ayrshareUser, listAyrshareWebhooks, type AyrshareAuth } from '../adapters/ayrshare';
import { providerKey } from '../adapters';
import { localSyncHealth } from './socialapi';

export const ayrshareRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

ayrshareRoutes.use('*', requireAuth);

/* صحّة التكامل بالشكل الذي يقرؤه `IntegrationHealth` في الإعدادات — كما يردّه
   `/socialapi/health`، فبطاقةٌ واحدة تعرض المزوّدَين ولا يُكتب لها نصٌّ جديد.

   ولا خريطة ربطٍ في Ayrshare: لكل منصةٍ حسابٌ واحد في الملف الرئيسي يُنشر
   إليه باسمها، فكل حسابٍ مربوطٍ لديه مربوطٌ عندنا. ولا حصّة تُعرض: خطة
   Launch بلا حدٍّ شهريٍّ للمنشورات. */
ayrshareRoutes.get('/health', requirePermission('settings.manage'), async (c) => {
  const key = providerKey(c.env, 'ayrshare');
  if (!key) return c.json({ configured: false });
  const auth: AyrshareAuth = { key };

  const out: Record<string, unknown> = { configured: true };
  const mapping: Record<string, string> = {};

  try {
    const { accounts, messagingEnabled } = await ayrshareUser(auth);
    out.accounts = accounts.map((a) => ({ id: a.id, platform: a.platform, name: a.name }));
    out.messaging_enabled = messagingEnabled;
    for (const a of accounts) mapping[a.platform] = a.id;
  } catch (e: any) { out.accounts_error = String(e?.message || e); }

  try {
    out.webhooks = (await listAyrshareWebhooks(auth)).map((h) => ({ id: h.event, url: h.url, is_active: true }));
  } catch (e: any) { out.webhooks_error = String(e?.message || e); }

  out.local = await localSyncHealth(c.env);
  out.mapping = mapping;

  return c.json(out);
});
