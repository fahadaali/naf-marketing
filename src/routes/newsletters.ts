import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth, requirePermission } from '../middleware';
import { newId, nowIso } from '../util';
import { parseBlocks, renderBlocks, blocksToText, slugify, publicSettings, articleUrl } from '../services/newsletter';

export const newsletterRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

newsletterRoutes.use('*', requireAuth);
newsletterRoutes.use('*', requirePermission('newsletter.manage'));

// قائمة النشرات مع عدّادات الإرسال
newsletterRoutes.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT n.*, u.name AS author_name,
            (SELECT COUNT(*) FROM newsletter_sends s WHERE s.newsletter_id = n.id AND s.status = 'sent') AS sent_count
     FROM newsletters n LEFT JOIN users u ON u.id = n.author_id
     ORDER BY n.updated_at DESC LIMIT 100`,
  ).all();
  const active = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n FROM subscribers WHERE status = 'active'",
  ).first<{ n: number }>();
  return c.json({ newsletters: results, active_subscribers: active?.n || 0 });
});

// نشرة واحدة مع رابطها العام
newsletterRoutes.get('/:id', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM newsletters WHERE id = ?')
    .bind(c.req.param('id'))
    .first<any>();
  if (!row) return c.json({ error: 'النشرة غير موجودة' }, 404);
  const { base, path } = await publicSettings(c.env, c.req.url);
  return c.json({ newsletter: row, public_url: articleUrl(base, path, row.slug) });
});

// إنشاء
newsletterRoutes.post('/', async (c) => {
  const b = await c.req.json<{ title?: string }>();
  const title = (b.title || '').trim() || 'نشرة بلا عنوان';
  const id = newId('nl');

  // نضمن تفرّد الـ slug بإضافة لاحقة عند التعارض
  let slug = slugify(title);
  const exists = await c.env.DB.prepare('SELECT 1 FROM newsletters WHERE slug = ?').bind(slug).first();
  if (exists) slug = `${slug}-${id.slice(-5)}`;

  await c.env.DB.prepare(
    'INSERT INTO newsletters (id, title, slug, subject, author_id) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(id, title, slug, title, c.get('user').id)
    .run();
  return c.json({ ok: true, id });
});

// تحديث (محتوى/إعدادات/نشر الصفحة العامة)
newsletterRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const b = await c.req.json<Record<string, unknown>>();
  const allowed = ['title', 'subject', 'preheader', 'excerpt', 'blocks_json', 'cover_media_id', 'slug', 'scheduled_at'];
  const sets: string[] = [];
  const binds: unknown[] = [];

  for (const k of allowed) {
    if (b[k] !== undefined) {
      sets.push(`${k} = ?`);
      binds.push(k === 'slug' ? slugify(String(b[k])) : (b[k] ?? null));
    }
  }

  // نشر/إخفاء الصفحة العامة
  if (b.web_published !== undefined) {
    const on = !!b.web_published;
    sets.push('web_published = ?');
    binds.push(on ? 1 : 0);
    if (on) { sets.push('published_at = COALESCE(published_at, ?)'); binds.push(nowIso()); }
  }

  if (!sets.length) return c.json({ ok: true });
  sets.push('updated_at = ?');
  binds.push(nowIso(), id);

  await c.env.DB.prepare(`UPDATE newsletters SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  return c.json({ ok: true });
});

newsletterRoutes.delete('/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM newsletters WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

// معاينة البريد كما سيصل المشترك
newsletterRoutes.get('/:id/preview', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM newsletters WHERE id = ?')
    .bind(c.req.param('id'))
    .first<any>();
  if (!row) return c.json({ error: 'النشرة غير موجودة' }, 404);
  const { base } = await publicSettings(c.env, c.req.url);
  return c.json({
    html: renderBlocks(parseBlocks(row.blocks_json), 'email', base),
    text: blocksToText(parseBlocks(row.blocks_json)),
  });
});
