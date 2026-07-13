import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth, requirePermission } from '../middleware';
import { newId, nowIso } from '../util';
import { publishPostNow } from '../services/publish';

export const scheduleRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

scheduleRoutes.use('*', requireAuth);

// النشر الفوري لمنشور معيّن (نشر يدوي) — ولو قبل موعده المجدول أو بعده. للمدير العام. idempotent.
scheduleRoutes.post('/publish-now', requirePermission('content.approve_final'), async (c) => {
  const { post_id } = await c.req.json<{ post_id: string }>();
  if (!post_id) return c.json({ error: 'المنشور مطلوب' }, 400);
  const post = await c.env.DB.prepare('SELECT status FROM content_posts WHERE id = ?')
    .bind(post_id)
    .first<{ status: string }>();
  if (!post) return c.json({ error: 'المنشور غير موجود' }, 404);
  if (!['scheduled', 'approved'].includes(post.status)) {
    return c.json({ error: 'لا يمكن النشر الآن إلا لمحتوى معتمد أو مجدول' }, 400);
  }
  const result = await publishPostNow(c.env, post_id);
  if (result.published === 0 && result.failed === 0) {
    return c.json({ error: 'لا توجد جداول قابلة للنشر لهذا المنشور' }, 400);
  }
  return c.json({ ok: true, ...result });
});

// التقويم الموحّد — كل الجداول ضمن نطاق زمني
scheduleRoutes.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT s.*, p.title FROM schedules s JOIN content_posts p ON p.id = s.post_id
     ORDER BY s.scheduled_at ASC LIMIT 500`,
  ).all();
  return c.json({ schedules: results });
});

// جدولة منشور معتمد. الجدولة صلاحية (مدير تسويق/عام)، والاعتماد النهائي للمدير العام.
// شرط: المنشور بحالة approved أو scheduled. عند الجدولة تصبح حالته scheduled.
scheduleRoutes.post('/', requirePermission('content.schedule'), async (c) => {
  const user = c.get('user');
  const { post_id, platforms, scheduled_at } = await c.req.json<{
    post_id: string;
    platforms: string[];
    scheduled_at: string; // ISO UTC
  }>();

  if (!post_id || !platforms?.length || !scheduled_at) {
    return c.json({ error: 'المنشور والمنصات والموعد مطلوبة' }, 400);
  }

  const post = await c.env.DB.prepare('SELECT status FROM content_posts WHERE id = ?')
    .bind(post_id)
    .first<{ status: string }>();
  if (!post) return c.json({ error: 'المنشور غير موجود' }, 404);
  if (!['approved', 'scheduled'].includes(post.status)) {
    return c.json({ error: 'لا يمكن الجدولة إلا بعد الاعتماد النهائي من المدير العام' }, 400);
  }

  const when = new Date(scheduled_at);
  if (isNaN(when.getTime())) return c.json({ error: 'موعد غير صالح' }, 400);

  for (const platform of platforms) {
    await c.env.DB.prepare(
      `INSERT INTO schedules (id, post_id, platform, scheduled_at, status) VALUES (?, ?, ?, ?, 'pending')`,
    )
      .bind(newId('sch'), post_id, platform, when.toISOString())
      .run();
  }

  await c.env.DB.prepare("UPDATE content_posts SET status = 'scheduled', updated_at = ? WHERE id = ?")
    .bind(nowIso(), post_id)
    .run();

  // سجل الانتقال
  await c.env.DB.prepare(
    `INSERT INTO approvals (id, post_id, from_status, to_status, actor_id, note)
     VALUES (?, ?, ?, 'scheduled', ?, ?)`,
  )
    .bind(newId('appr'), post_id, post.status, user.id, `جدولة على: ${platforms.join(', ')}`)
    .run();

  return c.json({ ok: true });
});

// إلغاء جدولة معلّقة
scheduleRoutes.delete('/:id', requirePermission('content.schedule'), async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare("DELETE FROM schedules WHERE id = ? AND status IN ('pending','failed')")
    .bind(id)
    .run();
  return c.json({ ok: true });
});
