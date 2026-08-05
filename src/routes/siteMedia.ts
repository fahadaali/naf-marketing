/**
 * ===== وسائط المحتوى المنشور =====
 *
 * ‏`/api/media/:id` محروسٌ بالجلسة، وهذا صحيحٌ لمكتبة المنصّة. لكن صور
 * النشرة المرسَلة ليست مكتبة: هي داخل مقالةٍ عامة وداخل بريدٍ وصل مئات
 * الصناديق. والموقع يجلبها بطلبٍ عاديّ بلا ترويسة — كذلك يفعل زاحف
 * جوجل وبطاقةُ المشاركة — فيردّ الحارس ٤٠١ وتسقط الصورة صامتة.
 *
 * فهذا المسار يخدم الأصل بلا مصادقة، بشرطٍ واحد: أن يكون مذكوراً في
 * نشرةٍ أُرسلت أو نُشرت صفحتها. ما لم يُنشر لا يخرج، ولو عُرف معرّفه.
 */
import { Hono } from 'hono';
import type { Env, Variables } from '../types';

export const siteMediaRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/** سنةٌ كاملة: المعرّف فريدٌ ولا يتبدّل محتواه تحته. */
const IMMUTABLE = 'public, max-age=31536000, immutable';

siteMediaRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');

  /*
   * الغلاف عمودٌ صريح، وصور المتن داخل الكتل نصّاً. و`LIKE` على
   * `blocks_json` يكفي: المعرّفات مولّدة بسابقةٍ ثابتة وطولٍ ثابت فلا
   * يقع جزءاً من معرّفٍ آخر، والبديل — فكّ الكتل لكل صفٍّ عند كل طلب —
   * قراءةُ الجدول كلّه لأجل صورة.
   */
  const referenced = await c.env.DB.prepare(
    `SELECT 1 FROM newsletters
     WHERE (status = 'sent' OR web_published = 1)
       AND (cover_media_id = ? OR blocks_json LIKE ?)
     LIMIT 1`,
  )
    .bind(id, `%${id}%`)
    .first<{ 1: number }>();

  if (!referenced) return c.json({ error: 'غير موجود' }, 404);

  const asset = await c.env.DB.prepare('SELECT r2_key, mime_type FROM media_assets WHERE id = ?')
    .bind(id)
    .first<{ r2_key: string; mime_type: string | null }>();
  if (!asset) return c.json({ error: 'غير موجود' }, 404);

  const object = await c.env.MEDIA.get(asset.r2_key);
  if (!object) return c.json({ error: 'غير موجود' }, 404);

  return new Response(object.body, {
    headers: {
      'content-type': asset.mime_type || 'application/octet-stream',
      'cache-control': IMMUTABLE,
      etag: object.httpEtag,
    },
  });
});
