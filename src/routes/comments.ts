import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth, requirePermission } from '../middleware';
import {
  syncComments, readInboxReport, replyToComment, moderateComment, privateReplyToComment, editReply, deleteReply,
} from '../services/commentsSync';
import type { ModerateAction } from '../adapters/provider';
import { providerKey } from '../adapters';
import { diagnoseInbox } from '../adapters/socialapi';
import { suggestReplies } from '../services/claude';
import { htmlToText } from '../util';
import { parseThread } from '../services/inboxThread';
import { commentsCoverage } from '../services/commentsCoverage';

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
  const replied = c.req.query('replied'); // '1' | '0' | 'ignored'
  // مصدر الرد: `external` كتبه الفريق في تطبيق المنصة، و`platform` كُتب من هنا
  const source = c.req.query('source');
  const from = c.req.query('from');
  const to = c.req.query('to');
  const page = Math.max(1, Math.floor(Number(c.req.query('page')) || 1));

  /* النطاق والمنصة يحكمان القائمة والأعداد معاً — تبويبٌ يعدّ ما لا تعرضه
     القائمة يكذب. وكانت المنصة تُرشّح القائمة وحدها. */
  const range: string[] = [];
  const rangeBinds: unknown[] = [];
  if (from) { range.push('pc.created_at >= ?'); rangeBinds.push(from); }
  if (to) { range.push('pc.created_at <= ?'); rangeBinds.push(to); }
  if (platform) { range.push('pc.platform = ?'); rangeBinds.push(platform); }

  const where = [...range];
  const binds = [...rangeBinds];
  /* المتجاهَل ما لم يُردّ عليه وتُجوهل — فلا يُعدّ «بلا رد». وما رُدّ عليه بعد
     تجاهله ردٌّ كغيره. */
  if (replied === '1') where.push('pc.reply_body IS NOT NULL');
  if (replied === '0') where.push('pc.reply_body IS NULL AND pc.ignored_at IS NULL');
  if (replied === 'ignored') where.push('pc.reply_body IS NULL AND pc.ignored_at IS NOT NULL');
  if (source === 'external' || source === 'platform') {
    where.push('pc.reply_body IS NOT NULL AND pc.reply_source = ?');
    binds.push(source);
  }
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
            SUM(CASE WHEN reply_body IS NULL AND ignored_at IS NULL THEN 1 ELSE 0 END) AS unreplied,
            SUM(CASE WHEN reply_body IS NOT NULL THEN 1 ELSE 0 END) AS replied,
            SUM(CASE WHEN reply_body IS NULL AND ignored_at IS NOT NULL THEN 1 ELSE 0 END) AS ignored
     FROM platform_comments pc ${range.length ? `WHERE ${range.join(' AND ')}` : ''}`,
  )
    .bind(...rangeBinds)
    .first<{ all_count: number; unreplied: number; replied: number; ignored: number }>();

  // منصّاتٌ لها عناصر في الصندوق — لقائمة «المنصة» في الشاشة
  const { results: platformRows } = await c.env.DB.prepare(
    'SELECT DISTINCT platform FROM platform_comments ORDER BY platform',
  ).all<{ platform: string }>();

  const comments = results.slice(0, PAGE_SIZE) as Record<string, unknown>[];
  await attachPosts(c.env, comments);

  return c.json({
    comments,
    page,
    hasMore: results.length > PAGE_SIZE,
    counts: {
      all: counts?.all_count || 0, unreplied: counts?.unreplied || 0, replied: counts?.replied || 0, ignored: counts?.ignored || 0,
    },
    platforms: platformRows.map((r) => r.platform),
    // تقرير آخر سحب — يقول للشاشة متى سُحب الصندوق وهل اكتمل وما تعذّر منه
    sync: await readInboxReport(c.env),
  });
});

/** معرّف المنشور على منصته من معرّف العنصر — Ayrshare `ayc|منصة|منشور|…`، وSocialAPI `منشور|حساب|تعليق`. */
export function postIdOfItem(providerCommentId: string): string | null {
  const parts = String(providerCommentId || '').split('|');
  if (parts[0] === 'ayc') return parts[2] || null;
  if (parts.length === 3 && !['ayd', 'ayr'].includes(parts[0])) return parts[0] || null;
  return null;
}

/* منشورُ العنصر: عنوانه ورابطه على منصته. والعناصر المسحوبة لا تحمل منشورها
   (`post_id` فارغ)، فكان سطر المنشور غائباً عنها كلّها — والمنشور معروفٌ في
   لقطات التحليلات بمعرّفه على منصته. */
async function attachPosts(env: Env, comments: Record<string, unknown>[]): Promise<void> {
  const ids = [...new Set(comments.map((c) => postIdOfItem(String(c.provider_comment_id ?? ''))).filter((v): v is string => !!v))];
  const posts = new Map<string, { title: string | null; external_url: string | null }>();
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const { results } = await env.DB.prepare(
      `SELECT a.provider_post_id, COALESCE(p.title, a.title) AS title, a.external_url
       FROM analytics_snapshots a LEFT JOIN content_posts p ON p.id = a.post_id
       WHERE a.provider_post_id IN (${chunk.map(() => '?').join(',')})`,
    ).bind(...chunk).all<{ provider_post_id: string; title: string | null; external_url: string | null }>();
    for (const r of results) posts.set(r.provider_post_id, r);
  }
  for (const c of comments) {
    const post = posts.get(postIdOfItem(String(c.provider_comment_id ?? '')) ?? '');
    if (!post) continue;
    if (!c.post_title && post.title) c.post_title = post.title;
    if (post.external_url) c.post_url = post.external_url;
  }
}

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

/* تشخيص الصندوق: بنية ردود المزوّد لا قيمُها — انظر `diagnoseInbox`. يُفتح
   في المتصفح بالجلسة نفسها، ولمدير الإعدادات وحده: فيه معرّفات الحسابات
   ومفاتيحها. وليس `‎/debug` المحذوف أدناه، فذاك كان يعيد الجواب خاماً. */
commentRoutes.get('/diagnose', requirePermission('settings.manage'), async (c) => {
  const key = providerKey(c.env, 'socialapi');
  if (!key) return c.json({ error: 'مفتاح SocialAPI غير مضبوط' }, 400);
  // يُفتح في المتصفح لا في الواجهة، وبعض متصفحات الجوال تقرأ JSON بلا ترميزٍ معلَن لاتينياً
  return c.json(await diagnoseInbox(key), 200, { 'Content-Type': 'application/json; charset=utf-8' });
});

/* تغطية الصندوق لكل منصة — لماذا لا تظهر تعليقات منشورٍ قديم أو منشورٍ من
   خارج المنصة. قراءةٌ من قاعدة البيانات وحدها، تُفتح في المتصفح بالجلسة نفسها. */
commentRoutes.get('/coverage', requirePermission('settings.manage'), async (c) => {
  return c.json(await commentsCoverage(c.env), 200, { 'Content-Type': 'application/json; charset=utf-8' });
});

// تشخيص مؤقت: يُظهر الاستجابات الخام من SocialAPI لتحديد أسماء الحقول الفعلية
/* حُذف `‎/debug`: مسبارُ تطويرٍ يكشف ردّ المزوّد خاماً، بلا قارئ في
   الواجهة. وصحّة التكامل تُقرأ من `‎/api/socialapi/health` وهي المسجَّلة
   في الشاشة. ودالة `debugSocialApi` باقيةٌ في
   `adapters/socialapi.ts` لمن يحتاجها. */

// اقتراحات ذكاء اصطناعي للرد (٣ مقترحات متنوّعة قصيرة)
commentRoutes.post('/:id/suggest', async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT pc.body, pc.author_name, pc.platform, pc.kind, pc.rating, pc.thread_json, p.title AS post_title, p.body AS post_body
     FROM platform_comments pc LEFT JOIN content_posts p ON p.id = pc.post_id
     WHERE pc.id = ?`,
  )
    .bind(c.req.param('id'))
    .first<{
      body: string; author_name: string; platform: string; kind: string; rating: number | null; thread_json: string | null;
      post_title: string | null; post_body: string | null;
    }>();
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
      thread: parseThread(row.thread_json),
    });
    return c.json({ suggestions });
  } catch (e: any) {
    return c.json({ error: `تعذّر توليد الاقتراحات: ${String(e?.message || e)}` }, 502);
  }
});

// الرد على تعليق/رسالة
commentRoutes.post('/:id/reply', async (c) => {
  // والرسالة الخاصة تُرسل بمرفقٍ وحده — من مكتبة الوسائط (`media_id`)
  const { text, media_id } = await c.req.json<{ text?: string; media_id?: string }>();
  if (!text?.trim() && !media_id) return c.json({ error: 'اكتب نص الرد' }, 400);
  try {
    await replyToComment(c.env, c.req.param('id'), (text || '').trim(), c.get('user').id, media_id || undefined);
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

/* تجاهلُ عنصرٍ لا يحتاج ردّاً، وإلغاؤه — في القاعدة وحدها، لا يمسّ المنصة. */
commentRoutes.post('/:id/ignore', async (c) => {
  const user = c.get('user');
  const r = await c.env.DB.prepare(
    "UPDATE platform_comments SET ignored_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'), ignored_by = ? WHERE id = ?",
  ).bind(user.id, c.req.param('id')).run();
  if (!r.meta.changes) return c.json({ error: 'العنصر غير موجود' }, 404);
  return c.json({ ok: true });
});

commentRoutes.delete('/:id/ignore', async (c) => {
  const r = await c.env.DB.prepare('UPDATE platform_comments SET ignored_at = NULL, ignored_by = NULL WHERE id = ?')
    .bind(c.req.param('id')).run();
  if (!r.meta.changes) return c.json({ error: 'العنصر غير موجود' }, 404);
  return c.json({ ok: true });
});
