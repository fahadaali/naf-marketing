import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth, requirePermission } from '../middleware';
import { pullAnalytics } from '../services/analytics';
import { listStaleContent } from '../services/alerts';

export const analyticsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

analyticsRoutes.use('*', requireAuth);
analyticsRoutes.use('*', requirePermission('analytics.view'));

// الداشبورد الموحّد — مؤشرات مجمّعة مع فلاتر: from, to, platform, campaign_id, source
// source=platform يقصر النتائج على ما نُشر عبر المنصة فقط (بقيّتها منشورات Buffer الأخرى).
analyticsRoutes.get('/dashboard', async (c) => {
  const from = c.req.query('from');
  const to = c.req.query('to');
  const platform = c.req.query('platform');
  const campaign = c.req.query('campaign_id');
  const source = c.req.query('source');

  const where: string[] = [];
  const binds: unknown[] = [];
  if (from) (where.push('a.sent_at >= ?'), binds.push(from));
  if (to) (where.push('a.sent_at <= ?'), binds.push(to));
  if (platform) (where.push('a.platform = ?'), binds.push(platform));
  if (campaign) {
    where.push('a.post_id IN (SELECT id FROM content_posts WHERE campaign_id = ?)');
    binds.push(campaign);
  }
  if (source === 'platform') where.push('a.via_platform = 1');
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // نموذج upsert: سطر واحد حديث لكل منشور — لا حاجة لاختيار «الأحدث»
  const totals = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(reach),0) AS reach, COALESCE(SUM(impressions),0) AS impressions,
            COALESCE(SUM(engagement),0) AS engagement
     FROM analytics_snapshots a ${clause}`,
  )
    .bind(...binds)
    .first();

  const byPlatform = await c.env.DB.prepare(
    `SELECT platform, SUM(reach) AS reach, SUM(impressions) AS impressions, SUM(engagement) AS engagement
     FROM analytics_snapshots a ${clause} GROUP BY platform ORDER BY impressions DESC`,
  )
    .bind(...binds)
    .all();

  const topPosts = await c.env.DB.prepare(
    `SELECT a.post_id, COALESCE(a.title, '—') AS title, a.engagement, a.impressions, a.via_platform
     FROM analytics_snapshots a ${clause} ORDER BY a.engagement DESC LIMIT 10`,
  )
    .bind(...binds)
    .all();

  // حالة خط الإنتاج (عدد المسودات في كل مرحلة) — لا يتأثر بالفلاتر
  const pipeline = await c.env.DB.prepare(
    'SELECT status, COUNT(*) AS count FROM content_posts GROUP BY status',
  ).all();

  // أداء الحملات — للمنشورات المرتبطة بمحتوى المنصة فقط (لها post_id)
  const campaigns = await c.env.DB.prepare(
    `SELECT cm.id, cm.name, SUM(a.impressions) AS impressions, SUM(a.engagement) AS engagement
     FROM analytics_snapshots a JOIN content_posts p ON p.id = a.post_id
     JOIN campaigns cm ON cm.id = p.campaign_id
     ${clause} GROUP BY cm.id ORDER BY impressions DESC`,
  )
    .bind(...binds)
    .all();

  const t = (totals || {}) as any;
  const engRate = t.impressions > 0
    ? Math.round(((t.engagement / t.impressions) * 100 + Number.EPSILON) * 100) / 100
    : 0;

  // تجميع ديناميكي لكل أنواع المقاييس: المتشابهة تُجمع (count) أو تُمتوسّط (percentage)
  const metricRows = await c.env.DB.prepare(
    `SELECT metrics_json FROM analytics_snapshots a ${clause}`,
  )
    .bind(...binds)
    .all<{ metrics_json: string | null }>();
  const agg = new Map<string, { type: string; name: string; unit: string; sum: number; count: number }>();
  for (const r of metricRows.results) {
    let arr: any[] = [];
    try { arr = r.metrics_json ? JSON.parse(r.metrics_json) : []; } catch { arr = []; }
    for (const m of arr) {
      const key = String(m.type || m.name || '').toLowerCase();
      if (!key) continue;
      const e = agg.get(key) || { type: String(m.type || key), name: String(m.name || key), unit: String(m.unit || 'count'), sum: 0, count: 0 };
      e.sum += Number(m.value || 0);
      e.count += 1;
      agg.set(key, e);
    }
  }
  const metrics = Array.from(agg.values()).map((e) => ({
    type: e.type,
    name: e.name,
    unit: e.unit,
    value: e.unit === 'percentage'
      ? Math.round((e.sum / Math.max(e.count, 1)) * 100) / 100 // نسبة → متوسط
      : e.sum, // عدد → مجموع
  }));

  return c.json({
    totals: { ...t, engagement_rate: engRate },
    metrics,
    byPlatform: byPlatform.results,
    topPosts: topPosts.results,
    pipeline: pipeline.results,
    campaigns: campaigns.results,
  });
});

// لوحة أداء الفريق: إنتاجية الكتّاب وسرعة اعتماد المراجعين/المديرين
analyticsRoutes.get('/performance', async (c) => {
  const writers = await c.env.DB.prepare(
    `SELECT u.id, u.name,
            COUNT(p.id) AS created_count,
            SUM(CASE WHEN p.status = 'published' THEN 1 ELSE 0 END) AS published_count,
            SUM(CASE WHEN p.status = 'rejected' THEN 1 ELSE 0 END) AS rejected_count
     FROM users u
     LEFT JOIN content_posts p ON p.author_id = u.id
     GROUP BY u.id
     HAVING created_count > 0
     ORDER BY created_count DESC`,
  ).all();

  // سرعة الاعتماد لكل مراجع: متوسط الفترة بالساعات بين إجراء الاعتماد والإجراء السابق عليه لنفس المنشور
  // (أو تاريخ إنشاء المنشور إن كان أول إجراء)
  const approvers = await c.env.DB.prepare(
    `WITH ranked AS (
       SELECT a.id, a.post_id, a.actor_id, a.to_status, a.created_at,
              (SELECT MAX(a2.created_at) FROM approvals a2
               WHERE a2.post_id = a.post_id AND a2.created_at < a.created_at) AS prev_at,
              p.created_at AS post_created_at
       FROM approvals a
       JOIN content_posts p ON p.id = a.post_id
     )
     SELECT u.id, u.name,
            COUNT(r.id) AS actions_count,
            ROUND(AVG((julianday(r.created_at) - julianday(COALESCE(r.prev_at, r.post_created_at))) * 24), 2) AS avg_hours
     FROM ranked r
     JOIN users u ON u.id = r.actor_id
     GROUP BY u.id
     ORDER BY actions_count DESC`,
  ).all();

  return c.json({ writers: writers.results, approvers: approvers.results });
});

// المحتوى المتأخر في مراحل المراجعة/الاعتماد الحالية
analyticsRoutes.get('/alerts', async (c) => {
  const stale = await listStaleContent(c.env);
  return c.json({ stale });
});

// سحب فوري (إضافةً إلى Cron)
analyticsRoutes.post('/refresh', async (c) => {
  try {
    const captured = await pullAnalytics(c.env);
    return c.json({ ok: true, captured });
  } catch (e: any) {
    return c.json({ error: `فشل سحب التحليلات: ${String(e?.message || e)}` }, 502);
  }
});
