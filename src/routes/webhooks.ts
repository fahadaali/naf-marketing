import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth, requirePermission } from '../middleware';
import { providerKey } from '../adapters';
import { registerSocialApiWebhook, listSocialApiWebhooks, deleteSocialApiWebhook } from '../adapters/socialapi';
import { syncComments } from '../services/commentsSync';

export const webhookRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// الأحداث التي نستقبلها من SocialAPI (صندوق الوارد الفوري)
const INBOX_EVENTS = ['comment.received', 'dm.received', 'review.received', 'mention.received'];

async function getSetting(env: Env, key: string): Promise<string> {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value || '';
}
async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).bind(key, value).run();
}

// HMAC-SHA256 لجسم الطلب الخام، بصيغة "sha256=<hex>"، مع مقارنة ثابتة الزمن.
async function verifySignature(secret: string, rawBody: string, header: string): Promise<boolean> {
  if (!header) return false;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const expected = `sha256=${hex}`;
  if (expected.length !== header.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ header.charCodeAt(i);
  return diff === 0;
}

// نقطة الاستقبال العامة (بلا مصادقة) — يجب أن تردّ 2xx خلال 10 ثوانٍ.
// نتحقق من التوقيع، ثم — لأحداث الصندوق — نُشغّل مزامنة كاملة في الخلفية كي تُخزَّن
// السجلات بترميز الرد الصحيح بدل الاعتماد على حمولة جزئية.
webhookRoutes.post('/socialapi', async (c) => {
  const raw = await c.req.text();
  const secret = await getSetting(c.env, 'socialapi_webhook_secret');
  const sig = c.req.header('X-SocialAPI-Signature') || '';
  if (secret && !(await verifySignature(secret, raw, sig))) {
    return c.text('Invalid signature', 401);
  }
  let evt: any = null;
  try { evt = JSON.parse(raw); } catch { return c.text('bad request', 400); }
  const event = String(evt?.event || evt?.type || '');
  if (INBOX_EVENTS.includes(event)) {
    c.executionCtx.waitUntil(syncComments(c.env).catch(() => {}));
  }
  return c.text('ok', 200);
});

// إدارة الويب هوك (مصادقة مطلوبة)
webhookRoutes.use('/socialapi/manage/*', requireAuth, requirePermission('comments.manage'));

// تسجيل نقطة الاستقبال لدى SocialAPI وتخزين السرّ محلياً
webhookRoutes.post('/socialapi/manage/register', async (c) => {
  const token = providerKey(c.env, 'socialapi');
  if (!token) return c.json({ error: 'لا يوجد مفتاح SocialAPI' }, 400);
  // نبني عنوان النقطة من أصل الطلب الحالي
  const origin = new URL(c.req.url).origin;
  const url = `${origin}/api/webhooks/socialapi`;
  try {
    const { id, secret } = await registerSocialApiWebhook(token, url, INBOX_EVENTS);
    if (secret) await setSetting(c.env, 'socialapi_webhook_secret', secret);
    if (id) await setSetting(c.env, 'socialapi_webhook_id', id);
    return c.json({ ok: true, id, url });
  } catch (e: any) {
    return c.json({ error: `تعذّر تسجيل الويب هوك: ${String(e?.message || e)}` }, 502);
  }
});

// سرد نقاط الاستقبال المسجّلة
webhookRoutes.get('/socialapi/manage/list', async (c) => {
  const token = providerKey(c.env, 'socialapi');
  if (!token) return c.json({ error: 'لا يوجد مفتاح SocialAPI' }, 400);
  try {
    return c.json({ webhooks: await listSocialApiWebhooks(token) });
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, 502);
  }
});

// حذف نقطة استقبال
webhookRoutes.delete('/socialapi/manage/:id', async (c) => {
  const token = providerKey(c.env, 'socialapi');
  if (!token) return c.json({ error: 'لا يوجد مفتاح SocialAPI' }, 400);
  await deleteSocialApiWebhook(token, c.req.param('id'));
  return c.json({ ok: true });
});
