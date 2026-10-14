import type { Env } from '../types';

/* ═══ تغطية الصندوق: أيّ المنشورات تُقرأ تعليقاتها وأيّها لا ═══

   التعليقات تُسحب لكل منشورٍ على حدة، من لقطات التحليلات وحدها. فما لا يظهر
   في الصندوق سببُه في هذه اللقطات: منشورٌ لم يُكتشف، أو اكتُشف بمعرّف مزوّدٍ
   سابق (Buffer أو SocialAPI) فيردّه Ayrshare «غير موجود» بصمت، أو حُفظ باسم
   منصةٍ لا يعرفه السحب (`twitter` لا `x`)، أو بلا تاريخ نشر فلا يُسأل عنه.

   قراءةٌ من قاعدة البيانات وحدها — لا طلب إلى المزوّد ولا كتابة — تُعدّ هذه
   الأسباب لكل منصة، ليُبنى الإصلاح على أرقامٍ لا على ظنّ. */

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
  read_without_comments: number;
  with_comments: number;
  oldest_post: string | null;
  newest_post: string | null;
};

export async function commentsCoverage(env: Env): Promise<{
  platforms: PlatformCoverage[];
  comments: { platform: string; count: number; oldest: string | null }[];
  history: { account: string; state: string | null }[];
}> {
  const cutoff = new Date(Date.now() - RECENT_DAYS * 86_400_000).toISOString();
  const { results } = await env.DB.prepare(
    `SELECT s.platform,
       COUNT(*) AS posts,
       SUM(CASE WHEN s.sent_at IS NULL THEN 1 ELSE 0 END) AS no_date,
       SUM(CASE WHEN s.sent_at < ? THEN 1 ELSE 0 END) AS older_than_30d,
       SUM(CASE WHEN s.provider_post_id LIKE '%:' || s.platform
                  OR (length(s.provider_post_id) = 24 AND s.provider_post_id NOT GLOB '*[^0-9a-f]*'
                      AND s.provider_post_id GLOB '*[a-f]*')
                THEN 1 ELSE 0 END) AS legacy_id,
       SUM(CASE WHEN s.native_post_id IS NOT NULL AND s.native_post_id <> s.provider_post_id THEN 1 ELSE 0 END) AS legacy_resolved,
       SUM(CASE WHEN st.inbox_post_id IS NULL THEN 1 ELSE 0 END) AS never_read,
       SUM(CASE WHEN st.inbox_post_id IS NOT NULL AND c.n IS NULL THEN 1 ELSE 0 END) AS read_without_comments,
       SUM(CASE WHEN c.n IS NOT NULL THEN 1 ELSE 0 END) AS with_comments,
       MIN(s.sent_at) AS oldest_post,
       MAX(s.sent_at) AS newest_post
     FROM analytics_snapshots s
     LEFT JOIN (SELECT DISTINCT inbox_post_id FROM inbox_post_state WHERE account_id LIKE 'ayrshare:%') st
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

  const { results: comments } = await env.DB.prepare(
    `SELECT platform, COUNT(*) AS count, MIN(created_at) AS oldest FROM platform_comments
     WHERE kind = 'comment' GROUP BY platform ORDER BY count DESC`,
  ).all<{ platform: string; count: number; oldest: string | null }>();

  const { results: history } = await env.DB.prepare(
    "SELECT substr(key, length('account_history:') + 1) AS account, value AS state FROM settings WHERE key LIKE 'account_history:%'",
  ).all<{ account: string; state: string | null }>();

  return {
    platforms: results.map((r) => ({ ...r, recognised: COMMENT_PLATFORM_KEYS.includes(r.platform) })),
    comments,
    history,
  };
}
