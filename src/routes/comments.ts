import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth, requirePermission } from '../middleware';
import { syncComments, replyToComment, moderateComment, privateReplyToComment, editReply, deleteReply } from '../services/commentsSync';
import type { ModerateAction } from '../adapters/provider';
import { providerKey } from '../adapters';
import { debugSocialApi } from '../adapters/socialapi';
import { suggestReplies } from '../services/claude';

export const commentRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

commentRoutes.use('*', requireAuth);
commentRoutes.use('*', requirePermission('comments.manage'));

// قائمة التعليقات/الرسائل مع فلاتر (platform, replied)
commentRoutes.get('/', async (c) => {
  const platform = c.req.query('platform');
  const replied = c.req.query('replied'); // '1' | '0'
  const where: string[] = [];
  const binds: unknown[] = [];
  if (platform) { where.push('pc.platform = ?'); binds.push(platform); }
  if (replied === '1') where.push('pc.reply_body IS NOT NULL');
  if (replied === '0') where.push('pc.reply_body IS NULL');
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const { results } = await c.env.DB.prepare(
    `SELECT pc.*, p.title AS post_title, u.name AS replier_name
     FROM platform_comments pc
     LEFT JOIN content_posts p ON p.id = pc.post_id
     LEFT JOIN users u ON u.id = pc.replied_by
     ${clause}
     ORDER BY pc.created_at DESC LIMIT 200`,
  )
    .bind(...binds)
    .all();

  // أعداد لكل حالة (بلا تأثّر بفلتر الرد) — لعرضها على أزرار التبويب
  const counts = await c.env.DB.prepare(
    `SELECT COUNT(*) AS all_count,
            SUM(CASE WHEN reply_body IS NULL THEN 1 ELSE 0 END) AS unreplied,
            SUM(CASE WHEN reply_body IS NOT NULL THEN 1 ELSE 0 END) AS replied
     FROM platform_comments`,
  ).first<{ all_count: number; unreplied: number; replied: number }>();

  return c.json({
    comments: results,
    counts: { all: counts?.all_count || 0, unreplied: counts?.unreplied || 0, replied: counts?.replied || 0 },
  });
});

// جلب فوري (إضافةً إلى الدورة الآلية كل ساعة)
commentRoutes.post('/refresh', async (c) => {
  try {
    const added = await syncComments(c.env);
    return c.json({ ok: true, added });
  } catch (e: any) {
    return c.json({ error: `فشل جلب التعليقات: ${String(e?.message || e)}` }, 502);
  }
});

// تشخيص مؤقت: يُظهر الاستجابات الخام من SocialAPI لتحديد أسماء الحقول الفعلية
commentRoutes.get('/debug', async (c) => {
  const token = providerKey(c.env, 'socialapi');
  if (!token) return c.json({ error: 'لا يوجد مفتاح SocialAPI' }, 400);
  try {
    return c.json(await debugSocialApi(token));
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, 502);
  }
});

// اقتراحات ذكاء اصطناعي للرد (٣ مقترحات متنوّعة قصيرة)
commentRoutes.post('/:id/suggest', async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT pc.body, pc.author_name, pc.platform, pc.kind, p.title AS post_title, p.body AS post_body
     FROM platform_comments pc LEFT JOIN content_posts p ON p.id = pc.post_id
     WHERE pc.id = ?`,
  )
    .bind(c.req.param('id'))
    .first<{ body: string; author_name: string; platform: string; kind: string; post_title: string | null; post_body: string | null }>();
  if (!row) return c.json({ error: 'العنصر غير موجود' }, 404);

  // نستخرج التقييم من الاسم إن كان تقييماً (مثال: "فلان (★4)")
  const m = /★\s*(\d)/.exec(row.author_name || '');
  const rating = m ? Number(m[1]) : null;
  const postText = row.post_title ? [row.post_title, row.post_body].filter(Boolean).join('\n') : null;

  try {
    const suggestions = await suggestReplies(c.env, {
      commentBody: row.body || '',
      authorName: (row.author_name || '').replace(/\s*\(★\d\)\s*$/, ''),
      platform: row.platform,
      kind: row.kind,
      rating,
      postText,
    });
    return c.json({ suggestions });
  } catch (e: any) {
    return c.json({ error: `تعذّر توليد الاقتراحات: ${String(e?.message || e)}` }, 502);
  }
});

// الرد على تعليق/رسالة
commentRoutes.post('/:id/reply', async (c) => {
  const { text } = await c.req.json<{ text: string }>();
  if (!text?.trim()) return c.json({ error: 'اكتب نص الرد' }, 400);
  try {
    await replyToComment(c.env, c.req.param('id'), text.trim(), c.get('user').id);
    return c.json({ ok: true });
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, 502);
  }
});

// تعديل ردّي على المنصة
commentRoutes.patch('/:id/reply', async (c) => {
  const { text } = await c.req.json<{ text: string }>();
  if (!text?.trim()) return c.json({ error: 'اكتب نص الرد' }, 400);
  try {
    await editReply(c.env, c.req.param('id'), text.trim(), c.get('user').id);
    return c.json({ ok: true });
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, 502);
  }
});

// حذف ردّي من المنصة
commentRoutes.delete('/:id/reply', async (c) => {
  try {
    await deleteReply(c.env, c.req.param('id'));
    return c.json({ ok: true });
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, 502);
  }
});

// إشراف على تعليق: إخفاء/إظهار/حذف/إعجاب
commentRoutes.post('/:id/moderate', async (c) => {
  const { action } = await c.req.json<{ action: ModerateAction }>();
  if (!['hide', 'unhide', 'delete', 'like'].includes(action)) return c.json({ error: 'إجراء غير صالح' }, 400);
  try {
    await moderateComment(c.env, c.req.param('id'), action);
    return c.json({ ok: true });
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, 502);
  }
});

// رد خاص لصاحب التعليق (Instagram/Facebook)
commentRoutes.post('/:id/private-reply', async (c) => {
  const { text } = await c.req.json<{ text: string }>();
  if (!text?.trim()) return c.json({ error: 'اكتب نص الرد' }, 400);
  try {
    await privateReplyToComment(c.env, c.req.param('id'), text.trim(), c.get('user').id);
    return c.json({ ok: true });
  } catch (e: any) {
    return c.json({ error: String(e?.message || e) }, 502);
  }
});
