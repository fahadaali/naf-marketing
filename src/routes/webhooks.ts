import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth, requirePermission } from '../middleware';
import { ayrshareAuth } from '../adapters';
import {
  AYRSHARE_WEBHOOK_ACTIONS, deleteAyrshareWebhook, listAyrshareWebhooks, registerAyrshareWebhook,
} from '../adapters/ayrshare';
import { queuePendingPost, syncComments, type PendingPost } from '../services/commentsSync';
import { reconcilePublishing } from '../services/publish';
import { onSocialEvent, onSuspendedEvent } from '../services/ayrshareAlerts';

export const webhookRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

async function getSetting(env: Env, key: string): Promise<string> {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value || '';
}
async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).bind(key, value).run();
}

/** HMAC-SHA256 لجسم الطلب الخام بصيغة hex. */
async function hmacHex(secret: string, rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** مقارنةٌ ثابتة الزمن — لا يُعرف من وقتها كم حرفاً طابق. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * توقيع Ayrshare: hex بلا بادئة في `X-Authorization-Content-SHA256`، و`-V2`
 * يسرد `v1=<توقيع>` لكل سرٍّ صالح مفصولةً بفواصل — سرّان خلال يومٍ بعد
 * التدوير. يُقبل إن طابق أيٌّ منها.
 */
export async function verifyAyrshareSignature(secret: string, rawBody: string, v1Header: string, v2Header: string): Promise<boolean> {
  const listed = v2Header
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.startsWith('v1='))
    .map((p) => p.slice(3));
  const candidates = listed.length ? listed : v1Header ? [v1Header.trim()] : [];
  if (!candidates.length) return false;
  const expected = await hmacHex(secret, rawBody);
  return candidates.some((sig) => safeEqual(expected, sig.toLowerCase()));
}

/* ═══ Ayrshare ═══

   الحدث يُشغّل دورة الصندوق، و«المجدول» دورة التسوية التي تحسم منشور تيك
   توك المنتظر، وإلغاءُ ربط حسابٍ أو تعطيلُ حساب النشر تنبيهَ الفريق
   (`services/ayrshareAlerts.ts`). ويُردّ ٢٠٠ فوراً — Ayrshare يعيد ما لم
   يُجب في خمس عشرة ثانية، والقفل يجمع المكرّر في دورةٍ واحدة.

   وحدثُ التعليق يحمل المنشور الذي وصل عليه بمعرّفه على منصته — `media.id` في
   إنستغرام و`post_id` في فيسبوك (Comments Action في توثيقه)؛ و`postId` فيه
   معرّف Ayrshare، يغيب عمّا نُشر من التطبيق. فيُقرأ ذلك المنشور أوّلاً
   (`queuePendingPost`) — وكان لا يُقرأ ما لم يتغيّر عدد تعليقاته في أرقامه،
   والعدد يتأخّر ساعاتٍ عن التعليق. */

const AYRSHARE_SECRET_KEY = 'secret:ayrshare_webhook';

/** المنشور الذي وصل عليه التعليق — بمعرّفه على منصته، أو `null`. */
export function commentEventPost(evt: any): PendingPost | null {
  const platform = String(evt?.platform || '').toLowerCase();
  if (platform === 'instagram') {
    const id = evt?.media?.id ?? evt?.media_id;
    return id ? { platform, postId: String(id) } : null;
  }
  if (platform === 'facebook') {
    // فيسبوك بشكل ميتا كما هو: تغييرٌ في `feed` الصفحة — قيمتُه في أعلى الحدث أو داخل `entry`
    const value = evt?.value ?? evt?.entry?.[0]?.changes?.[0]?.value ?? evt?.changes?.[0]?.value ?? evt;
    const id = value?.post_id ?? value?.postId;
    return id && String(id).includes('_') ? { platform, postId: String(id) } : null;
  }
  return null;
}

webhookRoutes.post('/ayrshare', async (c) => {
  const raw = await c.req.text();
  const secret = await getSetting(c.env, AYRSHARE_SECRET_KEY);
  if (!secret) {
    console.error('ayrshare: webhook_unregistered — وصل حدثٌ ولا سرّ توقيع مخزَّن');
    return c.text('Webhook not registered', 401);
  }
  const ok = await verifyAyrshareSignature(
    secret, raw, c.req.header('X-Authorization-Content-SHA256') || '', c.req.header('X-Authorization-Content-SHA256-V2') || '',
  );
  if (!ok) return c.text('Invalid signature', 401);

  let evt: any = null;
  try { evt = JSON.parse(raw); } catch { return c.text('bad request', 400); }
  const action = String(evt?.action || '');
  if (action === 'comments' || action === 'messages') {
    const post = action === 'comments' ? commentEventPost(evt) : null;
    c.executionCtx.waitUntil(
      (post ? queuePendingPost(c.env, post).catch(() => {}) : Promise.resolve())
        .then(() => syncComments(c.env, { trigger: 'webhook', skipIfRunningWithinMs: 45_000 }))
        .catch(() => {}),
    );
  } else if (action === 'scheduled') {
    c.executionCtx.waitUntil(reconcilePublishing(c.env).then(() => {}).catch(() => {}));
  } else if (action === 'social') {
    c.executionCtx.waitUntil(onSocialEvent(c.env, evt).catch(() => {}));
  } else if (action === 'suspended') {
    c.executionCtx.waitUntil(onSuspendedEvent(c.env, evt).catch(() => {}));
  }
  return c.text('ok', 200);
});

webhookRoutes.use('/ayrshare/manage/*', requireAuth, requirePermission('comments.manage'));

/** سرٌّ عشوائي طويل بترميز base64url — كما يوصي Ayrshare. */
function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* التسجيل: سرٌّ جديد يُحفظ هنا ويُرسل مع تسجيل كل حدث. وسرٌّ سابق يبقى صالحاً
   يوماً عند Ayrshare، فلا تُرفض أحداثٌ في الطريق. والسبب يُذكر باسم الحدث
   الذي تعذّر — فلا يُقرأ «تعذّر التسجيل» وحده ولا يُعرف أين. */
webhookRoutes.post('/ayrshare/manage/register', async (c) => {
  const auth = ayrshareAuth(c.env);
  if (!auth) return c.json({ error: 'لا يوجد مفتاح Ayrshare' }, 400);
  const url = `${new URL(c.req.url).origin}/api/webhooks/ayrshare`;
  const secret = randomSecret();
  await setSetting(c.env, AYRSHARE_SECRET_KEY, secret);
  // حدثٌ يتعذّر (الرسائل قبل تفعيلها مثلاً) لا يمنع تسجيل غيره
  const done: string[] = [];
  const failed: string[] = [];
  for (const action of AYRSHARE_WEBHOOK_ACTIONS) {
    try {
      await registerAyrshareWebhook(auth, action, url, secret);
      done.push(action);
    } catch (e: any) {
      failed.push(`«${action}»: ${String(e?.message || e)}`);
    }
  }
  if (failed.length) {
    const head = done.length ? `سُجّل ${done.join('، ')}، وتعذّر` : 'تعذّر تسجيل';
    return c.json({ error: `${head} ${failed.join(' · ')}`, registered: done }, 502);
  }
  return c.json({ ok: true, url, registered: done });
});

webhookRoutes.get('/ayrshare/manage/list', async (c) => {
  const auth = ayrshareAuth(c.env);
  if (!auth) return c.json({ error: 'لا يوجد مفتاح Ayrshare' }, 400);
  try {
    // المعرّف اسم الحدث — به يُحذف
    return c.json({ webhooks: (await listAyrshareWebhooks(auth)).map((h) => ({ id: h.event, url: h.url })) });
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, 502);
  }
});

webhookRoutes.delete('/ayrshare/manage/:id', async (c) => {
  const auth = ayrshareAuth(c.env);
  if (!auth) return c.json({ error: 'لا يوجد مفتاح Ayrshare' }, 400);
  try {
    await deleteAyrshareWebhook(auth, c.req.param('id'));
    return c.json({ ok: true });
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, 502);
  }
});
