import type { PublishingProvider, PublishInput, PublishResult, AnalyticsResult, CommentItem, ModerateAction } from './provider';

// مزوّد SocialAPI.ai — واجهة REST موحّدة (نشر + تحليلات + تعليقات/رسائل/مراجعات).
// المصادقة: Authorization: Bearer sapi_key_...
// ملاحظة: المسارات أدناه ثوابت في مكان واحد ليسهل تصحيحها فور تأكيدها من توثيق SocialAPI.ai الحيّ.
const BASE = 'https://api.social-api.ai/v1';

// نقاط النهاية — مؤكّدة من توثيق SocialAPI.ai الرسمي:
const EP = {
  accounts: '/accounts', // GET قائمة الحسابات المربوطة
  posts: '/posts', // GET قائمة المنشورات، POST نشر/جدولة
  post: (id: string) => `/posts/${id}`, // GET/DELETE منشور
  metrics: (id: string) => `/posts/${id}/metrics`, // GET مقاييس منشور
  comments: '/inbox/comments', // GET قائمة المنشورات التي عليها تعليقات (InboxPostRow)
  postComments: (postId: string) => `/inbox/comments/${postId}`, // GET/POST تعليقات منشور معيّن، والرد عليها
  moderateComment: (commentId: string) => `/inbox/comments/${commentId}/moderate`, // POST إخفاء/إظهار/حذف/إعجاب
  privateReply: (commentId: string) => `/inbox/comments/${commentId}/private-reply`, // POST رد خاص لصاحب التعليق
  reviews: '/inbox/reviews', // GET ملخّص المراجعات لكل حساب (متوسط + عدد)
  reviewsForAccount: (accountId: string) => `/inbox/reviews/${accountId}`, // GET مراجعات حساب معيّن
  replyReview: (reviewId: string) => `/inbox/reviews/${reviewId}/reply`, // POST رد على مراجعة (معرّف المراجعة sapi_rev_)
  conversations: '/inbox/conversations', // GET المحادثات (رسائل خاصة)
  conversationMessages: (id: string) => `/inbox/conversations/${id}/messages`, // POST إرسال رسالة
  mentions: '/inbox/mentions', // GET الإشارات
  replyMention: (id: string) => `/inbox/mentions/${id}/reply`, // POST رد على إشارة
};

// نفصل بين (معرّف المنشور | معرّف الحساب | معرّف التعليق) داخل provider_comment_id واحد
// كي يتوفّر للرد كل ما يحتاجه SocialAPI: POST /inbox/comments/{postId} بجسم {account_id, comment_id, text}
const CID_SEP = '|';
function encodeCid(postId: string, accountId: string, commentId: string): string {
  return [postId, accountId, commentId].join(CID_SEP);
}
function decodeCid(cid: string): { postId: string; accountId: string; commentId: string } | null {
  const parts = cid.split(CID_SEP);
  if (parts.length !== 3) return null;
  return { postId: parts[0], accountId: parts[1], commentId: parts[2] };
}

function toIso(v: unknown): string {
  if (v == null) return new Date().toISOString();
  const n = Number(v);
  const d = Number.isFinite(n) && n > 1e9 && n < 1e11 ? new Date(n * 1000) : new Date(v as string);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

export type SocialApiAccount = { id: string; platform: string; name: string };

// منفّذ REST مشترك
async function sapi<T = any>(apiKey: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${apiKey.trim()}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : {}; } catch { /* رد غير JSON */ }
  if (res.status === 401 || res.status === 403) {
    throw new Error(`رمز SocialAPI مرفوض (${res.status}) — تأكد من صحة المفتاح.`);
  }
  if (!res.ok) throw new Error(`SocialAPI ${method} ${path} → ${res.status}: ${data?.message || data?.error || text.slice(0, 160)}`);
  return data as T;
}

// جلب الحسابات المربوطة (للربط بمنصات المنصة)
export async function listSocialApiAccounts(apiKey: string): Promise<SocialApiAccount[]> {
  const data = await sapi<any>(apiKey, 'GET', EP.accounts);
  const list: any[] = data?.accounts || data?.data || (Array.isArray(data) ? data : []);
  return list.map((a) => ({
    id: String(a.id || a.account_id || a.accountId),
    platform: String(a.platform || a.network || a.service || ''),
    name: String(a.name || a.username || a.display_name || a.handle || a.id),
  }));
}

// منشور SocialAPI مع مقاييسه — سطر لكل وجهة نشر (target) لأن المنشور الواحد قد يُنشر لعدّة منصات
export type SocialApiPost = {
  id: string; // معرّف المنشور على المنصة (platform_post_id) — فريد لكل وجهة
  postUuid: string; // معرّف المنشور الداخلي في SocialAPI (يربطه بجدول النشر)
  platform: string;
  accountId: string;
  title: string;
  sentAt: string | null;
  reach: number;
  impressions: number;
  engagement: number;
  externalUrl: string | null;
  metrics: any[];
};

// يجلب كل المنشورات: المقاييس والرابط والمنصّة كلها داخل targets[] لكل منشور
export async function listSocialApiPosts(apiKey: string): Promise<SocialApiPost[]> {
  const data = await sapi<any>(apiKey, 'GET', `${EP.posts}?limit=100`);
  const list: any[] = data?.data || data?.posts || (Array.isArray(data) ? data : []);
  const out: SocialApiPost[] = [];
  for (const p of list) {
    const postUuid = String(p.id || p.post_id || '');
    const title = (p.text || p.caption || '').slice(0, 140);
    const targets: any[] = Array.isArray(p.targets) ? p.targets : [];
    if (!targets.length) continue; // لا وجهة نشر → لا مقاييس
    for (const t of targets) {
      const platformPostId = String(t.platform_post_id || t.platform_id || '');
      const mapped = mapMetrics(t.metrics || {});
      out.push({
        id: platformPostId || `${postUuid}:${t.platform || ''}`,
        postUuid,
        platform: String(t.platform || ''),
        accountId: String(t.account_id || ''),
        title,
        sentAt: t.published_at || p.published_at || p.created_at || null,
        reach: mapped.reach,
        impressions: mapped.impressions,
        engagement: mapped.engagement,
        externalUrl: t.permalink || t.url || null,
        metrics: mapped.raw,
      });
    }
  }
  return out;
}

// يطابق مقاييس SocialAPI على reach/impressions/engagement، ويستخرج كل المقاييس الخام.
// يدعم: كائن {likes, comments, …, extra:{view_count}}، أو مصفوفة [{name,value}].
const ENGAGE = new Set(['reactions', 'comments', 'shares', 'reposts', 'saves', 'clicks', 'likes', 'quotes', 'follows', 'favorites', 'retweets']);
function mapMetrics(metricsObj: any): { reach: number; impressions: number; engagement: number; raw: any[] } {
  const entries: [string, number][] = [];
  if (Array.isArray(metricsObj)) {
    for (const m of metricsObj) entries.push([String(m.type || m.name || '').toLowerCase(), Number(m.value || 0)]);
  } else if (metricsObj && typeof metricsObj === 'object') {
    // نتعمّق في الكائنات المتداخلة (مثل extra:{view_count}) لتسطيح كل المقاييس الرقمية
    const walk = (o: any) => {
      for (const [k, v] of Object.entries(o)) {
        if (v && typeof v === 'object') walk(v);
        else if (typeof v === 'number') entries.push([k.toLowerCase(), v]);
      }
    };
    walk(metricsObj);
  }
  let reach = 0, impressions = 0, views = 0, engagement = 0;
  const raw: any[] = [];
  for (const [key, value] of entries) {
    if (!Number.isFinite(value)) continue;
    raw.push({ type: key, name: key, value, unit: key.includes('rate') ? 'percentage' : 'count' });
    if (key.includes('reach')) reach += value;
    else if (key.includes('impression')) impressions += value;
    else if (key.includes('view')) views += value;
    else if (ENGAGE.has(key)) engagement += value;
  }
  if (!impressions) impressions = views || reach;
  return { reach, impressions, engagement, raw };
}

// عنصر صندوق وارد موحّد (تعليق/رسالة/إشارة/مراجعة) مع منصّته
export type InboxItem = {
  id: string;
  platform: string;
  kind: 'comment' | 'dm' | 'mention' | 'review';
  authorName: string;
  body: string;
  createdAt: string;
  capabilities?: Record<string, boolean>;
  isHidden?: boolean;
  repliedBody?: string | null; // رد موجود مسبقاً على المنصة (للتقييمات)
};

// يجلب كامل الصندوق الموحّد (تعليقات + مراجعات) عبر كل الحسابات — لا لكل منشور.
// خطوتان وفق توثيق SocialAPI:
//   1) GET /inbox/comments        → قائمة المنشورات التي عليها تعليقات (InboxPostRow): {id, account_id, platform, ...}
//   2) GET /inbox/comments/{postId}?account_id=…  → تعليقات ذلك المنشور فعلاً (CommentWithCapabilities):
//      {text, author_name, author_username, platform_id, created_at, platform, ...}
export async function listSocialApiInbox(apiKey: string): Promise<InboxItem[]> {
  const out: InboxItem[] = [];

  // نجمع المنشورات المرشّحة من مصدرين لتغطية كل المنصّات:
  //   أ) /inbox/comments  → المنشورات التي رصد SocialAPI عليها تعليقات.
  //   ب) /posts (targets) → كل منشوراتنا المنشورة (قد تحمل تعليقات لا تظهر في الصندوق بعد).
  // المفتاح "postId|accountId" لمنع التكرار.
  const candidates = new Map<string, { postId: string; accountId: string; platform: string }>();
  const addCand = (postId: string, accountId: string, platform: string) => {
    if (!postId) return;
    const key = `${postId}|${accountId}`;
    if (!candidates.has(key)) candidates.set(key, { postId, accountId, platform });
  };

  try {
    const data = await sapi<any>(apiKey, 'GET', EP.comments);
    const rows: any[] = data?.data || data?.comments || data?.posts || (Array.isArray(data) ? data : []);
    for (const row of rows) {
      addCand(
        String(row.id || row.post_id || ''),
        String(row.account_id || row.account?.id || ''),
        String(row.platform || row.account?.platform || 'unknown'),
      );
    }
  } catch { /* لا منشورات في الصندوق */ }

  try {
    const pData = await sapi<any>(apiKey, 'GET', `${EP.posts}?limit=100`);
    const posts: any[] = pData?.data || pData?.posts || (Array.isArray(pData) ? pData : []);
    for (const p of posts) {
      for (const t of (Array.isArray(p.targets) ? p.targets : [])) {
        addCand(String(t.platform_post_id || t.platform_id || ''), String(t.account_id || ''), String(t.platform || 'unknown'));
      }
    }
  } catch { /* تعذّر جلب المنشورات */ }

  for (const { postId, accountId, platform: rowPlatform } of candidates.values()) {
    try {
      const q = accountId ? `?account_id=${encodeURIComponent(accountId)}` : '';
      const cData = await sapi<any>(apiKey, 'GET', `${EP.postComments(postId)}${q}`);
      const comments: any[] = cData?.data || cData?.comments || (Array.isArray(cData) ? cData : []);
      for (const c of comments) {
        const commentId = String(c.platform_id || c.id || c.comment_id || '');
        const body = c.text || c.body || c.message || c.comment || '';
        if (!commentId && !body) continue;
        out.push({
          // نُرمّز (المنشور|الحساب|التعليق) كي يتوفّر للرد/الإشراف لاحقاً كل ما يحتاجه SocialAPI
          id: encodeCid(postId, accountId, commentId),
          platform: String(c.platform || rowPlatform),
          kind: 'comment',
          authorName: c.author_name || c.author_username || c.author?.name || c.author?.username || 'مستخدم',
          body,
          createdAt: toIso(c.created_at || c.created || c.timestamp),
          capabilities: (c.capabilities && typeof c.capabilities === 'object') ? c.capabilities : undefined,
          isHidden: !!c.is_hidden,
        });
      }
    } catch { /* تعذّر جلب تعليقات هذا المنشور */ }
  }

  // المراجعات (Google Business/Facebook) — خطوتان: ملخّص لكل حساب ثم مراجعات كل حساب.
  // نُرمّز المعرّف "rv:{accountId}:{reviewId}" لتوجيه الرد لاحقاً.
  try {
    const rv = await sapi<any>(apiKey, 'GET', EP.reviews);
    const accounts: any[] = rv?.data || rv?.reviews || (Array.isArray(rv) ? rv : []);
    for (const acc of accounts) {
      const accountId = String(acc.account_id || acc.id || '');
      const accPlatform = String(acc.platform || 'google');
      if (!accountId) continue;
      let list: any[] = [];
      try {
        const detail = await sapi<any>(apiKey, 'GET', EP.reviewsForAccount(accountId));
        list = detail?.data || detail?.reviews || (Array.isArray(detail) ? detail : []);
      } catch { list = []; }
      for (const r of list) {
        const stars = r.rating ?? r.star_rating ?? r.stars;
        const body = r.text || r.comment || r.content || r.body || '';
        const rid = String(r.id || r.review_id || r.platform_id || '');
        if (!rid && !body) continue;
        out.push({
          id: `rv:${accountId}:${rid}`,
          platform: accPlatform,
          kind: 'review',
          authorName: (r.author_name || r.reviewer || r.name || r.author?.name || 'مراجعة') + (stars != null ? ` (★${stars})` : ''),
          body,
          createdAt: toIso(r.created_at || r.updated_at || r.created || r.timestamp),
          repliedBody: r.reply?.text || null,
        });
      }
    }
  } catch { /* لا مراجعات */ }

  // الرسائل الخاصة (DMs) — لكل حساب داعم: GET /inbox/conversations?account_id=&platform=
  // نُرمّز "dm:{conversationId}:{accountId}" لتوجيه الرد عبر /inbox/conversations/{id}/messages
  try {
    const accts = await listSocialApiAccounts(apiKey);
    for (const acc of accts) {
      try {
        const q = `?account_id=${encodeURIComponent(acc.id)}${acc.platform ? `&platform=${encodeURIComponent(acc.platform)}` : ''}&limit=50`;
        const data = await sapi<any>(apiKey, 'GET', `${EP.conversations}${q}`);
        const convos: any[] = data?.data || data?.conversations || (Array.isArray(data) ? data : []);
        for (const cv of convos) {
          const convId = String(cv.id || cv.conversation_id || '');
          if (!convId) continue;
          out.push({
            id: `dm:${convId}:${acc.id}`,
            platform: String(cv.platform || acc.platform || 'unknown'),
            kind: 'dm',
            authorName: cv.participant_name || cv.participant?.name || cv.from || 'مستخدم',
            body: cv.last_message || cv.last_message_text || '',
            createdAt: toIso(cv.last_message_at || cv.updated_at || cv.created_at),
          });
        }
      } catch { /* لا محادثات لهذا الحساب أو المنصة لا تدعمها (501) */ }
    }
  } catch { /* تعذّر جلب الحسابات */ }

  // الإشارات (Mentions) — GET /inbox/mentions. نُرمّز "mn:{mentionId}:{accountId}:{mediaId}" للرد لاحقاً.
  try {
    const data = await sapi<any>(apiKey, 'GET', `${EP.mentions}?limit=50`);
    const mentions: any[] = data?.data || data?.mentions || (Array.isArray(data) ? data : []);
    for (const m of mentions) {
      const mid = String(m.id || m.platform_id || '');
      if (!mid) continue;
      const accountId = String(m.account_id || m.account?.id || '');
      const mediaId = String(m.metadata?.media_id || m.media_id || '');
      out.push({
        id: `mn:${mid}:${accountId}:${mediaId}`,
        platform: String(m.platform || 'unknown'),
        kind: 'mention',
        authorName: m.author?.name || m.author_name || m.username || 'مستخدم',
        body: m.content?.text || m.text || m.caption || '',
        createdAt: toIso(m.created_at || m.received_at || m.timestamp),
      });
    }
  } catch { /* لا إشارات أو غير مدعومة */ }

  return out;
}

// تشخيص: يُعيد الاستجابات الخام من SocialAPI كما هي، لتحديد أسماء الحقول الفعلية بدقّة
// (لا نُخمّن الحقول بعد الآن — نقرأها من هنا). يُستدعى من مسار /comments/debug.
export async function debugSocialApi(apiKey: string): Promise<any> {
  const out: any = {};
  // 1) قائمة المنشورات التي عليها تعليقات
  try {
    out.inbox_comments = await sapi<any>(apiKey, 'GET', EP.comments);
  } catch (e: any) { out.inbox_comments_error = String(e?.message || e); }
  // 2) تعليقات أول منشور
  try {
    const rows: any[] = out.inbox_comments?.data || out.inbox_comments?.comments || (Array.isArray(out.inbox_comments) ? out.inbox_comments : []);
    const first = rows[0];
    if (first) {
      const postId = String(first.id || first.post_id || '');
      const accountId = String(first.account_id || first.account?.id || '');
      out.first_post = { postId, accountId, keys: Object.keys(first) };
      const q = accountId ? `?account_id=${encodeURIComponent(accountId)}` : '';
      out.post_comments = await sapi<any>(apiKey, 'GET', `${EP.postComments(postId)}${q}`);
    }
  } catch (e: any) { out.post_comments_error = String(e?.message || e); }
  // 3) المراجعات: ملخّص لكل حساب ثم تفاصيل أول حساب
  try {
    out.reviews = await sapi<any>(apiKey, 'GET', EP.reviews);
    const accs: any[] = out.reviews?.data || out.reviews?.reviews || (Array.isArray(out.reviews) ? out.reviews : []);
    const firstAcc = accs[0];
    if (firstAcc) {
      const accId = String(firstAcc.account_id || firstAcc.id || '');
      out.review_detail = await sapi<any>(apiKey, 'GET', EP.reviewsForAccount(accId));
    }
  } catch (e: any) { out.reviews_error = String(e?.message || e); }
  // 4) المنشورات (لاكتشاف حقل الرابط الخارجي)
  try {
    const posts = await sapi<any>(apiKey, 'GET', `${EP.posts}?limit=3`);
    const list: any[] = posts?.data || posts?.posts || (Array.isArray(posts) ? posts : []);
    out.posts_sample = list.slice(0, 2);
    out.posts_first_keys = list[0] ? Object.keys(list[0]) : [];
  } catch (e: any) { out.posts_error = String(e?.message || e); }
  return out;
}

// إدارة الويب هوكس — تسجيل/سرد/حذف نقطة استقبال أحداث الصندوق الفورية.
export async function registerSocialApiWebhook(apiKey: string, url: string, events: string[]): Promise<{ id: string; secret: string }> {
  const data = await sapi<any>(apiKey, 'POST', '/webhooks', { url, events });
  return { id: String(data?.id || data?.data?.id || ''), secret: String(data?.secret || data?.data?.secret || '') };
}
export async function listSocialApiWebhooks(apiKey: string): Promise<any[]> {
  const data = await sapi<any>(apiKey, 'GET', '/webhooks');
  return data?.data || data?.webhooks || (Array.isArray(data) ? data : []);
}
export async function deleteSocialApiWebhook(apiKey: string, id: string): Promise<void> {
  try { await sapi(apiKey, 'DELETE', `/webhooks/${id}`); } catch { /* غير حرِج */ }
}

export class SocialApiProvider implements PublishingProvider {
  private key: string;
  constructor(apiKey: string, private accounts: Record<string, string>) {
    this.key = (apiKey || '').trim();
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    const accountIds = input.platforms.map((p) => this.accounts[p]).filter(Boolean);
    if (!accountIds.length) {
      throw new Error(`لا يوجد حساب SocialAPI مربوط للمنصات: ${input.platforms.join('، ')} — اربطها من الإعدادات ← المنصات والمزوّد`);
    }
    // جسم النشر وفق التوثيق: { text, targets:[{account_id}], scheduled_at? } — والنشر الفوري يحتاج publish_now
    const body: Record<string, unknown> = { text: input.text, targets: accountIds.map((id) => ({ account_id: id })) };
    if (input.scheduleAt) body.scheduled_at = input.scheduleAt;
    else body.publish_now = true;
    const data = await sapi<any>(this.key, 'POST', EP.posts, body);
    const id = data?.id || data?.post_id || data?.data?.id;
    return { providerPostId: String(id || ''), status: input.scheduleAt ? 'scheduled' : (data?.status || 'published') };
  }

  async getAnalytics(providerPostId: string): Promise<AnalyticsResult> {
    const data = await sapi<any>(this.key, 'GET', EP.metrics(providerPostId));
    const m = mapMetrics(data?.metrics || data?.data || data);
    return { reach: m.reach, impressions: m.impressions, engagement: m.engagement };
  }

  async deletePost(providerPostId: string): Promise<void> {
    try { await sapi(this.key, 'DELETE', EP.post(providerPostId)); } catch { /* الحذف غير حرِج */ }
  }

  async getComments(providerPostId: string): Promise<CommentItem[]> {
    // تعليقات منشور معيّن — نستنتج الحساب من خريطة الربط (أول حساب مربوط)
    const accountId = Object.values(this.accounts).filter(Boolean)[0] || '';
    const out: CommentItem[] = [];
    try {
      const q = accountId ? `?account_id=${encodeURIComponent(accountId)}` : '';
      const data = await sapi<any>(this.key, 'GET', `${EP.postComments(providerPostId)}${q}`);
      const list: any[] = data?.data || data?.comments || (Array.isArray(data) ? data : []);
      for (const c of list) {
        const commentId = String(c.platform_id || c.id || c.comment_id || '');
        out.push({
          id: encodeCid(providerPostId, accountId, commentId),
          kind: 'comment',
          authorName: c.author_name || c.author_username || c.author?.name || c.author?.username || 'مستخدم',
          body: c.text || c.message || c.comment || c.body || '',
          createdAt: toIso(c.created_at || c.created || c.timestamp),
        });
      }
    } catch { /* قد لا تتوفر تعليقات لهذا المنشور */ }
    return out;
  }

  private fallbackAccount(): string {
    return Object.values(this.accounts).filter(Boolean)[0] || '';
  }

  async replyComment(_providerPostId: string, commentId: string, text: string): Promise<void> {
    if (commentId.startsWith('rv:')) {
      // مراجعة: "rv:{accountId}:{reviewId}" → POST /inbox/reviews/{reviewId}/reply {account_id, text}
      const [, accountId, reviewId] = commentId.split(':');
      await sapi(this.key, 'POST', EP.replyReview(reviewId), { account_id: accountId || this.fallbackAccount(), text });
      return;
    }
    if (commentId.startsWith('dm:')) {
      // رسالة خاصة: "dm:{conversationId}:{accountId}" → POST /inbox/conversations/{id}/messages {account_id, text}
      const [, convId, accountId] = commentId.split(':');
      await sapi(this.key, 'POST', EP.conversationMessages(convId), { account_id: accountId || this.fallbackAccount(), text });
      return;
    }
    if (commentId.startsWith('mn:')) {
      // إشارة: "mn:{mentionId}:{accountId}:{mediaId}" → POST /inbox/mentions/{id}/reply {account_id, media_id?, text}
      const [, mentionId, accountId, mediaId] = commentId.split(':');
      const payload: Record<string, unknown> = { account_id: accountId || this.fallbackAccount(), text };
      if (mediaId) payload.media_id = mediaId;
      await sapi(this.key, 'POST', EP.replyMention(mentionId), payload);
      return;
    }
    // تعليق: POST /inbox/comments/{postId} بجسم {account_id, comment_id, text}
    const dec = decodeCid(commentId);
    if (!dec) throw new Error('تعذّر تحديد المنشور/الحساب للرد على هذا التعليق');
    await sapi(this.key, 'POST', EP.postComments(dec.postId), { account_id: dec.accountId || this.fallbackAccount(), comment_id: dec.commentId, text });
  }

  async moderateComment(commentId: string, action: ModerateAction): Promise<void> {
    // الإشراف على التعليقات فقط: POST /inbox/comments/{commentId}/moderate {account_id, action}
    const dec = decodeCid(commentId);
    if (!dec) throw new Error('الإشراف متاح على التعليقات فقط');
    await sapi(this.key, 'POST', EP.moderateComment(dec.commentId), { account_id: dec.accountId || this.fallbackAccount(), action });
  }

  async privateReply(commentId: string, text: string): Promise<void> {
    // رد خاص لصاحب التعليق (Instagram/Facebook): POST /inbox/comments/{commentId}/private-reply {account_id, text}
    const dec = decodeCid(commentId);
    if (!dec) throw new Error('الرد الخاص متاح على التعليقات فقط');
    await sapi(this.key, 'POST', EP.privateReply(dec.commentId), { account_id: dec.accountId || this.fallbackAccount(), text });
  }
}
