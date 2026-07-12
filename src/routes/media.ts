import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth, requirePermission } from '../middleware';
import { newId } from '../util';

export const mediaRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

mediaRoutes.use('*', requireAuth);

// رفع وسيط إلى R2 (multipart/form-data، الحقل: file)
mediaRoutes.post('/', requirePermission('media.upload'), async (c) => {
  const user = c.get('user');
  const form = await c.req.formData();
  const entry = form.get('file');
  if (!entry || typeof entry === 'string') return c.json({ error: 'لم يُرفق ملف' }, 400);
  const file = entry as unknown as File;

  const id = newId('media');
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
  const key = `${id}.${ext}`;
  await c.env.MEDIA.put(key, file.stream(), {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
  });

  await c.env.DB.prepare(
    'INSERT INTO media_assets (id, r2_key, mime_type, size, uploaded_by) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(id, key, file.type || null, file.size, user.id)
    .run();

  return c.json({ ok: true, id, key, url: `/api/media/${id}` });
});

mediaRoutes.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT m.*, u.name AS uploader_name FROM media_assets m
     LEFT JOIN users u ON u.id = m.uploaded_by ORDER BY m.created_at DESC LIMIT 200`,
  ).all();
  return c.json({ media: results });
});

// تنزيل/عرض الوسيط من R2
mediaRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const asset = await c.env.DB.prepare('SELECT r2_key, mime_type FROM media_assets WHERE id = ?')
    .bind(id)
    .first<{ r2_key: string; mime_type: string | null }>();
  if (!asset) return c.json({ error: 'غير موجود' }, 404);

  const object = await c.env.MEDIA.get(asset.r2_key);
  if (!object) return c.json({ error: 'الملف غير موجود في التخزين' }, 404);

  return new Response(object.body, {
    headers: {
      'content-type': asset.mime_type || 'application/octet-stream',
      'cache-control': 'private, max-age=3600',
    },
  });
});
