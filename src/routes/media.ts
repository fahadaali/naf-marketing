import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth, requirePermission } from '../middleware';
import { newId } from '../util';
import { generateFromMedia } from '../services/claude';

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
    'INSERT INTO media_assets (id, r2_key, mime_type, size, uploaded_by, filename) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(id, key, file.type || null, file.size, user.id, file.name || null)
    .run();

  return c.json({
    ok: true,
    id,
    key,
    url: `/api/media/${id}`,
    filename: file.name,
    mime_type: file.type,
    size: file.size,
  });
});

mediaRoutes.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT m.*, u.name AS uploader_name FROM media_assets m
     LEFT JOIN users u ON u.id = m.uploaded_by ORDER BY m.created_at DESC LIMIT 200`,
  ).all();
  return c.json({ media: results });
});

// تنزيل/عرض الوسيط من R2 — يدعم الاستعراض المباشر، التنزيل (?download=1)، وطلبات النطاق (تشغيل الفيديو/الصوت)
mediaRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const asset = await c.env.DB.prepare(
    'SELECT r2_key, mime_type, filename FROM media_assets WHERE id = ?',
  )
    .bind(id)
    .first<{ r2_key: string; mime_type: string | null; filename: string | null }>();
  if (!asset) return c.json({ error: 'غير موجود' }, 404);

  const rangeHeader = c.req.header('range');
  let range: R2Range | undefined;
  if (rangeHeader) {
    const m = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
    if (m) {
      const offset = m[1] ? Number(m[1]) : undefined;
      const end = m[2] ? Number(m[2]) : undefined;
      if (offset !== undefined && end !== undefined) range = { offset, length: end - offset + 1 };
      else if (offset !== undefined) range = { offset };
      else if (end !== undefined) range = { suffix: end };
    }
  }

  const object = await c.env.MEDIA.get(asset.r2_key, range ? { range } : undefined);
  if (!object) return c.json({ error: 'الملف غير موجود في التخزين' }, 404);

  const headers = new Headers();
  headers.set('content-type', asset.mime_type || 'application/octet-stream');
  headers.set('cache-control', 'private, max-age=3600');
  headers.set('accept-ranges', 'bytes');

  const download = c.req.query('download') === '1';
  if (download) {
    const name = (asset.filename || `${id}`).replace(/["\\]/g, '');
    headers.set('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
  }

  if (range && object.range && 'offset' in (object.range as any)) {
    const off = (object.range as any).offset || 0;
    const len = (object.range as any).length ?? object.size - off;
    headers.set('content-range', `bytes ${off}-${off + len - 1}/${object.size}`);
    headers.set('content-length', String(len));
    return new Response(object.body, { status: 206, headers });
  }

  headers.set('content-length', String(object.size));
  return new Response(object.body, { headers });
});

// توليد محتوى من وسيط (صورة أو PDF عبر رؤية Claude؛ غيرها يعتمد على الاسم)
mediaRoutes.post('/:id/generate', requirePermission('ai.generate'), async (c) => {
  const id = c.req.param('id');
  const asset = await c.env.DB.prepare(
    'SELECT r2_key, mime_type, filename, size FROM media_assets WHERE id = ?',
  )
    .bind(id)
    .first<{ r2_key: string; mime_type: string | null; filename: string | null; size: number | null }>();
  if (!asset) return c.json({ error: 'غير موجود' }, 404);

  const opts = await c.req.json<any>().catch(() => ({}));
  const mime = asset.mime_type || '';
  const canVision = mime.startsWith('image/') || mime === 'application/pdf';

  try {
    let base64: string | undefined;
    if (canVision) {
      if ((asset.size || 0) > 5 * 1024 * 1024) {
        return c.json({ error: 'حجم الملف كبير على التحليل (الحد ٥ ميغابايت)' }, 400);
      }
      const object = await c.env.MEDIA.get(asset.r2_key);
      if (!object) return c.json({ error: 'الملف غير موجود في التخزين' }, 404);
      base64 = toBase64(await object.arrayBuffer());
    }
    const text = await generateFromMedia(c.env, {
      base64,
      mimeType: mime,
      filename: asset.filename || 'ملف',
      options: opts,
    });
    return c.json({ text });
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, 502);
  }
});

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
