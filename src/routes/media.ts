import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth, requirePermission } from '../middleware';
import { newId } from '../util';
import { generateFromMedia } from '../services/claude';
import { generateImageAsset, startVideoJob, pollVideoJob } from '../services/mediaGen';
import { MAX_MEDIA_BYTES } from '../util';
import {
  IMAGE_SPECS, VIDEO_SPECS, FACEBOOK_REEL_MS, YOUTUBE_SHORT_MAX_MS, ADAPTABLE,
  adaptImage, frameImage, imageDims,
} from '../services/mediaSpecs';
import type { PublishMedia } from '../adapters/provider';

export const mediaRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

mediaRoutes.use('*', requireAuth);

// توليد صورة بالذكاء الاصطناعي (متزامن) — يعيد بيانات وسيط جاهزة للإدراج مباشرة
mediaRoutes.post('/generate/image', requirePermission('ai.generate'), async (c) => {
  const { prompt } = await c.req.json<{ prompt: string }>();
  if (!prompt?.trim()) return c.json({ error: 'أدخل وصفاً للصورة' }, 400);
  try {
    const asset = await generateImageAsset(c.env, prompt.trim(), c.get('user').id);
    return c.json({ ok: true, ...asset });
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, 502);
  }
});

// بدء توليد فيديو (غير متزامن) — يعيد معرّف مهمة يُستقصى دورياً
mediaRoutes.post('/generate/video', requirePermission('ai.generate'), async (c) => {
  const { prompt } = await c.req.json<{ prompt: string }>();
  if (!prompt?.trim()) return c.json({ error: 'أدخل وصفاً للفيديو' }, 400);
  const jobId = await startVideoJob(c.env, prompt.trim(), c.get('user').id);
  return c.json({ ok: true, jobId });
});

// استقصاء حالة مهمة فيديو
mediaRoutes.get('/generate/video/:jobId', requirePermission('ai.generate'), async (c) => {
  const job = await pollVideoJob(c.env, c.req.param('jobId'));
  if (!job) return c.json({ error: 'المهمة غير موجودة' }, 404);
  return c.json({
    status: job.status,
    error: job.error,
    media: job.media_asset_id ? { id: job.media_asset_id, url: `/api/media/${job.media_asset_id}` } : null,
  });
});

// رفع وسيط إلى R2 (multipart/form-data، الحقل: file)
mediaRoutes.post('/', requirePermission('media.upload'), async (c) => {
  const user = c.get('user');
  const form = await c.req.formData();
  const entry = form.get('file');
  if (!entry || typeof entry === 'string') return c.json({ error: 'لم يُرفق ملف' }, 400);
  const file = entry as unknown as File;
  /* الحدّ مكتوبٌ هنا صريحاً، وكان غائباً فيحكم ما يقبله كلاودفلير وحده
     ويُردّ ما فوقه بصفحة خطأٍ من الحافة لا برسالة. */
  if (file.size > MAX_MEDIA_BYTES) return c.json({ error: 'حجم الملف يتجاوز الحد المسموح' }, 413);

  const id = newId('media');
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
  const key = `${id}.${ext}`;
  await c.env.MEDIA.put(key, file.stream(), {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
  });

  const dims = await uploadDimensions(c.env, file, form);

  await c.env.DB.prepare(
    `INSERT INTO media_assets (id, r2_key, mime_type, size, uploaded_by, filename, width, height, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, key, file.type || null, file.size, user.id, file.name || null, dims.width, dims.height, dims.duration_ms)
    .run();

  return c.json({
    ok: true,
    id,
    key,
    url: `/api/media/${id}`,
    filename: file.name,
    mime_type: file.type,
    size: file.size,
    ...dims,
  });
});

/* ═══ أبعاد الوسيط ═══

   الصورة يقرؤها الخادم بربط `IMAGES` — وبدونه تبقى فارغة وتُقرأ عند النشر.
   والمقطع لا يملك العامل ما يقرؤه به، فيرسل المتصفح أبعاده ومدّته حقولاً
   مع الملف (قرأها من `<video>` قبل الرفع). */
type Dims = { width: number | null; height: number | null; duration_ms: number | null };

function positiveInt(v: unknown): number | null {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 && n < 1e9 ? n : null;
}

async function uploadDimensions(env: Env, file: File, form: FormData): Promise<Dims> {
  const none: Dims = { width: null, height: null, duration_ms: null };
  const mime = (file.type || '').toLowerCase();
  if (mime.startsWith('video/')) {
    return {
      width: positiveInt(form.get('width')),
      height: positiveInt(form.get('height')),
      duration_ms: positiveInt(form.get('duration_ms')),
    };
  }
  if (mime.startsWith('image/') && env.IMAGES) {
    try {
      const info = (await env.IMAGES.info(file.stream())) as { width?: number; height?: number };
      return { ...none, width: positiveInt(info.width), height: positiveInt(info.height) };
    } catch { /* صورةٌ لا يقرؤها الربط تبقى بلا أبعاد — وتُنشر كما هي */ }
  }
  return none;
}

// إكمال أبعاد مقطعٍ رُفع قبل حفظها — يرسلها المحرر حين يفتح محتواه.
// لا يكتب فوق قيمةٍ موجودة: ما قرأه الرفع أولى.
mediaRoutes.patch('/:id/meta', requirePermission('media.upload'), async (c) => {
  const b = await c.req.json<{ width?: number; height?: number; duration_ms?: number }>().catch(() => ({}) as any);
  const width = positiveInt(b.width);
  const height = positiveInt(b.height);
  const duration = positiveInt(b.duration_ms);
  if (!width && !height && !duration) return c.json({ error: 'لا أبعاد في الطلب' }, 400);
  await c.env.DB.prepare(
    `UPDATE media_assets SET width = COALESCE(width, ?), height = COALESCE(height, ?),
       duration_ms = COALESCE(duration_ms, ?) WHERE id = ?`,
  )
    .bind(width, height, duration, c.req.param('id'))
    .run();
  return c.json({ ok: true });
});

// مواصفات المنصات — تقرؤها المعاينة في المحرر لتعرف ما سيُكيَّف قبل الحفظ.
// المصدر واحد (`services/mediaSpecs.ts`)، والواجهة لا تحمل نسخةً منه.
mediaRoutes.get('/specs', (c) =>
  c.json({ image: IMAGE_SPECS, video: VIDEO_SPECS, facebook_reel_ms: FACEBOOK_REEL_MS, youtube_short_max_ms: YOUTUBE_SHORT_MAX_MS }),
);

mediaRoutes.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT m.*, u.name AS uploader_name FROM media_assets m
     LEFT JOIN users u ON u.id = m.uploaded_by ORDER BY m.created_at DESC LIMIT 200`,
  ).all();
  return c.json({ media: results });
});

/* ═══ الصورة كما ستصل المنصة ═══

   `?platform=snapchat` يردّ الصورة بعد تكييفها لتلك المنصة — الدالة نفسها
   التي تعمل عند النشر، فالمعاينة هي ما يُرسل حرفياً لا تقليدٌ له في CSS.
   و`?frame=portrait` يردّ إطار ‎1080×1920‎ أيّاً كانت نسبتها: منه يصنع
   المتصفح مقطع تيك توك من الصورة الواحدة.

   والوسيط لا يتغيّر بعد رفعه (يُستبدل بغيره ولا يُعدَّل)، فتُخزَّن النتيجة
   في ذاكرة الحافة بمعرّفه، ويُرفع رقم النسخة إن تغيّر التكييف نفسه. */
const ADAPT_VERSION = 'v1';
const PORTRAIT: [number, number] = [1080, 1920];

mediaRoutes.get('/:id/adapted', async (c) => {
  const id = c.req.param('id');
  const platform = c.req.query('platform') || '';
  const portrait = c.req.query('frame') === 'portrait';
  if (!portrait && !IMAGE_SPECS[platform]) return c.json({ error: 'منصةٌ لا تُكيَّف لها الصور' }, 400);
  if (!c.env.IMAGES) return c.json({ error: 'تكييف الصور غير متاح: ربط IMAGES غير مضبوط' }, 501);

  const asset = await c.env.DB.prepare(
    'SELECT r2_key, mime_type, filename, width, height FROM media_assets WHERE id = ?',
  )
    .bind(id)
    .first<{ r2_key: string; mime_type: string | null; filename: string | null; width: number | null; height: number | null }>();
  if (!asset) return c.json({ error: 'غير موجود' }, 404);
  if (!ADAPTABLE.has((asset.mime_type || '').toLowerCase())) return c.json({ error: 'هذا الوسيط ليس صورةً تُكيَّف' }, 400);

  const cache = typeof caches !== 'undefined' ? (caches as unknown as { default: Cache }).default : null;
  const key = new Request(`https://media-adapted.invalid/${ADAPT_VERSION}/${id}/${portrait ? 'portrait' : platform}`);
  const hit = await cache?.match(key);
  const headers = { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=3600' };
  if (hit) return new Response(hit.body, { headers: { ...headers, 'content-type': hit.headers.get('content-type') || 'image/jpeg' } });

  const m: PublishMedia = {
    open: async () => (await c.env.MEDIA.get(asset.r2_key))?.body ?? null,
    mimeType: asset.mime_type || 'image/jpeg',
    filename: asset.filename || id,
    width: asset.width,
    height: asset.height,
  };
  try {
    let out: PublishMedia;
    if (portrait) {
      const dims = await imageDims(c.env.IMAGES, m);
      if (!dims) return c.json({ error: 'تعذّرت قراءة أبعاد الصورة' }, 422);
      out = await frameImage(c.env.IMAGES, m, dims, PORTRAIT, 'portrait');
    } else {
      out = await adaptImage(c.env.IMAGES, platform, m);
    }
    // صورةٌ تقبلها المنصة كما هي تُردّ بأصلها
    const bytes = out.data ?? (await new Response(await m.open!()).arrayBuffer());
    const type = out.mimeType;
    await cache?.put(key, new Response(bytes.slice(0), { headers: { 'content-type': type, 'cache-control': 'max-age=2592000' } }));
    return new Response(bytes, { headers: { ...headers, 'content-type': type } });
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, 502);
  }
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
