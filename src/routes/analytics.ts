import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth, requirePermission } from '../middleware';
import { pullAnalytics } from '../services/analytics';
import { listStaleContent } from '../services/alerts';

export const analyticsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

analyticsRoutes.use('*', requireAuth);
analyticsRoutes.use('*', requirePermission('analytics.view'));

// الداشبورد الموحّد — مؤشرات مجمّعة مع فلاتر: from, to, platform, campaign_id
analyticsRoutes.get('/dashboard', async (c) => {
  const from = c.req.query('from');
  const to = c.req.query('to');
  const platform = c.req.query('platform');
  const campaign = c.req.query('campaign_id');

  const where: string[] = [];
  const binds: unknown[] = [];
  if (from) (where.push('a.captured_at >= ?'), binds.push(from));
  if (to) (where.push('a.captured_at <= ?'), binds.push(to));
  if (platform) (where.push('a.platform = ?'), binds.push(platform));
  if (campaign) {
    where.push('a.post_id IN (SELECT id FROM content_posts WHERE campaign_id = ?)');
    binds.push(campaign);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // لقطة أحدث قيمة لكل (منشور، منصة) لتفادي الازدواج عند التجميع
  const base = `
    WITH latest AS (
      SELECT a.* FROM analytics_snapshots a
      JOIN (
        SELECT post_id, platform, MAX(captured_at) AS mx
        FROM analytics_snapshots a ${clause}
        GROUP BY post_id, platform
      ) m ON m.post_id = a.post_id AND m.platform = a.platform AND m.mx = a.captured_at
    )`;

  const totals = await c.env.DB.prepare(
    `${base}
     SELECT COALESCE(SUM(reach),0) AS reach, COALESCE(SUM(impressions),0) AS impressions,
            COALESCE(SUM(engagement),0) AS engagement, COALESCE(MAX(followers),0) AS followers
     FROM latest`,
  )
    .bind(...binds)
    .first();

  const byPlatform = await c.env.DB.prepare(
    `${base}
     SELECT platform, SUM(reach) AS reach, SUM(impressions) AS impressions, SUM(engagement) AS engagement
     FROM latest GROUP BY platform ORDER BY impressions DESC`,
  )
    .bind(...binds)
    .all();

  const topPosts = await c.env.DB.prepare(
    `${base}
     SELECT l.post_id, p.title, SUM(l.engagement) AS engagement, SUM(l.impressions) AS impressions
     FROM latest l JOIN content_posts p ON p.id = l.post_id
     GROUP BY l.post_id ORDER BY engagement DESC LIMIT 10`,
  )
    .bind(...binds)
    .all();

  // حالة خط الإنتاج (عدد المسودات في كل مرحلة) — لا يتأثر بالفلاتر الزمنية
  const pipeline = await c.env.DB.prepare(
    'SELECT status, COUNT(*) AS count FROM content_posts GROUP BY status',
  ).all();

  // أداء الحملات
  const campaigns = await c.env.DB.prepare(
    `${base}
     SELECT cm.id, cm.name, SUM(l.impressions) AS impressions, SUM(l.engagement) AS engagement
     FROM latest l JOIN content_posts p ON p.id = l.post_id
     JOIN campaigns cm ON cm.id = p.campaign_id
     GROUP BY cm.id ORDER BY impressions DESC`,
  )
    .bind(...binds)
    .all();

  const engRate =
    totals && (totals as any).impressions > 0
      ? Math.round((((totals as any).engagement / (totals as any).impressions) * 100 + Number.EPSILON) * 100) / 100
      : 0;

  return c.json({
    totals: { ...totals, engagement_rate: engRate },
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
  const captured = await pullAnalytics(c.env);
  return c.json({ ok: true, captured });
});
