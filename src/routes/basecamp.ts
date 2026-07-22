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
import { buildReportWorkbook, uploadWeeklyReport, uploadMonthlyReport, sheetsToCsv, type ReportPeriod } from '../services/report';
import { resyncAll, syncCardComments, syncCardCommentsForPost } from '../services/basecampSync';
import { logAudit } from '../services/audit';

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
basecampRoutes.use('/report/*', requireAuth);
basecampRoutes.use('/resync', requireAuth);
basecampRoutes.use('/sync-comments', requireAuth);

basecampRoutes.get('/status', async (c) => {
  const configured = await isConfigured(c.env);
  const project = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'basecamp_project_id'").first<{ value: string }>();
  const mgmt = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'basecamp_mgmt_project_id'").first<{ value: string }>();
  return c.json({ configured, project_set: !!project?.value, mgmt_set: !!mgmt?.value });
});

// تنزيل التقرير (أسبوعي/شهري) بصيغة Excel أو CSV (لمعاينته) — للمدير العام
// ?period=week|month&format=xlsx|csv
basecampRoutes.get('/report/download', requirePermission('settings.manage'), async (c) => {
  const period: ReportPeriod = c.req.query('period') === 'month' ? 'month' : 'week';
  const format = c.req.query('format') === 'csv' ? 'csv' : 'xlsx';
  const { bytes, filename, sheets } = await buildReportWorkbook(c.env, period);

  if (format === 'csv') {
    const csv = sheetsToCsv(sheets);
    return new Response(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename.replace(/\.xlsx$/, '.csv'))}`,
      },
    });
  }
  return new Response(bytes, {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
});

// توليد ورفع التقرير فوراً إلى بيسكامب (أسبوعي أو شهري) — للمدير العام
basecampRoutes.post('/report/run', requirePermission('settings.manage'), async (c) => {
  const period: ReportPeriod = c.req.query('period') === 'month' ? 'month' : 'week';
  try {
    const r = period === 'month' ? await uploadMonthlyReport(c.env) : await uploadWeeklyReport(c.env);
    const actor = c.get('user');
    c.executionCtx.waitUntil(logAudit(c.env, { id: actor.id, name: actor.name }, 'report_run', 'report', undefined, period));
    return c.json(r);
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, 502);
  }
});

// إعادة مزامنة كل المحتوى مع بطاقات بيسكامب — للمدير العام (تنظّف الربط القديم وتعيد الإنشاء كبطاقات)
basecampRoutes.post('/resync', requirePermission('settings.manage'), async (c) => {
  if (!(await isConfigured(c.env))) return c.json({ error: 'لم يُضبط تكامل بيسكامب بعد' }, 400);
  const cnt = (await c.env.DB.prepare("SELECT COUNT(*) c FROM content_posts WHERE status != 'archived'").first<{ c: number }>())?.c || 0;
  c.executionCtx.waitUntil(resyncAll(c.env));
  const actor = c.get('user');
  c.executionCtx.waitUntil(logAudit(c.env, { id: actor.id, name: actor.name }, 'basecamp_resync', 'basecamp', undefined, `${cnt} منشور`));
  return c.json({ ok: true, queued: cnt });
});

// مزامنة يدوية فورية لتعليقات بيسكامب — لمنشور محدّد (post_id) أو للكل عند غيابه
basecampRoutes.post('/sync-comments', async (c) => {
  if (!(await isConfigured(c.env))) return c.json({ error: 'لم يُضبط تكامل بيسكامب بعد' }, 400);
  const body = await c.req.json<{ post_id?: string }>().catch(() => ({} as { post_id?: string }));
  try {
    if (body.post_id) {
      const count = await syncCardCommentsForPost(c.env, body.post_id);
      return c.json({ ok: true, count });
    }
    await syncCardComments(c.env);
    return c.json({ ok: true });
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, 502);
  }
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
