import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth, requirePermission } from '../middleware';
import { SOURCES, SOURCE_CONTRACT } from '../adapters/sources';
import { syncSource } from '../services/metricSync';
import { applyCrmSnapshot, syncCrm } from '../services/crmSync';
import { parseCrmExport, crmKey } from '../adapters/crm';
import { periodOf, parsePeriod, isPeriodKind } from '../services/period';
import { computeAuto } from '../services/metrics';
import { logAudit } from '../services/audit';

export const integrationRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

integrationRoutes.use('*', requireAuth);

/* القراءة لمن يقرأ التحليلات، والكتابة والربط للمدير العام وحده: `config_json`
   يحمل معرّفات حسابات وعناوين مصادر، وتبديلُها يغيّر من أين تأتي كل الأرقام. */
integrationRoutes.use('*', requirePermission('analytics.view'));

/** أيّ الأسرار مضبوط — تُعرض الحالة ولا تُعرض القيمة أبداً. */
function secretPresent(env: Env, name: string): boolean {
  const raw = (env as unknown as Record<string, string | undefined>)[name];
  return typeof raw === 'string' && raw.trim() !== '';
}

integrationRoutes.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT key, is_enabled, config_json, last_sync_at, last_sync_status, last_error, last_ok_at
     FROM integrations ORDER BY key`,
  ).all<{
    key: string; is_enabled: number; config_json: string; last_sync_at: string | null;
    last_sync_status: string; last_error: string | null; last_ok_at: string | null;
  }>();

  const integrations = results.map((row) => {
    const source = SOURCES[row.key];
    // منصة إدارة الشركة ليست في `SOURCES`: مسارُها نسخُ صفوفٍ لا سحبُ نقاط.
    const isCrm = row.key === 'crm';
    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(row.config_json || '{}');
    } catch {
      config = {};
    }
    const secretName = isCrm ? 'CRM_API_KEY' : source?.secretName;
    return {
      key: row.key,
      is_enabled: row.is_enabled === 1,
      config,
      fields: isCrm
        ? [
            { key: 'base_url', label: 'عنوان منصة إدارة الشركة', placeholder: 'https://crm.naflaw.sa' },
            { key: 'mode', label: 'وضع السحب', placeholder: 'bearer' },
          ]
        : (source?.fields ?? []),
      secret_name: secretName ?? null,
      secret_ready: secretName ? secretPresent(c.env, secretName) : false,
      last_sync_at: row.last_sync_at,
      last_sync_status: row.last_sync_status,
      last_error: row.last_error,
      last_ok_at: row.last_ok_at,
    };
  });

  return c.json({ integrations, contract: SOURCE_CONTRACT });
});

integrationRoutes.put('/:key', requirePermission('integrations.manage'), async (c) => {
  const key = c.req.param('key');
  const body = await c.req.json<{ is_enabled?: boolean; config?: Record<string, unknown> }>();

  const exists = await c.env.DB.prepare('SELECT key FROM integrations WHERE key = ?').bind(key).first();
  if (!exists) return c.json({ error: 'مصدر غير مسجَّل.' }, 404);

  const sets: string[] = [];
  const binds: unknown[] = [];
  if (typeof body.is_enabled === 'boolean') {
    sets.push('is_enabled = ?');
    binds.push(body.is_enabled ? 1 : 0);
  }
  if (body.config && typeof body.config === 'object') {
    /* لا يُقبل مفتاحٌ يشبه السرّ في الإعداد غير السرّي: من يلصق مفتاحاً هنا
       يخزّنه في قاعدة تُقرأ من الواجهة، ويظنّه محفوظاً كما تُحفظ الأسرار. */
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body.config)) {
      if (/key|secret|token|password/i.test(k)) continue;
      clean[k] = typeof v === 'string' ? v.trim() : v;
    }
    sets.push('config_json = ?');
    binds.push(JSON.stringify(clean));
  }
  if (!sets.length) return c.json({ error: 'لا تغيير في الطلب.' }, 400);

  sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')");
  binds.push(key);
  await c.env.DB.prepare(`UPDATE integrations SET ${sets.join(', ')} WHERE key = ?`).bind(...binds).run();

  await logAudit(c.env, c.get('user'), 'integration_update', 'integration', key, body.is_enabled === undefined ? 'إعداد' : (body.is_enabled ? 'ربط' : 'فصل'));
  return c.json({ ok: true });
});

/** سحبُ مصدرٍ بعينه الآن. */
integrationRoutes.post('/:key/sync', requirePermission('metrics.manage'), async (c) => {
  const key = c.req.param('key');
  const kind = c.req.query('period');
  const start = c.req.query('start');
  const p = (start && parsePeriod(kind ?? 'monthly', start)) || periodOf(isPeriodKind(kind) ? kind : 'monthly');

  try {
    if (key === 'crm') {
      const result = await syncCrm(c.env);
      await computeAuto(c.env, p);
      await logAudit(c.env, c.get('user'), 'integration_sync', 'integration', key, `${result.leads}`);
      return c.json({ ok: true, crm: result });
    }
    const points = await syncSource(c.env, key, p);
    await computeAuto(c.env, p);
    await logAudit(c.env, c.get('user'), 'integration_sync', 'integration', key, `${points}`);
    return c.json({ ok: true, points });
  } catch (e) {
    // ٥٠٢ لا ٥٠٠: العطل عند المصدر لا عندنا، والرسالة تحمل سببه كما ورد
    return c.json({ error: String((e as Error)?.message || e) }, 502);
  }
});

/**
 * رفع ملفّ تصدير منصة إدارة الشركة — الوضع `import`.
 *
 * وهو المسار الذي يعمل اليوم بلا تغيير في أي مستودع: تلك المنصة تحرس كل
 * مسارٍ بجلسة متصفّح، ولا مدخلَ لمفتاح خدمةٍ فيها بعد. فمن أراد الأرقام
 * الآن ينزّل `‎/api/export` من هناك ويرفعه هنا.
 */
integrationRoutes.post('/crm/import', requirePermission('metrics.manage'), async (c) => {
  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ error: 'الملف ليس JSON صالحاً. ارفع ملف التصدير كما نزّلته.' }, 400);
  }

  try {
    const snapshot = parseCrmExport(payload);
    const result = await applyCrmSnapshot(c.env, snapshot);
    // نحتسب الشهر والأسبوع الجاريين فوراً كي يرى الرافع أثر ما رفعه
    await computeAuto(c.env, periodOf('monthly'));
    await computeAuto(c.env, periodOf('weekly'));
    await logAudit(c.env, c.get('user'), 'crm_import', 'integration', 'crm', `${result.leads}`);
    return c.json({ ok: true, ...result });
  } catch (e) {
    return c.json({ error: String((e as Error)?.message || e) }, 400);
  }
});

/** فحص جاهزية منصة إدارة الشركة — قبل تشغيل السحب الدوري عليها. */
integrationRoutes.get('/crm/check', requirePermission('integrations.manage'), async (c) => {
  const row = await c.env.DB.prepare("SELECT config_json FROM integrations WHERE key = 'crm'").first<{ config_json: string }>();
  let cfg: Record<string, unknown> = {};
  try {
    cfg = JSON.parse(row?.config_json || '{}');
  } catch {
    cfg = {};
  }
  return c.json({
    base_url: String(cfg.base_url ?? ''),
    mode: cfg.mode === 'import' ? 'import' : 'bearer',
    secret_ready: crmKey(c.env) !== '',
  });
});
