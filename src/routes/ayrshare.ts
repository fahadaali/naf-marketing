import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { requireAuth, requirePermission } from '../middleware';
import {
  ayrshareCall, ayrshareUser, isOwnAyrshareComment, ownerKey, youtubeChannelVideos, listAyrshareWebhooks, type AyrshareAuth,
} from '../adapters/ayrshare';
import { ayrshareAuth, providerKey } from '../adapters';
import { localSyncHealth } from './socialapi';

export const ayrshareRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

ayrshareRoutes.use('*', requireAuth);

/* صحّة التكامل بالشكل الذي يقرؤه `IntegrationHealth` في الإعدادات — كما يردّه
   `/socialapi/health`، فبطاقةٌ واحدة تعرض المزوّدَين ولا يُكتب لها نصٌّ جديد.

   ولا خريطة ربطٍ في Ayrshare: لكل منصةٍ حسابٌ واحد في الملف الرئيسي يُنشر
   إليه باسمها، فكل حسابٍ مربوطٍ لديه مربوطٌ عندنا. ولا حصّة تُعرض: خطة
   Launch بلا حدٍّ شهريٍّ للمنشورات. */
ayrshareRoutes.get('/health', requirePermission('settings.manage'), async (c) => {
  const key = providerKey(c.env, 'ayrshare');
  if (!key) return c.json({ configured: false });
  const auth: AyrshareAuth = { key };

  const out: Record<string, unknown> = { configured: true };
  const mapping: Record<string, string> = {};

  try {
    const { accounts, messagingEnabled } = await ayrshareUser(auth);
    out.accounts = accounts.map((a) => ({ id: a.id, platform: a.platform, name: a.name }));
    out.messaging_enabled = messagingEnabled;
    for (const a of accounts) mapping[a.platform] = a.id;
  } catch (e: any) { out.accounts_error = String(e?.message || e); }

  try {
    out.webhooks = (await listAyrshareWebhooks(auth)).map((h) => ({ id: h.event, url: h.url, is_active: true }));
  } catch (e: any) { out.webhooks_error = String(e?.message || e); }

  out.local = await localSyncHealth(c.env);
  out.mapping = mapping;

  return c.json(out);
});

/* ═══ التشخيص ═══

   ما يردّه Ayrshare فعلاً — لا ما يقوله توثيقه — في الموضعين اللذين لا يُعرف
   سببهما إلا بهذا: الردّ من تطبيق المنصة الذي لا يُكشف، ومقاطع يوتيوب القصيرة
   التي لا تظهر. يردّ الشكل والمعرّفات، وأسماءُ الكتّاب مقنّعةٌ كما في تشخيص
   SocialAPI ومع كلٍّ منها أهو حسابنا — ولا نصَّ تعليقٍ ولا رسالة. ونداءاته
   محدودة (سبعة على الأكثر). */

/** أوّل ثلاثة أحرفٍ وطولُ الباقي — تكفي لمقارنة كاتبٍ بحسابنا، ولا تكشف اسم عميل.
    كما في تشخيص SocialAPI (`maskKey`). */
function mask(v: unknown): string {
  const s = ownerKey(v);
  return s.length <= 3 ? '•'.repeat(s.length) : `${s.slice(0, 3)}…(${s.length})`;
}

/** هويّة الكاتب كما يردّها Ayrshare — مقنّعةً، ومع كلٍّ منها: أهي من مفاتيح حسابنا؟ */
function identity(c: any, owners: Set<string>) {
  const fields: Record<string, unknown> = {
    userName: c?.userName, username: c?.username, name: c?.name, displayName: c?.displayName,
    'from.id': c?.from?.id, 'from.name': c?.from?.name, 'from.username': c?.from?.username,
    userId: c?.userId, 'user.id': c?.user?.id,
  };
  const author: Record<string, { hint: string; ours: boolean }> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null || v === '') continue;
    author[k] = { hint: mask(v), ours: owners.has(ownerKey(v)) };
  }
  return {
    commentId: c?.commentId ?? c?.id ?? null,
    author,
    flags: { owner: c?.owner ?? null, company: c?.company ?? null, isReplyOwnedByMe: c?.isReplyOwnedByMe ?? null },
    refs: {
      parentId: c?.parentId ?? null,
      replyTo: c?.replyTo?.id ?? (typeof c?.replyTo === 'string' ? c.replyTo : null),
      referencedTweets: Array.isArray(c?.referencedTweets) ? c.referencedTweets : null,
    },
    keys: c && typeof c === 'object' ? Object.keys(c).sort() : [],
  };
}

ayrshareRoutes.get('/diagnose', requirePermission('settings.manage'), async (c) => {
  const auth: AyrshareAuth | null = ayrshareAuth(c.env);
  if (!auth) return c.json({ configured: false });
  return c.json(await diagnoseAyrshare(c.env, auth));
});

export async function diagnoseAyrshare(env: Env, auth: AyrshareAuth): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { configured: true, at: new Date().toISOString() };

  let owners: Record<string, string[]> = {};
  let channelId = '';
  try {
    const { accounts } = await ayrshareUser(auth);
    owners = Object.fromEntries(accounts.map((a) => [a.platform, a.ownerKeys]));
    channelId = accounts.find((a) => a.platform === 'youtube')?.channelId ?? '';
    out.owners = owners;
  } catch (e: any) {
    out.owners_error = String(e?.message || e);
  }

  // ١) منشوراتٌ عليها تعليقٌ بلا ردّ — أحدثُها، أربعةٌ على الأكثر
  const { results: open } = await env.DB.prepare(
    `SELECT provider_comment_id, platform, created_at FROM platform_comments
     WHERE kind = 'comment' AND reply_body IS NULL AND substr(provider_comment_id, 1, 4) = 'ayc|'
     ORDER BY created_at DESC LIMIT 40`,
  ).all<{ provider_comment_id: string; platform: string; created_at: string }>();
  const posts = new Map<string, { ayr: string; internal: string; postId: string; waiting: string[] }>();
  for (const r of open) {
    const [, ayr, postId, commentId] = r.provider_comment_id.split('|');
    const key = `${ayr}|${postId}`;
    if (!posts.has(key)) {
      if (posts.size >= 4) continue;
      posts.set(key, { ayr, internal: r.platform, postId, waiting: [] });
    }
    posts.get(key)!.waiting.push(commentId);
  }
  const inbox: unknown[] = [];
  for (const p of posts.values()) {
    const q = new URLSearchParams({ searchPlatformId: 'true', platform: p.ayr });
    try {
      const data = await ayrshareCall<any>(auth, 'GET', `/comments/${encodeURIComponent(p.postId)}?${q}`);
      const list: any[] = Array.isArray(data?.[p.ayr]) ? data[p.ayr] : [];
      const keys = owners[p.internal] ?? [];
      const ownSet = new Set(keys);
      inbox.push({
        platform: p.internal,
        postId: p.postId,
        waitingCommentIds: p.waiting,
        status: data?.status ?? null,
        topKeys: Object.keys(data || {}).sort(),
        count: list.length,
        entries: list.slice(0, 25).map((e) => ({
          ...identity(e, ownSet),
          isOwn: isOwnAyrshareComment(e, keys),
          replies: (Array.isArray(e?.replies) ? e.replies : []).slice(0, 10).map((r: any) => ({
            ...identity(r, ownSet),
            isOwn: isOwnAyrshareComment(r, keys),
          })),
        })),
      });
    } catch (e: any) {
      inbox.push({ platform: p.internal, postId: p.postId, error: String(e?.message || e) });
    }
  }
  out.inbox = inbox;

  /* ١ب) ردود لينكدإن تُطلب لكل تعليق — شكلُ ردّها لأوّل تعليقٍ ينتظر */
  const li = [...posts.values()].find((p) => p.ayr === 'linkedin');
  if (li) {
    const q = new URLSearchParams({ commentId: 'true', searchPlatformId: 'true', platform: 'linkedin' });
    try {
      const data = await ayrshareCall<any>(auth, 'GET', `/comments/${encodeURIComponent(li.waiting[0])}?${q}`);
      const block = data?.linkedin;
      const list: any[] = Array.isArray(block) ? block : block ? [block] : [];
      const ownSet = new Set(owners[li.internal] ?? []);
      out.linkedinReplies = {
        commentId: li.waiting[0],
        topKeys: Object.keys(data || {}).sort(),
        shape: Array.isArray(block) ? 'array' : typeof block,
        entries: list.slice(0, 10).map((e) => ({
          ...identity(e, ownSet),
          isOwn: isOwnAyrshareComment(e, owners[li.internal] ?? []),
          replies: (Array.isArray(e?.replies) ? e.replies : []).slice(0, 10).map((r: any) => ({
            ...identity(r, ownSet), isOwn: isOwnAyrshareComment(r, owners[li.internal] ?? []),
          })),
        })),
      };
    } catch (e: any) {
      out.linkedinReplies = { commentId: li.waiting[0], error: String(e?.message || e) };
    }
  }

  /* ١ج) ما بقي بلا ردّ من أيام SocialAPI — بلا نصّ: المنصة والنوع وشكل المعرّف
     والتاريخ. فما لم يُضمّ يُعرف لماذا: منشورٌ لا يُقرأ، أو معرّفٌ لا يُطابَق. */
  const { results: legacy } = await env.DB.prepare(
    `SELECT platform, kind, provider_comment_id, created_at FROM platform_comments
     WHERE reply_body IS NULL AND ignored_at IS NULL AND substr(provider_comment_id, 1, 4) NOT IN ('ayc|', 'ayd|', 'ayr|')
     ORDER BY created_at DESC LIMIT 30`,
  ).all<{ platform: string; kind: string; provider_comment_id: string; created_at: string }>();
  out.legacyUnreplied = legacy.map((r) => ({
    platform: r.platform,
    kind: r.kind,
    created: r.created_at,
    // الشكل لا القيمة: عدد الأجزاء وبادئتها، وآخر جزءٍ (معرّف المنصة) بطوله
    idShape: r.provider_comment_id.includes('|')
      ? `${r.provider_comment_id.split('|').length} أجزاء بـ|، آخرها ${mask(r.provider_comment_id.split('|').pop())}`
      : `${r.provider_comment_id.split(':')[0]}:… (${r.provider_comment_id.length})`,
  }));

  // ٢أ) قائمة القناة العامة — ومنها المقاطع القصيرة التي لا يردّها سجلُّ Ayrshare
  if (channelId) {
    try {
      const videos = await youtubeChannelVideos(channelId);
      out.youtubeFeed = { channelId, returned: videos.length, ids: videos.map((v) => ({ id: v.id, published: v.published, url: v.url })) };
    } catch (e: any) {
      out.youtubeFeed = { channelId, error: String(e?.message || e) };
    }
  }

  // ٢) يوتيوب: ما في سجلّه، وما عندنا منه، وما تردّه أرقامه
  if (owners.youtube) {
    try {
      const data = await ayrshareCall<any>(auth, 'GET', '/history/youtube?limit=50');
      const list: any[] = Array.isArray(data?.posts) ? data.posts : [];
      const ids = list.map((v) => String(v?.id ?? '')).filter(Boolean);
      const stored = new Map<string, { metrics_at: string | null; reach: number | null; impressions: number | null }>();
      for (let i = 0; i < ids.length; i += 90) {
        const chunk = ids.slice(i, i + 90);
        const { results } = await env.DB.prepare(
          `SELECT provider_post_id, metrics_at, reach, impressions FROM analytics_snapshots
           WHERE provider_post_id IN (${chunk.map(() => '?').join(',')})`,
        ).bind(...chunk).all<{ provider_post_id: string; metrics_at: string | null; reach: number | null; impressions: number | null }>();
        for (const r of results) stored.set(r.provider_post_id, r);
      }
      const sample = ids.slice(0, 5);
      let analytics: unknown = null;
      if (sample.length) {
        try {
          const a = await ayrshareCall<any>(auth, 'POST', '/analytics/post', { postIds: sample, platforms: ['youtube'], searchPlatformId: true });
          const block = a?.youtube;
          const items: any[] = Array.isArray(block) ? block : block ? [block] : [];
          analytics = { status: a?.status ?? null, errors: a?.errors ?? null, items: items.map((it) => ({
            id: it?.id ?? null, analyticsKeys: it?.analytics ? Object.keys(it.analytics).sort() : null,
            views: it?.analytics?.views ?? null,
          })) };
        } catch (e: any) {
          analytics = { error: String(e?.message || e) };
        }
      }
      out.youtube = {
        status: data?.status ?? null,
        returned: list.length,
        pagination: data?.meta?.pagination ?? null,
        postKeys: list[0] ? Object.keys(list[0]).sort() : [],
        posts: list.slice(0, 15).map((v) => ({
          id: v?.id ?? null,
          created: v?.created ?? v?.published ?? null,
          privacyStatus: v?.privacyStatus ?? null,
          stored: stored.has(String(v?.id)) ? stored.get(String(v?.id)) : null,
        })),
        analytics,
      };
    } catch (e: any) {
      out.youtube = { error: String(e?.message || e) };
    }
  }

  return out;
}
