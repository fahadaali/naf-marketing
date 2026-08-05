/**
 * ===== واجهة الموقع الرئيسي =====
 *
 * الطرف المقابل لما بناه `naf-home` وينتظره: عقدُه محدَّدٌ هناك في
 * `src/lib/newsletter/client.ts`، وهذه النقاط تُوفّيه حرفاً بحرف. تغييرُ
 * شكلٍ هنا يكسر الموقع صامتاً — يردّ العميل `newsletter_contract_mismatch`
 * ويسجّلها في «آخر مزامنة» ولا يظهر للزائر شيء.
 *
 *   POST /api/public/subscribe     ← نموذج النشرة في الموقع
 *   POST /api/public/unsubscribe   ← طلب إلغاء من الموقع
 *   GET  /api/public/issues        → النشرات المرسَلة، لتُستورد مقالات
 *
 * والمصادقة رمزٌ مشترك واحد: `SITE_API_TOKEN` هنا هو `NEWSLETTER_API_TOKEN`
 * هناك. المقارنة ثابتة الزمن لأن الرمز سرّ، ومقارنة `===` تتسرّب بزمنها.
 */
import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { newId } from '../util';
import { parseBlocks, renderBlocks, publicSettings } from '../services/newsletter';

export const siteApiRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const token = () => newId('tok') + newId('tok');

/** مقارنة ثابتة الزمن — لا تُفشي طول المطابقة بزمن الردّ. */
function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

siteApiRoutes.use('*', async (c, next) => {
  const expected = (c.env.SITE_API_TOKEN || '').trim();
  if (!expected) return c.json({ error: 'SITE_API_TOKEN غير مضبوط في المنصة' }, 503);

  const provided = (c.req.header('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!sameSecret(expected, provided)) return c.json({ error: 'غير مصرّح' }, 401);

  await next();
});

/* ═══ المشتركون ═══ */

/**
 * الاشتراك من الموقع. المنصّة هي سجلّ المشتركين، والموقع يحتفظ بنسخته
 * سجلَّ إرسالٍ لا مصدرَ حقيقة — فما يصل هنا يُدرج أو يُحدَّث ولا يُرفض
 * لتكراره: الزائر الذي يشترك مرّتين لم يُخطئ.
 *
 * ومن ألغى ثم عاد يشترك بنفسه يُعاد تفعيله — وهذا فعلُه هو، لا استرجاعُ
 * موافقةٍ سحبها غيره.
 */
siteApiRoutes.post('/subscribe', async (c) => {
  const body = await c.req.json<{ email?: string; name?: string; locale?: string }>().catch(() => null);
  const email = (body?.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return c.json({ error: 'البريد الإلكتروني غير صالح' }, 400);

  const tags = body?.locale ? JSON.stringify([`locale:${body.locale}`]) : null;

  await c.env.DB.prepare(
    `INSERT INTO subscribers (id, email, name, status, tags, consent_source, consent_at, token)
     VALUES (?, ?, ?, 'active', ?, 'website', strftime('%Y-%m-%dT%H:%M:%SZ','now'), ?)
     ON CONFLICT(email) DO UPDATE SET
       name = COALESCE(NULLIF(excluded.name, ''), subscribers.name),
       tags = COALESCE(subscribers.tags, excluded.tags),
       status = CASE WHEN subscribers.status = 'unsubscribed' THEN 'active' ELSE subscribers.status END,
       unsubscribed_at = NULL`,
  )
    .bind(newId('sub'), email, body?.name || null, tags, token())
    .run();

  const row = await c.env.DB.prepare('SELECT status FROM subscribers WHERE email = ?')
    .bind(email)
    .first<{ status: string }>();

  return c.json({ ok: true, status: row?.status || 'active' });
});

/**
 * إلغاء الاشتراك من الموقع. لا يُحذف السجل: الحذف يفتح الباب لإعادة
 * إدراج البريد نفسه في استيرادٍ لاحق، فتصل الرسالةُ من سحب موافقته.
 * ومن لا سجلّ له يُردّ بـ ok كذلك — لا يُفشى وجود بريدٍ من عدمه.
 */
siteApiRoutes.post('/unsubscribe', async (c) => {
  const body = await c.req.json<{ email?: string }>().catch(() => null);
  const email = (body?.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return c.json({ error: 'البريد الإلكتروني غير صالح' }, 400);

  await c.env.DB.prepare(
    `UPDATE subscribers
     SET status = 'unsubscribed', unsubscribed_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
     WHERE email = ?`,
  )
    .bind(email)
    .run();

  return c.json({ ok: true });
});

/* ═══ النشرات ═══ */

type IssueRow = {
  id: string;
  title: string;
  subject: string | null;
  excerpt: string | null;
  blocks_json: string;
  cover_media_id: string | null;
  sent_at: string | null;
  segment_tag: string | null;
};

/**
 * النشرات المرسَلة، أقدمها أولاً بعد `since`.
 *
 * الترتيب تصاعديّ ومؤشّر الاستئناف `next_since` آخرُ ما سُلّم: الموقع
 * يسحب على دفعات ويحفظ الوقت، فترتيبٌ تنازليّ يجعله يستأنف من الأحدث
 * ويُسقط ما بينهما إلى الأبد.
 *
 * والمعيار `status='sent'` وحده لا `web_published`: صفحة المقالة في
 * المنصّة وجهةٌ مستقلّة عن الموقع، وللموقع بوّابته — `newsletter.autoPublish`
 * فيه يُبقيها مسودّةً حتى يراجعها محرّره. فاشتراط العَلَمين يعني نشرةً
 * أُرسلت ولا تصل الموقع بلا سببٍ ظاهر.
 */
siteApiRoutes.get('/issues', async (c) => {
  const since = (c.req.query('since') || '').trim();
  const limit = Math.min(50, Math.max(1, Number.parseInt(c.req.query('limit') || '50', 10) || 50));

  const binds: unknown[] = [];
  let clause = "WHERE status = 'sent' AND sent_at IS NOT NULL";
  if (since) {
    clause += ' AND sent_at > ?';
    binds.push(since);
  }

  const { results } = await c.env.DB.prepare(
    `SELECT id, title, subject, excerpt, blocks_json, cover_media_id, sent_at, segment_tag
     FROM newsletters ${clause} ORDER BY sent_at ASC LIMIT ?`,
  )
    .bind(...binds, limit)
    .all<IssueRow>();

  const { base } = await publicSettings(c.env, c.req.url);
  const items = (results || []).map((row) => issuePayload(row, base));

  return c.json({
    items,
    next_since: items.length ? (items[items.length - 1]?.sent_at ?? null) : null,
  });
});

/**
 * شكل النشرة كما ينتظره الموقع.
 *
 * والنشرة هنا بلغة واحدة — العربية — والحقول الإنجليزية تُترك فارغة لا
 * منسوخةً عن العربية: الموقع يُخفي النسخة الإنجليزية لما لا ترجمة له
 * (قاعدته في `bilingual`)، ونسخُ العربي في خانة الإنجليزي يجعله يعرض
 * عربياً في صفحةٍ إنجليزية ويعدّها مترجمة.
 *
 * وصور الكتل تُحوَّل إلى المسار العام: `/api/media/:id` محروس بالجلسة،
 * فلو بقي لجلب الموقعُ صورةً يردّ عليها ٤٠١ ويُسقطها بلا أثر.
 */
function issuePayload(row: IssueRow, base: string) {
  const html = renderBlocks(parseBlocks(row.blocks_json), 'web', base).replaceAll(
    `${base}/api/media/`,
    `${base}/api/public-media/`,
  );

  return {
    id: row.id,
    subject_ar: row.subject || row.title,
    subject_en: null,
    html_ar: html,
    html_en: null,
    excerpt_ar: row.excerpt,
    excerpt_en: null,
    cover_image_url: row.cover_media_id ? `${base}/api/public-media/${row.cover_media_id}` : null,
    tags: row.segment_tag ? [row.segment_tag] : null,
    sent_at: row.sent_at,
    status: 'sent',
  };
}

export { issuePayload };
export type { IssueRow };
