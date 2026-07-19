import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth, requirePermission } from '../middleware';
import { hasPermission } from '../permissions';
import { newId, nowIso } from '../util';
import { generateText } from '../services/claude';
import { transition, type Action } from '../services/workflow';
import { syncPostSafe, trashPostTaskSafe } from '../services/basecampSync';
import { notifyStageReached } from '../services/notify';
import { snapshotVersion } from '../services/versions';
import { logAudit } from '../services/audit';

export const postRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

postRoutes.use('*', requireAuth);

// قائمة المنشورات مع فلاتر (status, campaign_id, mine)
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
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { results } = await c.env.DB.prepare(
    `SELECT p.*, u.name AS author_name, cm.name AS campaign_name,
            (SELECT MIN(s.scheduled_at) FROM schedules s
               WHERE s.post_id = p.id AND s.status IN ('pending','failed')) AS pending_at
     FROM content_posts p
     LEFT JOIN users u ON u.id = p.author_id
     LEFT JOIN campaigns cm ON cm.id = p.campaign_id
     ${clause}
     ORDER BY p.updated_at DESC LIMIT 200`,
  )
    .bind(...binds)
    .all();
  return c.json({ posts: results });
});

// طابور الاعتماد — حسب الحالة الحالية للمستخدم
postRoutes.get('/queue', requirePermission('content.review'), async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT p.*, u.name AS author_name FROM content_posts p
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
    `SELECT p.*, u.name AS author_name, cm.name AS campaign_name
     FROM content_posts p LEFT JOIN users u ON u.id = p.author_id
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

  return c.json({
    post,
    variants: variants.results,
    approvals: approvals.results,
    schedules: schedules.results,
    notes: notes.results,
  });
});

// إنشاء مسودة
postRoutes.post('/', requirePermission('draft.edit'), async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{
    title?: string;
    body?: string;
    content_type?: string;
    source?: string;
    campaign_id?: string;
    news_item_id?: string;
  }>();

  const id = newId('post');
  await c.env.DB.prepare(
    `INSERT INTO content_posts (id, title, body, content_type, source, author_id, campaign_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      body.title || 'مسودة بدون عنوان',
      body.body || '',
      body.content_type || 'text',
      body.source || 'manual',
      user.id,
      body.campaign_id || null,
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
  return c.json({ ok: true, id });
});

// استيراد جماعي: إنشاء مسودات دفعةً واحدة من ملف مستورد (CSV/JSON محوّلين في الواجهة).
postRoutes.post('/import', requirePermission('draft.edit'), async (c) => {
  const user = c.get('user');
  const { items } = await c.req.json<{ items: any[] }>();
  if (!Array.isArray(items) || items.length === 0) return c.json({ error: 'لا توجد عناصر للاستيراد' }, 400);

  const types = ['text', 'image', 'video'];
  const stmts = [];
  for (const it of items.slice(0, 500)) {
    const title = String(it.title ?? '').trim() || 'مسودة مستوردة';
    const bodyVal = String(it.body ?? '');
    const ct = types.includes(it.content_type) ? it.content_type : 'text';
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO content_posts (id, title, body, content_type, source, author_id, campaign_id)
         VALUES (?, ?, ?, ?, 'manual', ?, ?)`,
      ).bind(newId('post'), title, bodyVal, ct, user.id, it.campaign_id || null),
    );
  }
  if (stmts.length) await c.env.DB.batch(stmts);
  return c.json({ ok: true, created: stmts.length });
});

// تحديث مسودة
postRoutes.patch('/:id', requirePermission('draft.edit'), async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const post = await c.env.DB.prepare('SELECT author_id, status FROM content_posts WHERE id = ?')
    .bind(id)
    .first<{ author_id: string; status: string }>();
  if (!post) return c.json({ error: 'غير موجود' }, 404);

  // الكاتب يعدّل مسوّداته فقط؛ من يملك صلاحية المراجعة يعدّل الجميع
  const canReviewOthers = user.role_name !== 'writer';
  if (post.author_id !== user.id && !canReviewOthers) {
    return c.json({ error: 'لا يمكنك تعديل محتوى غيرك' }, 403);
  }

  const b = await c.req.json<{ title?: string; body?: string; content_type?: string; campaign_id?: string | null }>();
  const fields: string[] = [];
  const binds: unknown[] = [];
  if (b.title !== undefined) (fields.push('title = ?'), binds.push(b.title));
  if (b.body !== undefined) (fields.push('body = ?'), binds.push(b.body));
  if (b.content_type !== undefined) (fields.push('content_type = ?'), binds.push(b.content_type));
  if (b.campaign_id !== undefined) (fields.push('campaign_id = ?'), binds.push(b.campaign_id));
  if (!fields.length) return c.json({ ok: true });
  fields.push('updated_at = ?');
  binds.push(nowIso(), id);

  // لقطة نسخة قبل التعديل عند تغيّر المحتوى الفعلي (عنوان/نص/نوع)
  if (b.title !== undefined || b.body !== undefined || b.content_type !== undefined) {
    await snapshotVersion(c.env, id, user.id);
  }

  await c.env.DB.prepare(`UPDATE content_posts SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...binds)
    .run();
  c.executionCtx.waitUntil(syncPostSafe(c.env, id));
  return c.json({ ok: true });
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
  const post = await c.env.DB.prepare('SELECT author_id, status FROM content_posts WHERE id = ?')
    .bind(id)
    .first<{ author_id: string; status: string }>();
  if (!post) return c.json({ error: 'غير موجود' }, 404);
  const canReviewOthers = user.role_name !== 'writer';
  if (post.author_id !== user.id && !canReviewOthers) {
    return c.json({ error: 'لا يمكنك تعديل محتوى غيرك' }, 403);
  }

  const version = await c.env.DB.prepare(
    'SELECT title, body, content_type FROM content_versions WHERE id = ? AND post_id = ?',
  )
    .bind(c.req.param('versionId'), id)
    .first<{ title: string; body: string; content_type: string }>();
  if (!version) return c.json({ error: 'النسخة غير موجودة' }, 404);

  await snapshotVersion(c.env, id, user.id);
  await c.env.DB.prepare(
    'UPDATE content_posts SET title = ?, body = ?, content_type = ?, updated_at = ? WHERE id = ?',
  )
    .bind(version.title, version.body, version.content_type, nowIso(), id)
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
  const { body_override, media_asset_id } = await c.req.json<{
    body_override?: string;
    media_asset_id?: string;
  }>();
  await c.env.DB.prepare(
    `INSERT INTO post_variants (id, post_id, platform, body_override, media_asset_id)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(post_id, platform) DO UPDATE SET body_override = excluded.body_override, media_asset_id = excluded.media_asset_id`,
  )
    .bind(newId('var'), id, platform, body_override || null, media_asset_id || null)
    .run();
  return c.json({ ok: true });
});
