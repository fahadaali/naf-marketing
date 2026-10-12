import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth, requirePermission } from '../middleware';
import { newId, nowIso } from '../util';
import { publishPostNow, preflightSchedules } from '../services/publish';
import { syncPostSafe } from '../services/basecampSync';
import { logAudit } from '../services/audit';
import { getProvider } from '../adapters';
import { customPlatformLabels, platformName, scheduleNote } from '../platformLabels';

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
  /* والمنشور يُجدوَل على منصةٍ لم يُنشر عليها بعد: كان المحتوى المنشور لا
     يُجدوَل أبداً، فمنصةٌ نُسيت في الجدولة الأولى لا سبيل إليها إلا بنسخه. */
  if (!['approved', 'scheduled', 'published'].includes(post.status)) {
    return c.json({ error: 'لا يمكن الجدولة إلا بعد الاعتماد النهائي من المدير العام' }, 400);
  }

  const when = new Date(scheduled_at);
  if (isNaN(when.getTime())) return c.json({ error: 'موعد غير صالح' }, 400);

  // ما نُشر عليه لا يُجدوَل ثانيةً — وإلا نُشر المحتوى عليه مرّتين. وما حُذف منشوره
  // من منصته لم يعد منشوراً عليها، فيُجدوَل من جديد (0041)
  const { results: done } = await c.env.DB.prepare(
    "SELECT DISTINCT platform FROM schedules WHERE post_id = ? AND status = 'published' AND deleted_at IS NULL",
  )
    .bind(post_id)
    .all<{ platform: string }>();
  const published = new Set((done || []).map((r) => r.platform));
  const targets = [...new Set(platforms)].filter((p) => !published.has(p));
  if (!targets.length) {
    return c.json({ error: 'نُشر المحتوى على هذه المنصات من قبل. اختر منصةً لم يُنشر عليها' }, 400);
  }

  /* إعادة الجدولة تنقل الموعد القائم ولا تضيف موعداً بجانبه. وكانت كل جدولةٍ
     تُدرج صفّاً جديداً، فمن غيّر الموعد بقي له موعدان على المنصة نفسها،
     فيُنشر المحتوى مرّتين — وترفض إكس الثانية لأنها مكرّرة فتظهر «فاشل». */
  for (const platform of targets) {
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
    .bind(newId('appr'), post_id, post.status, user.id, scheduleNote(targets, await customPlatformLabels(c.env)))
    .run();

  // تحديث بطاقة بيسكامب: النقل إلى «مجدول» وضبط تاريخ الاستحقاق = تاريخ النشر
  c.executionCtx.waitUntil(syncPostSafe(c.env, post_id));

  // ما سترفضه المنصات يُعرف الآن لا في الموعد — ويُكتب على كل موعدٍ تحته
  const issues = await preflightSchedules(c.env, post_id, targets).catch(() => []);
  return c.json({ ok: true, issues });
});

/* ═══ حذفُ المنشور من منصته ═══

   فعلٌ علنيٌّ فوري كالنشر الآن، فلمن ينشر الآن: المدير العام. والموعد يبقى
   بوقت حذفه (`deleted_at` في 0041) — فيه وقت النشر وما سُحب من أرقامه — ويُجدوَل
   المحتوى على المنصة من جديد إن شاء الفريق. ويُسجَّل في سجلّ التدقيق. */
scheduleRoutes.post('/:id/delete-post', requirePermission('content.approve_final'), async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare(
    'SELECT post_id, platform, status, provider_post_id, extra_provider_ids, deleted_at FROM schedules WHERE id = ?',
  )
    .bind(id)
    .first<{
      post_id: string; platform: string; status: string; provider_post_id: string | null;
      extra_provider_ids: string | null; deleted_at: string | null;
    }>();
  if (!row) return c.json({ error: 'الموعد غير موجود' }, 404);
  if (row.deleted_at) return c.json({ error: 'حُذف هذا المنشور من منصته من قبل' }, 400);
  if (row.status !== 'published' || !row.provider_post_id) {
    return c.json({ error: 'لا يُحذف من المنصة إلا منشورٌ نُشر عليها. والموعد الذي لم يُنشر يُلغى' }, 400);
  }

  const provider = await getProvider(c.env);
  if (!provider.deleteFromPlatform) {
    return c.json({ error: 'مزوّد النشر الحالي لا يحذف المنشور من منصته. احذفه من تطبيق المنصة' }, 400);
  }
  let extraIds: string[] = [];
  try { extraIds = row.extra_provider_ids ? JSON.parse(row.extra_provider_ids) : []; } catch { /* بلا منشوراتٍ أخرى */ }
  try {
    await provider.deleteFromPlatform(row.provider_post_id, { platform: row.platform, extraIds });
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, 502);
  }

  await c.env.DB.prepare('UPDATE schedules SET deleted_at = ? WHERE id = ?').bind(nowIso(), id).run();
  const user = c.get('user');
  c.executionCtx.waitUntil(
    logAudit(c.env, { id: user.id, name: user.name }, 'post_unpublish', 'schedule', id,
      platformName(row.platform, await customPlatformLabels(c.env))),
  );
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
