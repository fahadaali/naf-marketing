import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth, requirePermission } from '../middleware';
import { newId, nowIso } from '../util';
import { publishPostNow, preflightSchedules } from '../services/publish';
import { syncPostSafe } from '../services/basecampSync';

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
  if (result.published === 0 && result.failed === 0 && result.pending === 0) {
    return c.json({ error: 'لا توجد جداول قابلة للنشر لهذا المنشور' }, 400);
  }
  c.executionCtx.waitUntil(syncPostSafe(c.env, post_id));
  return c.json({ ok: true, ...result });
});

// التقويم الموحّد — الجداول ضمن نطاقٍ زمني (from و to لحظتان بصيغة ISO)
scheduleRoutes.get('/', async (c) => {
  /* كان يردّ أقدمَ خمس مئة موعدٍ بلا نطاق، فلمّا تجاوز السجلّ خمس مئة خرجت
     الأشهر القادمة من التقويم بلا إشارة. والنطاق اختياري: بدونه كما كان. */
  const where: string[] = [];
  const binds: string[] = [];
  for (const [key, op] of [['from', '>='], ['to', '<']] as const) {
    const v = c.req.query(key);
    if (v && /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v))) {
      where.push(`s.scheduled_at ${op} ?`);
      binds.push(new Date(v).toISOString()); // بصيغة المخزَّن نفسها، فتصحّ المقارنة نصّاً
    }
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { results } = await c.env.DB.prepare(
    `SELECT s.*, p.title FROM schedules s JOIN content_posts p ON p.id = s.post_id
     ${clause}
     ORDER BY s.scheduled_at ASC LIMIT ${where.length ? 1000 : 500}`,
  )
    .bind(...binds)
    .all();
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

  /* إعادة الجدولة تنقل الموعد القائم ولا تضيف موعداً بجانبه. وكانت كل جدولةٍ
     تُدرج صفّاً جديداً، فمن غيّر الموعد بقي له موعدان على المنصة نفسها،
     فيُنشر المحتوى مرّتين — وترفض إكس الثانية لأنها مكرّرة فتظهر «فاشل». */
  for (const platform of new Set(platforms)) {
    const moved = await c.env.DB.prepare(
      `UPDATE schedules SET scheduled_at = ?, status = 'pending', error = NULL
       WHERE post_id = ? AND platform = ? AND status IN ('pending','failed')`,
    )
      .bind(when.toISOString(), post_id, platform)
      .run();
    if (moved.meta.changes > 0) continue;
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

  // تحديث بطاقة بيسكامب: النقل إلى «مجدول» وضبط تاريخ الاستحقاق = تاريخ النشر
  c.executionCtx.waitUntil(syncPostSafe(c.env, post_id));

  // ما سترفضه المنصات يُعرف الآن لا في الموعد — ويُكتب على كل موعدٍ تحته
  const issues = await preflightSchedules(c.env, post_id, [...new Set(platforms)]).catch(() => []);
  return c.json({ ok: true, issues });
});

// إلغاء جدولة معلّقة
scheduleRoutes.delete('/:id', requirePermission('content.schedule'), async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare("DELETE FROM schedules WHERE id = ? AND status IN ('pending','failed')")
    .bind(id)
    .run();
  return c.json({ ok: true });
});
