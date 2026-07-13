import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth, requirePermission } from '../middleware';
import { generateText } from '../services/claude';
import {
  isConfigured,
  listFiles,
  getFileText,
  authorizeUrl,
  exchangeCode,
} from '../services/basecamp';

export const basecampRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// مخطط OAuth (عام قبل المصادقة كي يعمل تدفّق المتصفح) — للحصول على refresh token أول مرة.
basecampRoutes.get('/oauth/start', async (c) => {
  if (!c.env.BASECAMP_CLIENT_ID) return c.text('اضبط BASECAMP_CLIENT_ID أولاً عبر Secrets.', 400);
  const redirectUri = new URL('/api/basecamp/oauth/callback', c.req.url).toString();
  return c.redirect(authorizeUrl(c.env, redirectUri));
});

basecampRoutes.get('/oauth/callback', async (c) => {
  const code = c.req.query('code');
  if (!code) return c.text('لا يوجد رمز تفويض.', 400);
  const redirectUri = new URL('/api/basecamp/oauth/callback', c.req.url).toString();
  try {
    const data = await exchangeCode(c.env, code, redirectUri);
    const accounts = (data.accounts || [])
      .map((a: any) => `<li>#${a.id} — ${a.name} (${a.product})</li>`)
      .join('');
    // صفحة تعرض refresh token ومعرّفات الحسابات لنسخها إلى Secrets/الإعدادات (تُعرض مرة واحدة).
    return c.html(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<style>body{font-family:system-ui;max-width:680px;margin:40px auto;padding:0 20px;line-height:1.8}
code{background:#f1f1f4;padding:2px 6px;border-radius:6px;word-break:break-all}
.box{background:#f7f7f9;border:1px solid #e2e2e8;border-radius:12px;padding:16px;margin:14px 0}</style></head>
<body><h2>تم ربط بيسكامب ✅</h2>
<p>انسخ القيم التالية إلى Cloudflare Secrets والإعدادات، ثم أغلق هذه الصفحة:</p>
<div class="box"><b>BASECAMP_REFRESH_TOKEN</b> (سرّ):<br><code>${data.refresh_token || '(غير متوفر)'}</code></div>
<div class="box"><b>الحسابات المتاحة</b> (استخدم معرّف الحساب في الإعدادات):<ul>${accounts || '<li>لا يوجد</li>'}</ul></div>
<p class="box">اضبط السرّ: <code>wrangler secret put BASECAMP_REFRESH_TOKEN</code><br>
ثم ضع معرّف الحساب والمشروع في: الإعدادات ← التكاملات.</p>
</body></html>`);
  } catch (e: any) {
    return c.text(`فشل: ${e.message}`, 502);
  }
});

// ما دون ذلك يتطلّب مصادقة
basecampRoutes.use('/status', requireAuth);
basecampRoutes.use('/files', requireAuth);
basecampRoutes.use('/generate', requireAuth);

basecampRoutes.get('/status', async (c) => {
  const configured = await isConfigured(c.env);
  const project = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'basecamp_project_id'").first<{
    value: string;
  }>();
  return c.json({ configured, project_set: !!project?.value });
});

basecampRoutes.get('/files', requirePermission('ai.generate'), async (c) => {
  if (!(await isConfigured(c.env))) return c.json({ error: 'لم يُضبط تكامل بيسكامب بعد' }, 400);
  try {
    const files = await listFiles(c.env);
    return c.json({ files });
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, 502);
  }
});

// توليد محتوى من ملف مختار في «مركز المعرفة»
basecampRoutes.post('/generate', requirePermission('ai.generate'), async (c) => {
  if (!(await isConfigured(c.env))) return c.json({ error: 'لم يُضبط تكامل بيسكامب بعد' }, 400);
  const { type, id, tone, length, platform } = await c.req.json<any>();
  if (!type || !id) return c.json({ error: 'اختر ملفاً' }, 400);
  try {
    const file = await getFileText(c.env, type, Number(id));
    if (!file.text) return c.json({ error: 'الملف لا يحتوي نصاً قابلاً للقراءة' }, 400);
    const text = await generateText(c.env, {
      mode: 'rewrite',
      topic: file.title,
      sourceText: `${file.title}\n\n${file.text}`,
      tone,
      length,
      platform,
      language: 'العربية',
    });
    return c.json({ text, title: file.title });
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, 502);
  }
});
