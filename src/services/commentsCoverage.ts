import type { Env } from '../types';
import { readInboxHistoryReport, readInboxReport, type InboxSyncReport } from './commentsSync';
import { legacyKeySql } from './nativePostId';

/* ═══ تغطية الصندوق: أيّ المنشورات تُقرأ تعليقاتها وأيّها لا ═══

   التعليقات تُسحب لكل منشورٍ على حدة، من لقطات التحليلات وحدها. فما لا يظهر
   في الصندوق سببُه في هذه اللقطات: منشورٌ لم يُكتشف، أو اكتُشف بمعرّف مزوّدٍ
   سابق (Buffer أو SocialAPI) فيردّه Ayrshare «غير موجود» بصمت، أو حُفظ باسم
   منصةٍ لا يعرفه السحب (`twitter` لا `x`)، أو بلا تاريخ نشر فلا يُسأل عنه.

   قراءةٌ من قاعدة البيانات وحدها — لا طلب إلى المزوّد ولا كتابة — تُعدّ هذه
   الأسباب لكل منصة، ليُبنى الإصلاح على أرقامٍ لا على ظنّ.

   و«قُرئ بلا تعليقات» كان يجمع ثلاثاً لا يفرّقها: ردّ المزوّد بقائمةٍ فارغة،
   أو «غير موجود»، أو رفضاً يخصّ المنشور — فالمنشور يُختم مقروءاً في الثلاث.
   فتُعدّ كلٌّ منها وحدها بنتيجة آخر طلب (0049)، ويُقابَل ما وصل بعدد التعليقات
   الذي تعلنه تحليلات المنصة نفسها: منشورٌ تقول المنصة إن عليه تعليقات ولم
   يصلنا منها شيء هو موضع الخلل، لا ما سواه. */

/** مفاتيح المنصات التي يسحب لها `syncAyrshareComments` — كما يسمّيها `ayrshareAccountPlatform`. */
export const COMMENT_PLATFORM_KEYS = ['x', 'facebook', 'instagram', 'linkedin', 'linkedin_page', 'tiktok', 'youtube', 'threads'];

const RECENT_DAYS = 30;

export type PlatformCoverage = {
  platform: string;
  /** يعرفه سحب التعليقات باسمه هذا */
  recognised: boolean;
  posts: number;
  no_date: number;
  older_than_30d: number;
  /** معرّفٌ من مزوّدٍ سابق: نائبُ SocialAPI (`…:منصة`) أو معرّف Buffer (٢٤ خانة ست عشرية) */
  legacy_id: number;
  /** منها ما عُرف معرّفه الأصلي فتُطلب به تعليقاته */
  legacy_resolved: number;
  never_read: number;
  /** مجموع الأربعة التالية — قُرئ ولم يُحفظ له تعليق */
  read_without_comments: number;
  /** ردّ المزوّد بقائمةٍ لا تعليق فيها من غيرنا */
  read_empty: number;
  /** ردّه المزوّد «غير موجود»: حُذف، أو مفتاحه لا يعرفه */
  not_found: number;
  /** رفضه المزوّد لسببٍ يخصّه */
  rejected: number;
  /** قُرئ قبل أن تُحفظ نتيجة الطلب — يُعاد طلبه */
  outcome_unknown: number;
  with_comments: number;
  /** تعلن تحليلات المنصة أن عليه تعليقاً أو أكثر */
  analytics_with_comments: number;
  /** منها ما لم يُحفظ له تعليقٌ واحد */
  analytics_comments_missing: number;
  oldest_post: string | null;
  newest_post: string | null;
};

/** ملخّص دورةٍ للتغطية: ما ردّه المزوّد «غير موجود» أو رفضه لكل منصة، وأعطالها. */
export type SyncSummary = {
  at: string;
  complete: boolean;
  not_found: Record<string, number>;
  rejected: Record<string, number>;
  errors: string[];
} | null;

function summary(r: InboxSyncReport | null): SyncSummary {
  if (!r) return null;
  return { at: r.at, complete: r.complete, not_found: r.notFound ?? {}, rejected: r.rejected ?? {}, errors: r.errors };
}

/** منشورٌ يستحق النظر: رُفض، أو «غير موجود»، أو تعلن المنصة تعليقاته ولم يصل منها شيء،
    أو مفتاحه من مزوّدٍ سابق لم يُعرف معرّفه الأصلي فلا تُطلب تعليقاته. */
export type CoverageDetail = {
  platform: string;
  key: string;
  native: string | null;
  sent_at: string | null;
  url: string | null;
  /** عدد التعليقات كما تعلنه تحليلات المنصة */
  announced: number | null;
  outcome: 'ok' | 'not_found' | 'rejected' | 'unknown' | 'never_read';
  reason: 'rejected' | 'not_found' | 'comments_missing' | 'legacy_unresolved';
};

const DETAIL_LIMIT = 60;

export async function commentsCoverage(env: Env): Promise<{
  platforms: PlatformCoverage[];
  details: CoverageDetail[];
  comments: { platform: string; count: number; oldest: string | null }[];
  history: { account: string; state: string | null }[];
  last_sync: SyncSummary;
  last_history_sync: SyncSummary;
}> {
  const cutoff = new Date(Date.now() - RECENT_DAYS * 86_400_000).toISOString();
  /* المعرّف من مزوّدٍ سابق: نائب SocialAPI أو معرّف Buffer. و«عُرف معرّفه
     الأصلي» منها وحدها — وكانت تُعدّ كل لقطةٍ اختلف معرّفها الأصلي عن مفتاحها،
     فيظهر في تيك توك «عُرف» ما ليس من مزوّدٍ سابق أصلاً. */
  const legacy = legacyKeySql('s.provider_post_id', 's.platform');
  /* عدد التعليقات كما تعلنه تحليلات المنصة: عنصر `comments` في `metrics_json`
     (انظر `ayrshareMetrics`)، كما يقرؤه السحب نفسه في `commentsOf`. */
  const announced = `(SELECT CAST(json_extract(j.value, '$.value') AS INTEGER)
                      FROM json_each(CASE WHEN json_valid(s.metrics_json) THEN s.metrics_json ELSE '[]' END) j
                      WHERE j.type = 'object' AND json_extract(j.value, '$.type') = 'comments' LIMIT 1)`;
  const { results } = await env.DB.prepare(
    `SELECT s.platform,
       COUNT(*) AS posts,
       SUM(CASE WHEN s.sent_at IS NULL THEN 1 ELSE 0 END) AS no_date,
       SUM(CASE WHEN s.sent_at < ? THEN 1 ELSE 0 END) AS older_than_30d,
       SUM(CASE WHEN ${legacy} THEN 1 ELSE 0 END) AS legacy_id,
       SUM(CASE WHEN ${legacy} AND s.native_post_id IS NOT NULL AND s.native_post_id <> s.provider_post_id THEN 1 ELSE 0 END) AS legacy_resolved,
       SUM(CASE WHEN st.inbox_post_id IS NULL THEN 1 ELSE 0 END) AS never_read,
       SUM(CASE WHEN st.inbox_post_id IS NOT NULL AND c.n IS NULL THEN 1 ELSE 0 END) AS read_without_comments,
       SUM(CASE WHEN st.inbox_post_id IS NOT NULL AND c.n IS NULL AND st.rank = 4 THEN 1 ELSE 0 END) AS read_empty,
       SUM(CASE WHEN st.inbox_post_id IS NOT NULL AND c.n IS NULL AND st.rank = 2 THEN 1 ELSE 0 END) AS not_found,
       SUM(CASE WHEN st.inbox_post_id IS NOT NULL AND c.n IS NULL AND st.rank = 3 THEN 1 ELSE 0 END) AS rejected,
       SUM(CASE WHEN st.inbox_post_id IS NOT NULL AND c.n IS NULL AND st.rank = 1 THEN 1 ELSE 0 END) AS outcome_unknown,
       SUM(CASE WHEN c.n IS NOT NULL THEN 1 ELSE 0 END) AS with_comments,
       SUM(CASE WHEN COALESCE(${announced}, 0) > 0 THEN 1 ELSE 0 END) AS analytics_with_comments,
       SUM(CASE WHEN COALESCE(${announced}, 0) > 0 AND c.n IS NULL THEN 1 ELSE 0 END) AS analytics_comments_missing,
       MIN(s.sent_at) AS oldest_post,
       MAX(s.sent_at) AS newest_post
     FROM analytics_snapshots s
     LEFT JOIN (
       -- منشورٌ قُرئ من أكثر من حساب تُؤخذ أفضلُ نتائجه: قُرئ، ثم رُفض، ثم «غير موجود»
       SELECT inbox_post_id,
         MAX(CASE outcome WHEN 'ok' THEN 4 WHEN 'rejected' THEN 3 WHEN 'not_found' THEN 2 ELSE 1 END) AS rank
       FROM inbox_post_state WHERE account_id LIKE 'ayrshare:%'
       GROUP BY inbox_post_id
     ) st
       ON st.inbox_post_id = COALESCE(s.native_post_id, s.provider_post_id)
     LEFT JOIN (
       SELECT substr(rest, 1, instr(rest, '|') - 1) AS post, COUNT(*) AS n FROM (
         SELECT substr(after, instr(after, '|') + 1) AS rest FROM (
           SELECT substr(provider_comment_id, 5) AS after FROM platform_comments WHERE provider_comment_id LIKE 'ayc|%'
         )
       ) GROUP BY post
     ) c ON c.post = COALESCE(s.native_post_id, s.provider_post_id)
     WHERE s.provider_post_id IS NOT NULL AND COALESCE(s.source, '') <> 'newsletter'
     GROUP BY s.platform
     ORDER BY posts DESC`,
  ).bind(cutoff).all<Omit<PlatformCoverage, 'recognised'>>();

  const { results: rows } = await env.DB.prepare(
    `SELECT s.platform, s.provider_post_id AS key, s.native_post_id AS native, s.sent_at, s.external_url AS url,
       ${announced} AS announced,
       CASE WHEN st.inbox_post_id IS NULL THEN 'never_read'
            WHEN st.rank = 4 THEN 'ok' WHEN st.rank = 3 THEN 'rejected' WHEN st.rank = 2 THEN 'not_found' ELSE 'unknown' END AS outcome,
       CASE WHEN s.native_post_id IS NULL AND ${legacy} THEN 'legacy_unresolved'
            WHEN st.rank = 3 THEN 'rejected' WHEN st.rank = 2 THEN 'not_found'
            ELSE 'comments_missing' END AS reason
     FROM analytics_snapshots s
     LEFT JOIN (
       -- منشورٌ قُرئ من أكثر من حساب تُؤخذ أفضلُ نتائجه: قُرئ، ثم رُفض، ثم «غير موجود»
       SELECT inbox_post_id,
         MAX(CASE outcome WHEN 'ok' THEN 4 WHEN 'rejected' THEN 3 WHEN 'not_found' THEN 2 ELSE 1 END) AS rank
       FROM inbox_post_state WHERE account_id LIKE 'ayrshare:%'
       GROUP BY inbox_post_id
     ) st
       ON st.inbox_post_id = COALESCE(s.native_post_id, s.provider_post_id)
     LEFT JOIN (
       SELECT substr(rest, 1, instr(rest, '|') - 1) AS post, COUNT(*) AS n FROM (
         SELECT substr(after, instr(after, '|') + 1) AS rest FROM (
           SELECT substr(provider_comment_id, 5) AS after FROM platform_comments WHERE provider_comment_id LIKE 'ayc|%'
         )
       ) GROUP BY post
     ) c ON c.post = COALESCE(s.native_post_id, s.provider_post_id)
     WHERE s.provider_post_id IS NOT NULL AND COALESCE(s.source, '') <> 'newsletter'
       AND ((s.native_post_id IS NULL AND ${legacy}) OR st.rank IN (2, 3)
            OR (COALESCE(${announced}, 0) > 0 AND c.n IS NULL))
     ORDER BY s.platform, s.sent_at DESC
     LIMIT ${DETAIL_LIMIT}`,
  ).all<CoverageDetail>();

  const { results: comments } = await env.DB.prepare(
    `SELECT platform, COUNT(*) AS count, MIN(created_at) AS oldest FROM platform_comments
     WHERE kind = 'comment' GROUP BY platform ORDER BY count DESC`,
  ).all<{ platform: string; count: number; oldest: string | null }>();

  const { results: history } = await env.DB.prepare(
    "SELECT substr(key, length('account_history:') + 1) AS account, value AS state FROM settings WHERE key LIKE 'account_history:%'",
  ).all<{ account: string; state: string | null }>();

  return {
    platforms: results.map((r) => ({ ...r, recognised: COMMENT_PLATFORM_KEYS.includes(r.platform) })),
    details: rows,
    comments,
    history,
    last_sync: summary(await readInboxReport(env)),
    last_history_sync: summary(await readInboxHistoryReport(env)),
  };
}
