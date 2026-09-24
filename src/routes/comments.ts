import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth, requirePermission } from '../middleware';
import {
  syncComments, readInboxReport, replyToComment, moderateComment, privateReplyToComment, editReply, deleteReply,
} from '../services/commentsSync';
import type { ModerateAction } from '../adapters/provider';
import { suggestReplies } from '../services/claude';
import { htmlToText } from '../util';

export const commentRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

commentRoutes.use('*', requireAuth);
commentRoutes.use('*', requirePermission('comments.manage'));

/** عناصر الصفحة الواحدة — والصفحات تُتبع بالسابق والتالي. */
const PAGE_SIZE = 100;

/* قائمة التعليقات/الرسائل مع فلاتر (platform, replied) ونطاقٍ زمني (from, to).
   وكانت أحدثَ مئتين بلا نطاقٍ ولا صفحة — فما قبلها لا يُرى وإن كان محفوظاً.
   والنطاق لحظتان `ISO` بتوقيت الرياض تحسبهما الشاشة، كما في لوحة التحليلات. */
commentRoutes.get('/', async (c) => {
  const platform = c.req.query('platform');
  const replied = c.req.query('replied'); // '1' | '0'
  const from = c.req.query('from');
  const to = c.req.query('to');
  const page = Math.max(1, Math.floor(Number(c.req.query('page')) || 1));

  // النطاق يحكم القائمة والأعداد معاً — تبويبٌ يعدّ ما لا تعرضه القائمة يكذب
  const range: string[] = [];
  const rangeBinds: unknown[] = [];
  if (from) { range.push('pc.created_at >= ?'); rangeBinds.push(from); }
  if (to) { range.push('pc.created_at <= ?'); rangeBinds.push(to); }

  const where = [...range];
  const binds = [...rangeBinds];
  if (platform) { where.push('pc.platform = ?'); binds.push(platform); }
  if (replied === '1') where.push('pc.reply_body IS NOT NULL');
  if (replied === '0') where.push('pc.reply_body IS NULL');
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // عنصرٌ زائد يقول إن بعد الصفحة صفحة — بلا عدٍّ ثانٍ
  const { results } = await c.env.DB.prepare(
    `SELECT pc.*, p.title AS post_title, u.name AS replier_name
     FROM platform_comments pc
     LEFT JOIN content_posts p ON p.id = pc.post_id
     LEFT JOIN users u ON u.id = pc.replied_by
     ${clause}
     ORDER BY pc.created_at DESC, pc.id DESC
     LIMIT ? OFFSET ?`,
  )
    .bind(...binds, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE)
    .all();

  // أعداد لكل حالة في النطاق (بلا تأثّر بفلتر الرد) — لعرضها على أزرار التبويب
  const counts = await c.env.DB.prepare(
    `SELECT COUNT(*) AS all_count,
            SUM(CASE WHEN reply_body IS NULL THEN 1 ELSE 0 END) AS unreplied,
            SUM(CASE WHEN reply_body IS NOT NULL THEN 1 ELSE 0 END) AS replied
     FROM platform_comments pc ${range.length ? `WHERE ${range.join(' AND ')}` : ''}`,
  )
    .bind(...rangeBinds)
    .first<{ all_count: number; unreplied: number; replied: number }>();

  return c.json({
    comments: results.slice(0, PAGE_SIZE),
    page,
    hasMore: results.length > PAGE_SIZE,
    counts: { all: counts?.all_count || 0, unreplied: counts?.unreplied || 0, replied: counts?.replied || 0 },
    // تقرير آخر سحب — يقول للشاشة متى سُحب الصندوق وهل اكتمل وما تعذّر منه
    sync: await readInboxReport(c.env),
  });
});

/* جلب فوري (إضافةً إلى الدورة الآلية) — كاملٌ: صفحاتٌ أكثر، وكل منشور.
   والأعطال في تقرير الدورة لا في استثناء: نوعٌ تعذّر لا يُسقط ما قُرئ من غيره.
   ويُردّ ٥٠٢ حين لم يُقرأ شيءٌ أصلاً — مفتاحٌ مرفوض أو مزوّدٌ لا يجيب. */
commentRoutes.post('/refresh', async (c) => {
  const report = await syncComments(c.env, { mode: 'full', trigger: 'manual' });
  if (report && !report.ok && report.kinds.comment.ok !== true) {
    return c.json({ error: `تعذّر السحب. ${report.errors[0] ?? ''}`.trim(), report }, 502);
  }
  return c.json({ ok: true, added: report?.added ?? 0, report });
});

// تشخيص مؤقت: يُظهر الاستجابات الخام من SocialAPI لتحديد أسماء الحقول الفعلية
/* حُذف `‎/debug`: مسبارُ تطويرٍ يكشف ردّ المزوّد خاماً، بلا قارئ في
   الواجهة. وصحّة التكامل تُقرأ من `‎/api/socialapi/health` وهي المسجَّلة
   في الشاشة. ودالة `debugSocialApi` باقيةٌ في
   `adapters/socialapi.ts` لمن يحتاجها. */

// اقتراحات ذكاء اصطناعي للرد (٣ مقترحات متنوّعة قصيرة)
commentRoutes.post('/:id/suggest', async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT pc.body, pc.author_name, pc.platform, pc.kind, pc.rating, p.title AS post_title, p.body AS post_body
     FROM platform_comments pc LEFT JOIN content_posts p ON p.id = pc.post_id
     WHERE pc.id = ?`,
  )
    .bind(c.req.param('id'))
    .first<{ body: string; author_name: string; platform: string; kind: string; rating: number | null; post_title: string | null; post_body: string | null }>();
  if (!row) return c.json({ error: 'العنصر غير موجود' }, 404);

  // التقييم من عموده المخصّص، مع دعم السجلات القديمة التي ضُمّن فيها نصياً "(★4)"
  const legacy = /★\s*(\d)/.exec(row.author_name || '');
  const rating = row.rating ?? (legacy ? Number(legacy[1]) : null);
  const postText = row.post_title ? [row.post_title, htmlToText(row.post_body || '')].filter(Boolean).join('\n') : null;

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
