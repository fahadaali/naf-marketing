import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth, requirePermission } from '../middleware';
import { hasPermission } from '../permissions';
import { newId, nowIso, normalizeBody } from '../util';
import { generateText } from '../services/claude';
import { transition, type Action } from '../services/workflow';
import { syncPostSafe, trashPostTaskSafe } from '../services/basecampSync';
import { notifyStageReached } from '../services/notify';
import { snapshotVersion } from '../services/versions';
import { logAudit } from '../services/audit';
import {
  resolveFormat, isYmd, cleanDay, cleanPlatforms, cleanText, isIdeaRow,
  PILLAR_MAX, BRIEF_MAX, PLANNED_CAP, SCHEDULED_PLATFORMS_SQL,
} from '../services/planning';

export const postRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

postRoutes.use('*', requireAuth);

/**
 * من يعدّل المحتوى: كاتبه، ومن أُسند إليه تنفيذه، ومن يراجع.
 *
 * وبغير الإسناد يقف الكاتب عند فكرةٍ خطّطها غيره وأسندها إليه: يراها في
 * الخطة ويردّه الخادم بـ٤٠٣ عند أول حفظ.
 */
function mayEdit(user: { id: string; role_name: string }, post: { author_id: string; assignee_id: string | null }) {
  return post.author_id === user.id || post.assignee_id === user.id || user.role_name !== 'writer';
}

/**
 * أوّل من يكتب نصّ الفكرة يصير كاتبها.
 *
 * الكاتب في هذه المنصة من كتب النصّ، وعليه تقوم قاعدة «لا يعتمد المحتوى
 * كاتبُه» (`workflow.ts`). ولو بقي كاتبُ الفكرة من خطّطها لما اعتمد مديرُ
 * التسويق عملاً كتبه غيره لأنه خطّط عنوانه — ولنُسب النصّ إلى من لم يكتبه.
 */
function takesAuthorship(user: { id: string }, post: { author_id: string; status: string; body: string }, newBody: string) {
  return isIdeaRow(post) && newBody !== '' && post.author_id !== user.id;
}

/** مسؤول التنفيذ: معرّفُ مستخدمٍ موجود، أو `null` يمسحه، أو `undefined` يُهمل. */
async function cleanAssignee(env: Env, v: unknown): Promise<string | null | undefined> {
  if (v === null || v === '') return null;
  if (typeof v !== 'string') return undefined;
  const row = await env.DB.prepare('SELECT 1 AS x FROM users WHERE id = ?').bind(v).first();
  return row ? v : undefined;
}

// قائمة المنشورات مع فلاتر (status, campaign_id, mine)، أو قائمة الخطة بنطاق
// اليوم المستهدف (planned=1&planned_from&planned_to).
postRoutes.get('/', async (c) => {
  const status = c.req.query('status');
  const campaign = c.req.query('campaign_id');
  const mine = c.req.query('mine');
  const user = c.get('user');

  const where: string[] = [];
  const binds: unknown[] = [];
  if (status) {
    where.push('p.status = ?');
    binds.push(status);
  }
  if (campaign) {
    where.push('p.campaign_id = ?');
    binds.push(campaign);
  }
  if (mine === '1') {
    where.push('p.author_id = ?');
    binds.push(user.id);
  }

  /* قائمة الخطة لا تقف عند المئتين الأحدث تعديلاً: تلك تُسقط من الربع القادم
     ما لم يُلمس مؤخراً، وعرضُ «حجم العمل» يعدّ ما يصله — فيعدّ ناقصاً بلا
     إشارة. فهي بنطاق اليوم المستهدف وترتيبه، وسقفُها يُقال إن بُلغ. */
  const planned = c.req.query('planned') === '1';
  if (planned) {
    where.push('p.planned_on IS NOT NULL');
    const from = c.req.query('planned_from');
    const to = c.req.query('planned_to');
    if (isYmd(from)) {
      where.push('p.planned_on >= ?');
      binds.push(from);
    }
    if (isYmd(to)) {
      where.push('p.planned_on <= ?');
      binds.push(to);
    }
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const order = planned ? 'p.planned_on ASC, p.created_at ASC' : 'p.updated_at DESC';
  const limit = planned ? PLANNED_CAP + 1 : 200;

  const { results } = await c.env.DB.prepare(
    `SELECT p.*, u.name AS author_name, ua.name AS assignee_name, cm.name AS campaign_name,
            (SELECT MIN(s.scheduled_at) FROM schedules s
               WHERE s.post_id = p.id AND s.status IN ('pending','failed')) AS pending_at,
            ${SCHEDULED_PLATFORMS_SQL}
     FROM content_posts p
     LEFT JOIN users u ON u.id = p.author_id
     LEFT JOIN users ua ON ua.id = p.assignee_id
     LEFT JOIN campaigns cm ON cm.id = p.campaign_id
     ${clause}
     ORDER BY ${order} LIMIT ${limit}`,
  )
    .bind(...binds)
    .all();
  if (planned) {
    return c.json({ posts: results.slice(0, PLANNED_CAP), truncated: results.length > PLANNED_CAP });
  }
  return c.json({ posts: results });
});

// من يُسند إليه التنفيذ — لكل من يكتب المحتوى. ولا تُستعمل `GET /users`
// (تتطلّب `users.manage`) ولا `/campaigns/meta/owners` (تتطلّب
// `content.schedule`): كلتاهما تردّ ٤٠٣ على الكاتب، وهو ممّن يُخطّط فكرةً
// ويُسندها. مسجّلةٌ قبل `/:id` كأختها في الحملات.
postRoutes.get('/meta/assignees', requirePermission('draft.edit'), async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, name FROM users WHERE is_active = 1 ORDER BY name',
  ).all();
  return c.json({ assignees: results });
});

// طابور الاعتماد — حسب الحالة الحالية للمستخدم
postRoutes.get('/queue', requirePermission('content.review'), async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT p.*, u.name AS author_name, ${SCHEDULED_PLATFORMS_SQL} FROM content_posts p
     LEFT JOIN users u ON u.id = p.author_id
     WHERE p.status IN ('pending_marketing','pending_gm')
     ORDER BY p.updated_at ASC`,
  ).all();
  return c.json({ posts: results });
});

// تفاصيل منشور + النسخ + سجل الموافقات
postRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const post = await c.env.DB.prepare(
    `SELECT p.*, u.name AS author_name, ua.name AS assignee_name, cm.name AS campaign_name
     FROM content_posts p LEFT JOIN users u ON u.id = p.author_id
     LEFT JOIN users ua ON ua.id = p.assignee_id
     LEFT JOIN campaigns cm ON cm.id = p.campaign_id WHERE p.id = ?`,
  )
    .bind(id)
    .first();
  if (!post) return c.json({ error: 'المنشور غير موجود' }, 404);

  const variants = await c.env.DB.prepare('SELECT * FROM post_variants WHERE post_id = ?').bind(id).all();
  const approvals = await c.env.DB.prepare(
    `SELECT a.*, u.name AS actor_name FROM approvals a
     LEFT JOIN users u ON u.id = a.actor_id WHERE a.post_id = ? ORDER BY a.created_at ASC`,
  )
    .bind(id)
    .all();
  const schedules = await c.env.DB.prepare('SELECT * FROM schedules WHERE post_id = ?').bind(id).all();
  const notes = await c.env.DB.prepare('SELECT * FROM post_notes WHERE post_id = ? ORDER BY created_at ASC').bind(id).all();
  const bcTask = await c.env.DB.prepare('SELECT 1 AS x FROM basecamp_tasks WHERE post_id = ?').bind(id).first();

  return c.json({
    post,
    variants: variants.results,
    approvals: approvals.results,
    schedules: schedules.results,
    notes: notes.results,
    basecamp_synced: !!bcTask,
  });
});

// إنشاء مسودة — أو فكرةٍ في الخطة: مسودةٌ بلا نصّ، بيومها ومنصاتها ومسؤولها
postRoutes.post('/', requirePermission('draft.edit'), async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{
    title?: string;
    body?: string;
    content_type?: string;
    format?: string;
    source?: string;
    campaign_id?: string;
    news_item_id?: string;
    planned_on?: string | null;
    planned_platforms?: string[] | null;
    assignee_id?: string | null;
    pillar?: string | null;
    brief?: string | null;
  }>();

  const id = newId('post');
  const text = normalizeBody(body.body);
  const fmt = resolveFormat(body) ?? { format: 'text', content_type: 'text' };
  await c.env.DB.prepare(
    `INSERT INTO content_posts (id, title, body, content_type, format, source, author_id, campaign_id,
                                planned_on, planned_platforms, assignee_id, pillar, brief)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      body.title || 'مسودة بدون عنوان',
      text,
      fmt.content_type,
      fmt.format,
      body.source || 'manual',
      user.id,
      body.campaign_id || null,
      cleanDay(body.planned_on) ?? null,
      cleanPlatforms(body.planned_platforms) ?? null,
      (await cleanAssignee(c.env, body.assignee_id)) ?? null,
      cleanText(body.pillar, PILLAR_MAX) ?? null,
      cleanText(body.brief, BRIEF_MAX) ?? null,
    )
    .run();

  // ربط بخبر RSS إن وُجد
  if (body.news_item_id) {
    await c.env.DB.prepare('UPDATE news_items SET converted_post_id = ? WHERE id = ?')
      .bind(id, body.news_item_id)
      .run();
  }
  // مزامنة بيسكامب في الخلفية (بطاقة مهمة في قائمة المسودات)
  c.executionCtx.waitUntil(syncPostSafe(c.env, id));
  return c.json({ ok: true, id, idea: text === '' });
});

// استيراد جماعي: إنشاء مسودات دفعةً واحدة من ملف مستورد (CSV/JSON محوّلين في الواجهة).
// وبحقول الخطة تُستورد خطةُ ربعٍ كاملة أفكاراً من جدول.
postRoutes.post('/import', requirePermission('draft.edit'), async (c) => {
  const user = c.get('user');
  const { items } = await c.req.json<{ items: any[] }>();
  if (!Array.isArray(items) || items.length === 0) return c.json({ error: 'لا توجد عناصر للاستيراد' }, 400);
  const batch = items.slice(0, 500);

  /* المسؤولون الموجودون فعلاً، باستعلامٍ لكل تسعين: D1 يقبل مئة معاملٍ في
     العبارة الواحدة، وخمس مئة صفٍّ قد تحمل خمس مئة معرّف. */
  const wanted = [...new Set(batch.map((it) => it?.assignee_id).filter((v): v is string => typeof v === 'string' && !!v))];
  const known = new Set<string>();
  for (let i = 0; i < wanted.length; i += 90) {
    const chunk = wanted.slice(i, i + 90);
    const { results } = await c.env.DB.prepare(
      `SELECT id FROM users WHERE id IN (${chunk.map(() => '?').join(',')})`,
    ).bind(...chunk).all<{ id: string }>();
    for (const r of results) known.add(r.id);
  }

  const stmts = [];
  for (const it of batch) {
    const title = String(it.title ?? '').trim() || 'مسودة مستوردة';
    const fmt = resolveFormat(it) ?? { format: 'text', content_type: 'text' };
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO content_posts (id, title, body, content_type, format, source, author_id, campaign_id,
                                    planned_on, planned_platforms, assignee_id, pillar, brief)
         VALUES (?, ?, ?, ?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        newId('post'), title, normalizeBody(String(it.body ?? '')), fmt.content_type, fmt.format, user.id, it.campaign_id || null,
        cleanDay(it.planned_on) ?? null,
        cleanPlatforms(it.planned_platforms) ?? null,
        known.has(it.assignee_id) ? it.assignee_id : null,
        cleanText(it.pillar, PILLAR_MAX) ?? null,
        cleanText(it.brief, BRIEF_MAX) ?? null,
      ),
    );
  }
  if (stmts.length) await c.env.DB.batch(stmts);
  return c.json({ ok: true, created: stmts.length });
});

// تحديث مسودة
postRoutes.patch('/:id', requirePermission('draft.edit'), async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const post = await c.env.DB.prepare(
    'SELECT author_id, assignee_id, status, body, format FROM content_posts WHERE id = ?',
  )
    .bind(id)
    .first<{ author_id: string; assignee_id: string | null; status: string; body: string; format: string }>();
  if (!post) return c.json({ error: 'غير موجود' }, 404);

  // الكاتب يعدّل مسوّداته وما أُسند إليه تنفيذه؛ من يملك صلاحية المراجعة يعدّل الجميع
  if (!mayEdit(user, post)) {
    return c.json({ error: 'لا يمكنك تعديل محتوى غيرك' }, 403);
  }

  const b = await c.req.json<{
    title?: string;
    body?: string;
    content_type?: string;
    format?: string;
    campaign_id?: string | null;
    planned_on?: string | null;
    planned_platforms?: string[] | null;
    assignee_id?: string | null;
    pillar?: string | null;
    brief?: string | null;
  }>();
  const fields: string[] = [];
  const binds: unknown[] = [];
  const set = (column: string, value: unknown) => {
    fields.push(`${column} = ?`);
    binds.push(value);
  };

  if (b.title !== undefined) set('title', b.title);
  const body = b.body === undefined ? undefined : normalizeBody(b.body);
  if (body !== undefined) set('body', body);
  // الشكل يقرّر النوع، والنوع وحده يُبقي الشكل إن وافقه
  const fmt = b.format !== undefined || b.content_type !== undefined ? resolveFormat(b, post.format) : null;
  if (fmt) {
    set('format', fmt.format);
    set('content_type', fmt.content_type);
  }
  if (b.campaign_id !== undefined) set('campaign_id', b.campaign_id);
  const day = b.planned_on === undefined ? undefined : cleanDay(b.planned_on);
  if (day !== undefined) set('planned_on', day);
  const platforms = b.planned_platforms === undefined ? undefined : cleanPlatforms(b.planned_platforms);
  if (platforms !== undefined) set('planned_platforms', platforms);
  const assignee = b.assignee_id === undefined ? undefined : await cleanAssignee(c.env, b.assignee_id);
  if (assignee !== undefined) set('assignee_id', assignee);
  const pillar = b.pillar === undefined ? undefined : cleanText(b.pillar, PILLAR_MAX);
  if (pillar !== undefined) set('pillar', pillar);
  const brief = b.brief === undefined ? undefined : cleanText(b.brief, BRIEF_MAX);
  if (brief !== undefined) set('brief', brief);
  if (body !== undefined && takesAuthorship(user, post, body)) set('author_id', user.id);

  const idea = isIdeaRow({ status: post.status, body: body ?? post.body });
  if (!fields.length) return c.json({ ok: true, idea });
  set('updated_at', nowIso());
  binds.push(id);

  // لقطة نسخة قبل التعديل عند تغيّر المحتوى الفعلي (عنوان/نص/شكل)
  if (b.title !== undefined || body !== undefined || fmt) {
    await snapshotVersion(c.env, id, user.id);
  }

  await c.env.DB.prepare(`UPDATE content_posts SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...binds)
    .run();
  c.executionCtx.waitUntil(syncPostSafe(c.env, id));
  return c.json({ ok: true, idea });
});

// سجل نسخ المنشور
postRoutes.get('/:id/versions', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT v.id, v.title, v.content_type, v.created_at, u.name AS editor_name
     FROM content_versions v LEFT JOIN users u ON u.id = v.edited_by
     WHERE v.post_id = ? ORDER BY v.created_at DESC`,
  )
    .bind(c.req.param('id'))
    .all();
  return c.json({ versions: results });
});

// استرجاع نسخة سابقة (يأخذ لقطة من الحالة الحالية أولاً كي لا تُفقد)
postRoutes.post('/:id/versions/:versionId/restore', requirePermission('draft.edit'), async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const post = await c.env.DB.prepare(
    'SELECT author_id, assignee_id, status, body, format FROM content_posts WHERE id = ?',
  )
    .bind(id)
    .first<{ author_id: string; assignee_id: string | null; status: string; body: string; format: string }>();
  if (!post) return c.json({ error: 'غير موجود' }, 404);
  if (!mayEdit(user, post)) {
    return c.json({ error: 'لا يمكنك تعديل محتوى غيرك' }, 403);
  }

  const version = await c.env.DB.prepare(
    'SELECT title, body, content_type FROM content_versions WHERE id = ? AND post_id = ?',
  )
    .bind(c.req.param('versionId'), id)
    .first<{ title: string; body: string; content_type: string }>();
  if (!version) return c.json({ error: 'النسخة غير موجودة' }, 404);

  /* النسخ لا تحفظ الشكل — قبل 0033 لم يكن، وبعدها يكفي النوع: الشكل الحاليّ
     يبقى إن وافق نوعَ النسخة، وإلا الشكلُ الأساسيّ لنوعها. */
  const fmt = resolveFormat({ content_type: version.content_type }, post.format)
    ?? { format: post.format, content_type: version.content_type };
  const body = normalizeBody(version.body);
  // استرجاعُ نصٍّ على فكرةٍ كتابةٌ لها كالحفظ تماماً
  const author = takesAuthorship(user, post, body) ? user.id : post.author_id;
  await snapshotVersion(c.env, id, user.id);
  await c.env.DB.prepare(
    'UPDATE content_posts SET title = ?, body = ?, content_type = ?, format = ?, author_id = ?, updated_at = ? WHERE id = ?',
  )
    .bind(version.title, body, fmt.content_type, fmt.format, author, nowIso(), id)
    .run();
  c.executionCtx.waitUntil(syncPostSafe(c.env, id));
  return c.json({ ok: true });
});

// حذف منشور — الكاتب يحذف مسوّداته (مسودة/مرفوض)، والمدير العام يحذف أي محتوى.
// يحذف كل التوابع صراحةً (نسخ/جداول/موافقات/تحليلات) ويفصل ربط الأخبار.
postRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const post = await c.env.DB.prepare('SELECT author_id, status FROM content_posts WHERE id = ?')
    .bind(id)
    .first<{ author_id: string; status: string }>();
  if (!post) return c.json({ error: 'غير موجود' }, 404);

  const isGM = await hasPermission(c.env, user.role_name, 'content.approve_final');
  const isOwnerDraft = post.author_id === user.id && ['draft', 'rejected'].includes(post.status);
  if (!isGM && !isOwnerDraft) {
    return c.json({ error: 'لا يمكنك حذف هذا المحتوى (يمكن للكاتب حذف مسوّداته فقط)' }, 403);
  }

  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE news_items SET converted_post_id = NULL WHERE converted_post_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM analytics_snapshots WHERE post_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM approvals WHERE post_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM schedules WHERE post_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM post_variants WHERE post_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM content_versions WHERE post_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM post_notes WHERE post_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM content_posts WHERE id = ?').bind(id),
  ]);
  c.executionCtx.waitUntil(trashPostTaskSafe(c.env, id));
  c.executionCtx.waitUntil(logAudit(c.env, { id: user.id, name: user.name }, 'post_delete', 'post', id));
  return c.json({ ok: true });
});

// توليد نص بالذكاء الاصطناعي (لا يحفظ — يُرجَع للمحرر)
postRoutes.post('/ai/generate', requirePermission('ai.generate'), async (c) => {
  const opts = await c.req.json<any>();
  if (!opts.topic && !opts.sourceText) return c.json({ error: 'أدخل موضوعاً أو نصاً مصدراً' }, 400);
  try {
    const text = await generateText(c.env, opts);
    return c.json({ text });
  } catch (err: any) {
    return c.json({ error: String(err?.message || err) }, 502);
  }
});

// إجراءات دورة الحياة: submit / approve / reject / archive
postRoutes.post('/:id/action', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const { action, note } = await c.req.json<{ action: Action; note?: string }>();

  const post = await c.env.DB.prepare('SELECT id, status, author_id FROM content_posts WHERE id = ?')
    .bind(id)
    .first<{ id: string; status: string; author_id: string }>();
  if (!post) return c.json({ error: 'غير موجود' }, 404);

  const result = await transition(c.env, user, post, action, note);
  if (!result.ok) return c.json({ error: result.error }, result.status as any);
  // نقل بطاقة المهمة إلى مرحلتها الجديدة في بيسكامب + إشعار من وصل الدور إليه
  c.executionCtx.waitUntil(syncPostSafe(c.env, id));
  c.executionCtx.waitUntil(notifyStageReached(c.env, id, result.to));
  return c.json({ ok: true, status: result.to });
});

// نسخ المنصات (variants)
postRoutes.put('/:id/variants/:platform', requirePermission('draft.edit'), async (c) => {
  const id = c.req.param('id');
  const platform = c.req.param('platform');
  const { body_override, media_asset_id, first_comment } = await c.req.json<{
    body_override?: string;
    media_asset_id?: string;
    first_comment?: string;
  }>();
  await c.env.DB.prepare(
    `INSERT INTO post_variants (id, post_id, platform, body_override, media_asset_id, first_comment)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(post_id, platform) DO UPDATE SET body_override = excluded.body_override,
       media_asset_id = excluded.media_asset_id, first_comment = excluded.first_comment`,
  )
    .bind(newId('var'), id, platform, body_override || null, media_asset_id || null, first_comment || null)
    .run();
  return c.json({ ok: true });
});
