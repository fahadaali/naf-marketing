import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth, requirePermission } from '../middleware';
import { listBufferChannels } from '../adapters/buffer';
import { providerKey } from '../adapters';

export const bufferRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

bufferRoutes.use('*', requireAuth);

// حالة تكامل Buffer: هل رمز الوصول مضبوط، وكم حساباً مربوطاً
/* حُذف `‎/status`: شاشة «المنصات والمزوّد» تقرأ خريطة الحسابات من
   `‎/settings` وتعرض عددها من حالتها، وجاهزيةَ المفتاح من خطأ
   `‎/profiles` نفسه. فلم يكن له قارئ، ولا سؤالٌ ينفرد بجوابه. */

// جلب قنوات Buffer (channels) لربطها بمنصات المنصة — عبر واجهة Buffer الحديثة (GraphQL)
bufferRoutes.get('/profiles', requirePermission('settings.manage'), async (c) => {
  // قصّ أي مسافات/أسطر زائدة قد تتسلّل عند إدخال السرّ (سبب شائع لخطأ 401)
  const key = providerKey(c.env, 'buffer');
  if (!key) return c.json({ error: 'مفتاح Buffer غير مضبوط (BUFFER_API_KEY أو PROVIDER_API_KEY) عبر Cloudflare Secrets' }, 400);
  try {
    const channels = await listBufferChannels(key);
    const profiles = channels.map((ch) => ({ id: ch.id, service: ch.service, username: ch.name }));
    return c.json({ profiles });
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, 502);
  }
});
