import { Hono } from 'hono';
import type { Env, Variables, CampaignStatus } from '../types';
import { CAMPAIGN_TRANSITIONS } from '../types';
import { requireAuth, requirePermission } from '../middleware';
import { newId, nowIso } from '../util';
import { logAudit } from '../services/audit';

export const campaignRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

campaignRoutes.use('*', requireAuth);

/* الحقول التي يقبلها الإنشاء والتعديل. `status` مفصولٌ عنها لأنه يمرّ
   بحارس الانتقالات، و`target_platforms` لأنه يُخزَّن JSON. */
const TEXT_FIELDS = ['name', 'objective', 'start_date', 'end_date', 'owner_id'] as const;
const NUMBER_FIELDS = ['budget', 'target_impressions', 'target_engagement', 'target_leads'] as const;

/** رقمٌ أو فراغ. الفراغ لا يصير صفراً: «بلا مستهدف» غير «مستهدفٌ صفر». */
function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// ═══ القائمة ═══
// التقدّم والأداء يأتيان مع الصف: صفحةٌ تعرض عشرين حملة لا تنادي عشرين
// نقطة كي تعرف كم نُشر من كلٍّ.
campaignRoutes.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT cm.*, u.name AS owner_name,
            (SELECT COUNT(*) FROM content_posts p WHERE p.campaign_id = cm.id) AS posts_count,
            (SELECT COUNT(*) FROM content_posts p
               WHERE p.campaign_id = cm.id AND p.status = 'published') AS published_count,
            (SELECT COALESCE(SUM(a.impressions), 0) FROM analytics_snapshots a
               JOIN content_posts p ON p.id = a.post_id
               WHERE p.campaign_id = cm.id) AS impressions,
            (SELECT COALESCE(SUM(a.engagement), 0) FROM analytics_snapshots a
               JOIN content_posts p ON p.id = a.post_id
               WHERE p.campaign_id = cm.id) AS engagement
     FROM campaigns cm
     LEFT JOIN users u ON u.id = cm.owner_id
     ORDER BY cm.created_at DESC`,
  ).all();
  return c.json({ campaigns: results });
});

// ═══ قائمة من يصلح مسؤولاً ═══
// مسجّلةٌ قبل `/:id` وإلا ابتلعها المسار المتغيّر فصار `meta` معرّفَ حملة.
// ولا تُستعمل `GET /users`: تلك تتطلّب `users.manage` ولا يملكها مديرُ
// التسويق، وهو من يدير الحملات — فتردّ ٤٠٣ على الدور المقصود بالضبط.
campaignRoutes.get('/meta/owners', requirePermission('content.schedule'), async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, name FROM users WHERE is_active = 1 ORDER BY name',
  ).all();
  return c.json({ owners: results });
});

// ═══ حملة واحدة ═══
campaignRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const campaign = await c.env.DB.prepare('SELECT * FROM campaigns WHERE id = ?').bind(id).first();
  if (!campaign) return c.json({ error: 'غير موجودة' }, 404);

  /* `pending_at` هو ما يحتاجه `displayStatus` في الواجهة كي تظهر حالة
     «متأخر». وكان هذا الاستعلام يختار أربعة أعمدة فقط، فحالةٌ مسجّلةٌ في
     السجلّ لم تكن تظهر في لوحة الحملة أبداً — والعلّة هنا لا في الواجهة.
     والاستعلام الفرعي نفسه في routes/posts.ts. */
  const posts = await c.env.DB.prepare(
    `SELECT p.*, u.name AS author_name,
            (SELECT MIN(s.scheduled_at) FROM schedules s
               WHERE s.post_id = p.id AND s.status IN ('pending','failed')) AS pending_at
     FROM content_posts p
     LEFT JOIN users u ON u.id = p.author_id
     WHERE p.campaign_id = ? ORDER BY p.updated_at DESC`,
  )
    .bind(id)
    .all();

  const owner = campaign.owner_id
    ? await c.env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(campaign.owner_id).first<{ name: string }>()
    : null;

  return c.json({
    campaign: { ...campaign, owner_name: owner?.name ?? null },
    posts: posts.results,
    // الخادم هو الحكم على ما يجوز، والواجهة ترسم ما يُرجعه — لا جدولَ ثانٍ يفترق عنه.
    allowed_transitions: CAMPAIGN_TRANSITIONS[campaign.status as CampaignStatus] ?? [],
  });
});

// ═══ أداء الحملة ═══
// كل استعلامٍ هنا جذرُه `content_posts` والانضمام إلى اللقطات LEFT: حملةٌ
// بلا لقطاتٍ تُرجع أصفاراً ولا تختفي. والاستعلام في routes/analytics.ts
// انضمامٌ داخلي، فكل حملةٍ لم تُسحب لها تحليلاتٌ بعد تسقط من التقرير كأنها
// لا وجود لها — وحملةٌ أُنشئت اليوم حالتُها الطبيعية أن تكون كذلك.
campaignRoutes.get('/:id/rollup', requirePermission('analytics.view'), async (c) => {
  const id = c.req.param('id');
  const campaign = await c.env.DB.prepare(
    'SELECT target_impressions, target_engagement, target_leads FROM campaigns WHERE id = ?',
  )
    .bind(id)
    .first();
  if (!campaign) return c.json({ error: 'غير موجودة' }, 404);

  const totals = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(a.reach), 0) AS reach,
            COALESCE(SUM(a.impressions), 0) AS impressions,
            COALESCE(SUM(a.engagement), 0) AS engagement
     FROM content_posts p LEFT JOIN analytics_snapshots a ON a.post_id = p.id
     WHERE p.campaign_id = ?`,
  )
    .bind(id)
    .first<{ reach: number; impressions: number; engagement: number }>();

  const byPlatform = await c.env.DB.prepare(
    `SELECT a.platform,
            COALESCE(SUM(a.reach), 0) AS reach,
            COALESCE(SUM(a.impressions), 0) AS impressions,
            COALESCE(SUM(a.engagement), 0) AS engagement
     FROM content_posts p JOIN analytics_snapshots a ON a.post_id = p.id
     WHERE p.campaign_id = ? AND a.platform IS NOT NULL
     GROUP BY a.platform ORDER BY impressions DESC`,
  )
    .bind(id)
    .all();

  const topPosts = await c.env.DB.prepare(
    `SELECT a.post_id, COALESCE(a.title, p.title, '—') AS title, a.platform,
            a.external_url, a.engagement, a.impressions
     FROM content_posts p JOIN analytics_snapshots a ON a.post_id = p.id
     WHERE p.campaign_id = ? ORDER BY a.engagement DESC LIMIT 5`,
  )
    .bind(id)
    .all();

  // خط الإنتاج — كل الحالات كما هي في القاعدة، لا قائمةً مكتوبةً باليد.
  const pipeline = await c.env.DB.prepare(
    'SELECT status, COUNT(*) AS count FROM content_posts WHERE campaign_id = ? GROUP BY status',
  )
    .bind(id)
    .all();

  const schedule = await c.env.DB.prepare(
    `SELECT s.status, COUNT(*) AS count
     FROM schedules s JOIN content_posts p ON p.id = s.post_id
     WHERE p.campaign_id = ? GROUP BY s.status`,
  )
    .bind(id)
    .all();

  const late = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count FROM schedules s JOIN content_posts p ON p.id = s.post_id
     WHERE p.campaign_id = ? AND s.status = 'pending' AND s.scheduled_at < ?`,
  )
    .bind(id, nowIso())
    .first<{ count: number }>();

  const t = totals || { reach: 0, impressions: 0, engagement: 0 };
  const engagementRate = t.impressions > 0
    ? Math.round(((t.engagement / t.impressions) * 100 + Number.EPSILON) * 100) / 100
    : 0;

  return c.json({
    totals: { ...t, engagement_rate: engagementRate },
    byPlatform: byPlatform.results,
    topPosts: topPosts.results,
    pipeline: pipeline.results,
    schedule: schedule.results,
    late: late?.count ?? 0,
    targets: campaign,
  });
});

// ═══ الإنشاء ═══
campaignRoutes.post('/', requirePermission('content.schedule'), async (c) => {
  const b = await c.req.json<any>();
  const user = c.get('user');
  if (!b.name) return c.json({ error: 'اسم الحملة مطلوب' }, 400);
  const id = newId('camp');
  const now = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO campaigns (id, name, objective, start_date, end_date, target_platforms,
                            status, updated_at, owner_id, budget,
                            target_impressions, target_engagement, target_leads)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      b.name,
      b.objective || null,
      b.start_date || null,
      b.end_date || null,
      JSON.stringify(b.target_platforms || []),
      /* «مخطّطة» لا «نشطة». حملةٌ كُتبت للتوّ لم تبدأ، وتوليدُها نشطةً كان
         يجعل كل حملةٍ في المنصة نشطةً إلى الأبد — لا لأن أحداً قرّر ذلك
         بل لأن الواجهة لم تكن تنادي PATCH أصلاً. */
      b.status || 'planned',
      now,
      b.owner_id || user.id,
      num(b.budget),
      num(b.target_impressions),
      num(b.target_engagement),
      num(b.target_leads),
    )
    .run();
  c.executionCtx.waitUntil(
    logAudit(c.env, { id: user.id, name: user.name }, 'campaign_create', 'campaign', id, b.name),
  );
  return c.json({ ok: true, id });
});

// ═══ التعديل وتغيير الحالة ═══
campaignRoutes.patch('/:id', requirePermission('content.schedule'), async (c) => {
  const id = c.req.param('id');
  const b = await c.req.json<any>();
  const user = c.get('user');

  const current = await c.env.DB.prepare('SELECT * FROM campaigns WHERE id = ?').bind(id).first();
  if (!current) return c.json({ error: 'غير موجودة' }, 404);

  const fields: string[] = [];
  const binds: unknown[] = [];

  for (const key of TEXT_FIELDS) {
    if (b[key] !== undefined) (fields.push(`${key} = ?`), binds.push(b[key] || null));
  }
  for (const key of NUMBER_FIELDS) {
    if (b[key] !== undefined) (fields.push(`${key} = ?`), binds.push(num(b[key])));
  }
  if (b.target_platforms !== undefined) {
    fields.push('target_platforms = ?');
    binds.push(JSON.stringify(b.target_platforms));
  }

  const from = current.status as CampaignStatus;
  const to = b.status as CampaignStatus | undefined;
  if (to !== undefined && to !== from) {
    if (!(CAMPAIGN_TRANSITIONS[from] || []).includes(to)) {
      return c.json({ error: 'انتقال غير مسموح لحالة الحملة' }, 400);
    }
    fields.push('status = ?');
    binds.push(to);
  }

  if (!fields.length) return c.json({ ok: true });

  fields.push('updated_at = ?');
  binds.push(nowIso());
  binds.push(id);
  await c.env.DB.prepare(`UPDATE campaigns SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...binds)
    .run();

  const actor = { id: user.id, name: user.name };
  if (to !== undefined && to !== from) {
    const action = to === 'archived' ? 'campaign_archive' : 'campaign_status';
    c.executionCtx.waitUntil(logAudit(c.env, actor, action, 'campaign', id, `${from} → ${to}`));
  } else {
    c.executionCtx.waitUntil(logAudit(c.env, actor, 'campaign_update', 'campaign', id, String(current.name)));
  }
  return c.json({ ok: true });
});

// ═══ إنشاء نسخة ═══
// تُنسخ الخطة لا التنفيذ: الاسم والهدف والمنصات والميزانية والمستهدفات.
// ولا تُنسخ المدّة ولا المنشورات — نسخةٌ ترث تواريخ الأصل تبدأ منتهيةً،
// ومنشورٌ في حملتين ليس نسخةً بل رقماً مضاعفاً في تقريرين.
campaignRoutes.post('/:id/duplicate', requirePermission('content.schedule'), async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const src = await c.env.DB.prepare('SELECT * FROM campaigns WHERE id = ?').bind(id).first<any>();
  if (!src) return c.json({ error: 'غير موجودة' }, 404);

  const newIdent = newId('camp');
  const now = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO campaigns (id, name, objective, start_date, end_date, target_platforms,
                            status, updated_at, owner_id, budget,
                            target_impressions, target_engagement, target_leads)
     VALUES (?, ?, ?, NULL, NULL, ?, 'planned', ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      newIdent,
      `${src.name} (نسخة)`,
      src.objective,
      src.target_platforms,
      now,
      user.id,
      src.budget,
      src.target_impressions,
      src.target_engagement,
      src.target_leads,
    )
    .run();
  c.executionCtx.waitUntil(
    logAudit(c.env, { id: user.id, name: user.name }, 'campaign_duplicate', 'campaign', newIdent, String(src.name)),
  );
  return c.json({ ok: true, id: newIdent });
});

// ═══ ربط محتوى بالحملة ═══
// نقطةٌ خاصة بالحملة لا `PATCH /posts/:id`: تلك تتطلّب `draft.edit` وتمنع
// الكاتب من لمس محتوى غيره، فمديرُ التسويق الذي يملك `content.schedule`
// ولا يملك الأولى يعجز عن ضمّ محتوى فريقه إلى حملته.
campaignRoutes.post('/:id/posts', requirePermission('content.schedule'), async (c) => {
  const id = c.req.param('id');
  const b = await c.req.json<{ post_ids?: string[] }>();
  const user = c.get('user');
  const ids = (b.post_ids || []).filter((p) => typeof p === 'string' && p);
  if (!ids.length) return c.json({ error: 'لم تُحدَّد عناصر' }, 400);

  const campaign = await c.env.DB.prepare('SELECT id FROM campaigns WHERE id = ?').bind(id).first();
  if (!campaign) return c.json({ error: 'غير موجودة' }, 404);

  const now = nowIso();
  await c.env.DB.batch(
    ids.map((postId) =>
      c.env.DB.prepare('UPDATE content_posts SET campaign_id = ?, updated_at = ? WHERE id = ?').bind(id, now, postId),
    ),
  );
  c.executionCtx.waitUntil(
    logAudit(c.env, { id: user.id, name: user.name }, 'campaign_posts_link', 'campaign', id, String(ids.length)),
  );
  return c.json({ ok: true, linked: ids.length });
});

// ═══ فصل محتوى عن الحملة ═══
// يفكّ الارتباط ولا يحذف المنشور.
campaignRoutes.delete('/:id/posts/:postId', requirePermission('content.schedule'), async (c) => {
  const id = c.req.param('id');
  const postId = c.req.param('postId');
  const user = c.get('user');
  await c.env.DB.prepare(
    'UPDATE content_posts SET campaign_id = NULL, updated_at = ? WHERE id = ? AND campaign_id = ?',
  )
    .bind(nowIso(), postId, id)
    .run();
  c.executionCtx.waitUntil(
    logAudit(c.env, { id: user.id, name: user.name }, 'campaign_posts_unlink', 'campaign', id, postId),
  );
  return c.json({ ok: true });
});
