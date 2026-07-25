import { Hono } from 'hono';
import type { Env, Variables } from '../types';

// مسارات تتبّع البريد (عامة بلا مصادقة — يفتحها عميل البريد نفسه).
// التتبّع أفضل جهد: أي فشل لا يُعطّل عرض الصورة أو التحويل للرابط.
export const emailTrackRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// صورة شفافة 1×1 (GIF) — تُعاد دائماً حتى لو فشل التسجيل
const PIXEL = Uint8Array.from(
  atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),
  (ch) => ch.charCodeAt(0),
);

// بكسل الفتح: /e/o/<sendId>.gif
emailTrackRoutes.get('/o/:file', async (c) => {
  const sendId = c.req.param('file').replace(/\.gif$/i, '');
  try {
    await c.env.DB.prepare(
      `UPDATE newsletter_sends
         SET opened_at = COALESCE(opened_at, strftime('%Y-%m-%dT%H:%M:%SZ','now')),
             open_count = open_count + 1
       WHERE id = ?`,
    ).bind(sendId).run();
  } catch { /* التتبّع أفضل جهد */ }

  return new Response(PIXEL, {
    headers: {
      'content-type': 'image/gif',
      'cache-control': 'no-store, no-cache, must-revalidate, private',
      'content-length': String(PIXEL.length),
    },
  });
});

// تحويل النقر: /e/c/<sendId>?u=<url>
emailTrackRoutes.get('/c/:sendId', async (c) => {
  const sendId = c.req.param('sendId');
  const target = c.req.query('u') || '';

  // نقبل http/https فقط — منعاً لتحويل مفتوح إلى مخططات خطرة
  let dest: URL;
  try {
    dest = new URL(target);
    if (dest.protocol !== 'http:' && dest.protocol !== 'https:') throw new Error('bad protocol');
  } catch {
    return c.text('رابط غير صالح', 400);
  }

  try {
    await c.env.DB.prepare(
      `UPDATE newsletter_sends
         SET clicked_at = COALESCE(clicked_at, strftime('%Y-%m-%dT%H:%M:%SZ','now')),
             click_count = click_count + 1,
             opened_at = COALESCE(opened_at, strftime('%Y-%m-%dT%H:%M:%SZ','now'))
       WHERE id = ?`,
    ).bind(sendId).run();
  } catch { /* التتبّع أفضل جهد — التحويل أهم */ }

  return c.redirect(dest.toString(), 302);
});


