import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth, requirePermission } from '../middleware';
import { newId } from '../util';

export const subscriberRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

subscriberRoutes.use('*', requireAuth);
subscriberRoutes.use('*', requirePermission('newsletter.manage'));

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const token = () => newId('tok') + newId('tok');

// القائمة مع فلتر الحالة والبحث، والعدّادات
subscriberRoutes.get('/', async (c) => {
  const status = c.req.query('status');
  const q = c.req.query('q');
  const where: string[] = [];
  const binds: unknown[] = [];
  if (status) { where.push('status = ?'); binds.push(status); }
  if (q) { where.push('(email LIKE ? OR name LIKE ?)'); binds.push(`%${q}%`, `%${q}%`); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { results } = await c.env.DB.prepare(
    `SELECT id, email, name, status, tags, consent_source, consent_at, created_at, unsubscribed_at
     FROM subscribers ${clause} ORDER BY created_at DESC LIMIT 500`,
  ).bind(...binds).all();

  const counts = await c.env.DB.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
            SUM(CASE WHEN status = 'unsubscribed' THEN 1 ELSE 0 END) AS unsubscribed,
            SUM(CASE WHEN status = 'bounced' THEN 1 ELSE 0 END) AS bounced
     FROM subscribers`,
  ).first<{ total: number; active: number; unsubscribed: number; bounced: number }>();

  return c.json({ subscribers: results, counts: counts || { total: 0, active: 0, unsubscribed: 0, bounced: 0 } });
});

// إضافة يدوية
subscriberRoutes.post('/', async (c) => {
  const b = await c.req.json<{ email?: string; name?: string; tags?: string[] }>();
  const email = (b.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return c.json({ error: 'البريد الإلكتروني غير صالح' }, 400);

  await c.env.DB.prepare(
    `INSERT INTO subscribers (id, email, name, status, tags, consent_source, consent_at, token)
     VALUES (?, ?, ?, 'active', ?, 'manual', strftime('%Y-%m-%dT%H:%M:%SZ','now'), ?)
     ON CONFLICT(email) DO UPDATE SET
       name = COALESCE(NULLIF(excluded.name, ''), subscribers.name),
       status = CASE WHEN subscribers.status = 'unsubscribed' THEN 'active' ELSE subscribers.status END,
       unsubscribed_at = NULL`,
  )
    .bind(newId('sub'), email, b.name || null, b.tags?.length ? JSON.stringify(b.tags) : null, token())
    .run();
  return c.json({ ok: true });
});

// استيراد جماعي (نص: بريد[,اسم] في كل سطر — أو CSV بسيط)
subscriberRoutes.post('/import', async (c) => {
  const { text } = await c.req.json<{ text?: string }>();
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  let added = 0;
  let skipped = 0;
  for (const line of lines.slice(0, 5000)) {
    const [rawEmail, ...rest] = line.split(/[,;\t]/);
    const email = (rawEmail || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) { skipped++; continue; }
    const res = await c.env.DB.prepare(
      `INSERT INTO subscribers (id, email, name, status, consent_source, consent_at, token)
       VALUES (?, ?, ?, 'active', 'import', strftime('%Y-%m-%dT%H:%M:%SZ','now'), ?)
       ON CONFLICT(email) DO NOTHING`,
    )
      .bind(newId('sub'), email, rest.join(' ').trim() || null, token())
      .run();
    if (res.meta.changes > 0) added++; else skipped++;
  }
  return c.json({ ok: true, added, skipped });
});

// تغيير الحالة يدوياً (إلغاء اشتراك/إعادة تفعيل)
subscriberRoutes.patch('/:id', async (c) => {
  const { status } = await c.req.json<{ status: string }>();
  if (!['active', 'unsubscribed', 'bounced', 'pending'].includes(status)) {
    return c.json({ error: 'حالة غير صالحة' }, 400);
  }
  await c.env.DB.prepare(
    `UPDATE subscribers SET status = ?,
       unsubscribed_at = CASE WHEN ? = 'unsubscribed' THEN strftime('%Y-%m-%dT%H:%M:%SZ','now') ELSE NULL END
     WHERE id = ?`,
  )
    .bind(status, status, c.req.param('id'))
    .run();
  return c.json({ ok: true });
});

// تعديل وسوم المشترك (الشرائح)
subscriberRoutes.patch('/:id/tags', async (c) => {
  const { tags } = await c.req.json<{ tags: string[] }>();
  const clean = (tags || []).map((t) => String(t).trim()).filter(Boolean).slice(0, 10);
  await c.env.DB.prepare('UPDATE subscribers SET tags = ? WHERE id = ?')
    .bind(clean.length ? JSON.stringify(clean) : null, c.req.param('id'))
    .run();
  return c.json({ ok: true });
});

subscriberRoutes.delete('/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM subscribers WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});
