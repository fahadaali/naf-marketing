import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth, requirePermission } from '../middleware';
import { ayrshareAuth, providerKey } from '../adapters';
import { registerSocialApiWebhook, listSocialApiWebhooks, deleteSocialApiWebhook } from '../adapters/socialapi';
import {
  AYRSHARE_WEBHOOK_ACTIONS, deleteAyrshareWebhook, listAyrshareWebhooks, registerAyrshareWebhook,
} from '../adapters/ayrshare';
import { syncComments } from '../services/commentsSync';
import { reconcilePublishing } from '../services/publish';

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

// HMAC-SHA256 لجسم الطلب الخام، بصيغة "sha256=<hex>"، مع مقارنة ثابتة الزمن.
export async function verifySignature(secret: string, rawBody: string, header: string): Promise<boolean> {
  if (!header) return false;
  return safeEqual(`sha256=${await hmacHex(secret, rawBody)}`, header);
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

/* السرّ تحت البادئة المحجوزة `secret:` — لا يخرج من `GET /api/settings`.
   وكان باسمٍ عاديّ في الجدول نفسه الذي تردّه تلك القراءة كاملاً لأي عضو. */
const WEBHOOK_SECRET_KEY = 'secret:socialapi_webhook';

// نقطة الاستقبال العامة (بلا مصادقة) — يجب أن تردّ 2xx خلال 10 ثوانٍ.
// نتحقق من التوقيع، ثم — لأحداث الصندوق — نُشغّل مزامنة كاملة في الخلفية كي تُخزَّن
// السجلات بترميز الرد الصحيح بدل الاعتماد على حمولة جزئية.
webhookRoutes.post('/socialapi', async (c) => {
  const raw = await c.req.text();
  const secret = await getSetting(c.env, WEBHOOK_SECRET_KEY);
  const sig = c.req.header('X-SocialAPI-Signature') || '';

  /* ═══ ولا يُقبل شيء بلا سرّ ═══

     كان الشرط `if (secret && !verify)` — أي أن غياب السرّ يعني قبول كل
     طلب. والمسار عام: `/api/webhooks/` مستثنًى في `PUBLIC_PREFIXES`،
     فمن يعرف العنوان يُشغّل `syncComments` كاملةً متى شاء على حصّة
     المزوّد. وخطّافٌ لم يُسجَّل بعدُ لا ينبغي أن يُستقبَل أصلاً — فالردّ
     ٤٠١ لا ٢٠٠، ويُسجَّل ليُقرأ من اللوغ لأن المنادي آلةٌ لا إنسان. */
  if (!secret) {
    console.error('socialapi: webhook_unregistered — وصل حدثٌ ولا سرّ توقيع مخزَّن');
    return c.text('Webhook not registered', 401);
  }
  if (!(await verifySignature(secret, raw, sig))) {
    return c.text('Invalid signature', 401);
  }
  let evt: any = null;
  try { evt = JSON.parse(raw); } catch { return c.text('bad request', 400); }
  const event = String(evt?.event || evt?.type || '');
  if (INBOX_EVENTS.includes(event)) {
    /* دورةٌ تزايدية بحصّتها، لا مسحٌ كامل لكل حدث: التعليقات تصل دفعاتٍ،
       ومزامنةٌ كاملة لكلٍّ منها تستهلك الحصّة مرّاتٍ على الشيء نفسه. والقفل
       يجمع الدفعة في دورةٍ واحدة — ما يصل خلالها تلتقطه التالية. */
    c.executionCtx.waitUntil(
      syncComments(c.env, { trigger: 'webhook', skipIfRunningWithinMs: 45_000 }).catch(() => {}),
    );
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
    if (secret) await setSetting(c.env, WEBHOOK_SECRET_KEY, secret);
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

/* ═══ Ayrshare ═══

   الحدث يُشغّل ما يقرؤه كاملاً بدل الاعتماد على حمولته: حمولة التعليق في
   إنستغرام تحمل معرّف Ayrshare للمنشور لا معرّف المنصة، وفيسبوك يُرسلها بشكل
   ميتا الخام. فالتعليقات والرسائل تُشغّل دورة الصندوق، و«المجدول» دورة التسوية
   التي تحسم منشور تيك توك المنتظر. ويُردّ ٢٠٠ فوراً — Ayrshare يعيد ما لم
   يُجب في خمس عشرة ثانية، والقفل يجمع المكرّر في دورةٍ واحدة. */

const AYRSHARE_SECRET_KEY = 'secret:ayrshare_webhook';

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
    c.executionCtx.waitUntil(
      syncComments(c.env, { trigger: 'webhook', skipIfRunningWithinMs: 45_000 }).catch(() => {}),
    );
  } else if (action === 'scheduled') {
    c.executionCtx.waitUntil(reconcilePublishing(c.env).then(() => {}).catch(() => {}));
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
