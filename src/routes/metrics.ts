import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth, requirePermission } from '../middleware';
import { parsePeriod, periodOf, previousPeriod, isPeriodKind, type Period } from '../services/period';
import { computeAuto, listDefinitions, markReviewed, readBoard, readLayer, readSeries, readSeriesBulk, recordManual } from '../services/metrics';
import { syncAllSources } from '../services/metricSync';
import { syncCrm } from '../services/crmSync';
import { newId } from '../util';
import { logAudit } from '../services/audit';

export const metricsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

metricsRoutes.use('*', requireAuth);
metricsRoutes.use('*', requirePermission('analytics.view'));

/** الفترة المطلوبة، أو الحالية من نوعها حين لا تُذكر بدايتها. */
function resolvePeriod(c: { req: { query: (k: string) => string | undefined } }): Period {
  const kind = c.req.query('period');
  const start = c.req.query('start');
  if (start) {
    const p = parsePeriod(kind ?? 'monthly', start);
    if (p) return p;
  }
  return periodOf(isPeriodKind(kind) ? kind : 'monthly');
}

// دليل المؤشرات — التعريفات كاملةً بلا قيم. يقرأه من يريد أن يعرف ما يُقاس.
metricsRoutes.get('/definitions', async (c) => {
  return c.json({ definitions: await listDefinitions(c.env, c.req.query('layer') || undefined) });
});

// اللوحة المختصرة — عشرة أرقام بترتيبها المسجَّل
metricsRoutes.get('/board', async (c) => {
  const p = resolvePeriod(c);
  return c.json({ period: p, previous: previousPeriod(p), metrics: await readBoard(c.env, p) });
});

// طبقةٌ واحدة أو كلها
metricsRoutes.get('/layer', async (c) => {
  const p = resolvePeriod(c);
  const layer = c.req.query('layer') || undefined;
  return c.json({ period: p, previous: previousPeriod(p), metrics: await readLayer(c.env, p, layer) });
});

/* سلاسل عدّة مؤشرات دفعةً — خطّ الاتجاه في بطاقات اللوحة والطبقة.
   نداءٌ واحد لا واحدٌ لكل بطاقة: اللوحة عشرٌ والطبقة تبلغ أربعاً وعشرين. */
metricsRoutes.get('/series', async (c) => {
  const kind = c.req.query('period');
  const limit = Math.min(Math.max(Number(c.req.query('limit') || 12), 2), 52);
  const keys = (c.req.query('keys') || '').split(',').map((k) => k.trim()).filter(Boolean);
  return c.json({
    series: await readSeriesBulk(c.env, keys, isPeriodKind(kind) ? kind : 'monthly', limit),
  });
});

// سلسلة مؤشر واحد — يقرؤها من يريد مؤشراً بعينه
metricsRoutes.get('/series/:key', async (c) => {
  const kind = c.req.query('period');
  const limit = Math.min(Math.max(Number(c.req.query('limit') || 12), 2), 52);
  return c.json({
    series: await readSeries(c.env, c.req.param('key'), isPeriodKind(kind) ? kind : 'monthly', limit),
  });
});

/* ═══ ما يلي يُغيّر أرقاماً، فيتطلّب `metrics.manage` ═══
   قيمةٌ تُسجَّل باليد تدخل اللوحة كما يدخلها الرقم المسحوب، ومن يملك
   تسجيلها يملك تحريك مؤشر قيادي. */

/* حُذف `‎/compute`: احتسابٌ بلا سحبٍ قبله يعيد كتابة الأرقام نفسها،
   و«سحب الآن» في الشاشة يسحب ثم يحتسب في نداءٍ واحد — وهو `‎/sync`
   أدناه. و`computeAuto` نفسها باقيةٌ يستدعيها الكرون ومسارُ السحب. */

// سحب كل المصادر المربوطة ثم إعادة الاحتساب — «سحب الآن» في الشاشة
metricsRoutes.post('/sync', requirePermission('metrics.manage'), async (c) => {
  const p = resolvePeriod(c);
  const sources = await syncAllSources(c.env, p);

  // مرآة إدارة الشركة مسارٌ مستقلّ — تُنسخ صفوفاً لا نقاطَ مؤشرات
  let crm: { ok: boolean; error?: string; leads?: number } = { ok: false };
  const crmRow = await c.env.DB.prepare("SELECT is_enabled FROM integrations WHERE key = 'crm'").first<{ is_enabled: number }>();
  if (crmRow?.is_enabled) {
    try {
      const r = await syncCrm(c.env);
      crm = { ok: true, leads: r.leads };
    } catch (e) {
      crm = { ok: false, error: String((e as Error)?.message || e) };
    }
  }

  // الاحتساب بعد السحب: مؤشرات مشتقّة تقرأ ما وصل للتوّ
  const computed = await computeAuto(c.env, p);
  await logAudit(c.env, c.get('user'), 'metrics_sync', 'metric', p.start, `${p.kind}`);
  return c.json({ ok: true, period: p, sources, crm, computed: computed.written });
});

// تسجيل قيمة باليد
metricsRoutes.post('/values', requirePermission('metrics.manage'), async (c) => {
  const body = await c.req.json<{
    metric_key?: string; period?: string; start?: string; dim_value?: string; value?: number; note?: string;
  }>();

  const p = parsePeriod(body.period ?? 'monthly', body.start);
  if (!p) return c.json({ error: 'الفترة غير صالحة. اختر نوعها وبدايتها.' }, 400);
  if (!body.metric_key) return c.json({ error: 'اختر المؤشر.' }, 400);

  const value = Number(body.value);
  if (!Number.isFinite(value)) return c.json({ error: 'القيمة يجب أن تكون رقماً.' }, 400);

  try {
    await recordManual(c.env, p, {
      metricKey: body.metric_key,
      dimValue: body.dim_value,
      value,
      note: body.note ?? null,
    }, c.get('user').id);
  } catch (e) {
    return c.json({ error: String((e as Error)?.message || e) }, 400);
  }

  await logAudit(c.env, c.get('user'), 'metric_value_set', 'metric', body.metric_key, String(value));
  return c.json({ ok: true });
});

/* المرجعية والقرار — الرقم بلا مرجعية لا يعني شيئاً، والمرجعية ثلاث:
   مقارنةٌ زمنية تُحسب، ومستهدفٌ يُسجَّل هنا، ومعيارٌ قطاعي يُسجَّل معه.
   والقرار المحتمل حقلٌ رابع: لا تقس ما لا تنوي التصرف بناءً عليه. */
metricsRoutes.put('/definitions/:key/target', requirePermission('metrics.manage'), async (c) => {
  const key = c.req.param('key');
  const body = await c.req.json<{
    target_value?: number | null; target_direction?: string;
    target_min?: number | null; target_max?: number | null;
    benchmark_value?: number | null; benchmark_note?: string | null; decision?: string | null;
  }>();

  const direction = body.target_direction;
  if (direction && !['higher_better', 'lower_better', 'range'].includes(direction)) {
    return c.json({ error: 'اتجاه المستهدف غير معروف.' }, 400);
  }

  const result = await c.env.DB.prepare(
    `UPDATE metric_definitions SET
       target_value = ?, target_min = ?, target_max = ?,
       target_direction = COALESCE(?, target_direction),
       benchmark_value = ?, benchmark_note = ?, decision = ?
     WHERE key = ?`,
  )
    .bind(
      body.target_value ?? null,
      body.target_min ?? null,
      body.target_max ?? null,
      direction ?? null,
      body.benchmark_value ?? null,
      body.benchmark_note ?? null,
      body.decision ?? null,
      key,
    )
    .run();

  if (!result.meta?.changes) return c.json({ error: 'مؤشر غير مسجَّل.' }, 404);
  await logAudit(c.env, c.get('user'), 'metric_target_set', 'metric', key, String(body.target_value ?? '—'));
  return c.json({ ok: true });
});

// تسجيل أن المؤشر رُوجع — فيسقط وسم الاستحقاق حتى تمرّ دوريته
metricsRoutes.post('/definitions/:key/reviewed', requirePermission('metrics.manage'), async (c) => {
  const key = c.req.param('key');
  if (!(await markReviewed(c.env, key))) return c.json({ error: 'مؤشر غير مسجَّل.' }, 404);
  await logAudit(c.env, c.get('user'), 'metric_reviewed', 'metric', key);
  return c.json({ ok: true });
});

/* ═══ الإنفاق الإعلاني ═══
   تقف عليه الطبقة الخامسة كلها، ويصل من تكامل إعلاني أو يُدخَل. */

metricsRoutes.get('/spend', async (c) => {
  const p = resolvePeriod(c);
  const { results } = await c.env.DB.prepare(
    `SELECT s.*, u.name AS entered_by_name FROM ad_spend s
     LEFT JOIN users u ON u.id = s.entered_by
     WHERE s.period_start >= ? AND s.period_start <= ?
     ORDER BY s.platform`,
  )
    .bind(p.start, p.end)
    .all();
  return c.json({ period: p, spend: results });
});

metricsRoutes.post('/spend', requirePermission('metrics.manage'), async (c) => {
  const body = await c.req.json<{
    period?: string; start?: string; platform?: string; campaign_id?: string;
    amount?: number; impressions?: number; clicks?: number; conversions?: number;
  }>();

  const p = parsePeriod(body.period ?? 'monthly', body.start);
  if (!p) return c.json({ error: 'الفترة غير صالحة. اختر نوعها وبدايتها.' }, 400);
  if (!body.platform) return c.json({ error: 'اختر المنصة.' }, 400);

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount < 0) return c.json({ error: 'المبلغ يجب أن يكون رقماً موجباً.' }, 400);

  await c.env.DB.prepare(
    `INSERT INTO ad_spend (id, period_start, period_end, platform, campaign_id, amount, impressions, clicks, conversions, source, entered_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?)
     ON CONFLICT(period_start, platform, campaign_id) DO UPDATE SET
       period_end = excluded.period_end, amount = excluded.amount, impressions = excluded.impressions,
       clicks = excluded.clicks, conversions = excluded.conversions, source = 'manual',
       entered_by = excluded.entered_by, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')`,
  )
    .bind(
      newId('sp'), p.start, p.end, body.platform, body.campaign_id ?? '', amount,
      Math.max(Number(body.impressions) || 0, 0), Math.max(Number(body.clicks) || 0, 0),
      Math.max(Number(body.conversions) || 0, 0), c.get('user').id,
    )
    .run();

  await logAudit(c.env, c.get('user'), 'ad_spend_set', 'metric', body.platform, String(amount));
  return c.json({ ok: true });
});
