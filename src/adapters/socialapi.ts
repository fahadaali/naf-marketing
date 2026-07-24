import type { PublishingProvider, PublishInput, PublishResult, AnalyticsResult, CommentItem } from './provider';

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
  reviews: '/inbox/reviews', // GET المراجعات (Google Business/Facebook)
  replyReview: (id: string) => `/inbox/reviews/${id}`, // POST رد على مراجعة
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

// منشور SocialAPI مع مقاييسه — لسحب تحليلات كل المنشورات
export type SocialApiPost = {
  id: string;
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

// يجلب كل المنشورات مع مقاييسها (المقاييس ضمن القائمة إن وُجدت، وإلا تُطلب لكل منشور)
export async function listSocialApiPosts(apiKey: string): Promise<SocialApiPost[]> {
  const data = await sapi<any>(apiKey, 'GET', `${EP.posts}?limit=100`);
  const list: any[] = data?.posts || data?.data || (Array.isArray(data) ? data : []);
  const out: SocialApiPost[] = [];
  for (const p of list) {
    const id = String(p.id || p.post_id || '');
    if (!id) continue;
    let metricsObj = p.metrics || p.analytics;
    if (metricsObj == null) {
      try {
        const m = await sapi<any>(apiKey, 'GET', EP.metrics(id));
        metricsObj = m?.metrics || m?.data || m;
      } catch { metricsObj = {}; }
    }
    const mapped = mapMetrics(metricsObj);
    out.push({
      id,
      platform: String(p.platform || p.account?.platform || p.targets?.[0]?.platform || ''),
      accountId: String(p.account_id || p.account?.id || p.targets?.[0]?.account_id || ''),
      title: (p.text || p.caption || '').slice(0, 140),
      sentAt: p.published_at || p.created_at || p.scheduled_at || null,
      reach: mapped.reach,
      impressions: mapped.impressions,
      engagement: mapped.engagement,
      externalUrl: p.permalink || p.url || p.external_url || p.link || null,
      metrics: mapped.raw,
    });
  }
  return out;
}

// يطابق مصفوفة مقاييس موحّدة على reach/impressions/engagement (المتشابهة كما في Buffer)
const ENGAGE = new Set(['reactions', 'comments', 'shares', 'reposts', 'saves', 'clicks', 'likes', 'quotes', 'follows', 'favorites', 'retweets']);
function mapMetrics(metricsObj: any): { reach: number; impressions: number; engagement: number; raw: any[] } {
  // قد تعود المقاييس ككائن {impressions: 10, ...} أو مصفوفة [{name,value}]
  const entries: [string, number][] = [];
  if (Array.isArray(metricsObj)) {
    for (const m of metricsObj) entries.push([String(m.type || m.name || '').toLowerCase(), Number(m.value || 0)]);
  } else if (metricsObj && typeof metricsObj === 'object') {
    for (const [k, v] of Object.entries(metricsObj)) if (typeof v === 'number') entries.push([k.toLowerCase(), v]);
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

// عنصر صندوق وارد موحّد (تعليق/رسالة/مراجعة) مع منصّته
export type InboxItem = { id: string; platform: string; kind: 'comment' | 'dm'; authorName: string; body: string; createdAt: string };

// يجلب كامل الصندوق الموحّد (تعليقات + مراجعات) عبر كل الحسابات — لا لكل منشور.
// خطوتان وفق توثيق SocialAPI:
//   1) GET /inbox/comments        → قائمة المنشورات التي عليها تعليقات (InboxPostRow): {id, account_id, platform, ...}
//   2) GET /inbox/comments/{postId}?account_id=…  → تعليقات ذلك المنشور فعلاً (CommentWithCapabilities):
//      {text, author_name, author_username, platform_id, created_at, platform, ...}
export async function listSocialApiInbox(apiKey: string): Promise<InboxItem[]> {
  const out: InboxItem[] = [];
  // 1) المنشورات التي عليها تعليقات
  let postRows: any[] = [];
  try {
    const data = await sapi<any>(apiKey, 'GET', EP.comments);
    postRows = data?.data || data?.comments || data?.posts || (Array.isArray(data) ? data : []);
  } catch { /* لا منشورات عليها تعليقات */ }

  for (const row of postRows) {
    const postId = String(row.id || row.post_id || '');
    const accountId = String(row.account_id || row.account?.id || '');
    const rowPlatform = String(row.platform || row.account?.platform || 'unknown');
    if (!postId) continue;
    // 2) تعليقات هذا المنشور
    try {
      const q = accountId ? `?account_id=${encodeURIComponent(accountId)}` : '';
      const cData = await sapi<any>(apiKey, 'GET', `${EP.postComments(postId)}${q}`);
      const comments: any[] = cData?.data || cData?.comments || (Array.isArray(cData) ? cData : []);
      for (const c of comments) {
        const commentId = String(c.platform_id || c.id || c.comment_id || '');
        const body = c.text || c.body || c.message || c.comment || '';
        if (!commentId && !body) continue;
        out.push({
          // نُرمّز (المنشور|الحساب|التعليق) كي يتوفّر للرد لاحقاً كل ما يحتاجه SocialAPI
          id: encodeCid(postId, accountId, commentId),
          platform: String(c.platform || rowPlatform),
          kind: 'comment',
          authorName: c.author_name || c.author_username || c.author?.name || c.author?.username || 'مستخدم',
          body,
          createdAt: toIso(c.created_at || c.created || c.timestamp),
        });
      }
    } catch { /* تعذّر جلب تعليقات هذا المنشور */ }
  }

  // المراجعات (Google Business/Facebook) — بادئة rv: لتوجيه الرد
  try {
    const rv = await sapi<any>(apiKey, 'GET', EP.reviews);
    const rlist: any[] = rv?.data || rv?.reviews || (Array.isArray(rv) ? rv : []);
    for (const r of rlist) {
      const stars = r.rating || r.stars;
      const body = r.text || r.comment || r.body || r.content || '';
      const rid = String(r.id || r.review_id || r.platform_id || '');
      if (!rid && !body) continue;
      out.push({
        id: `rv:${rid}`,
        platform: String(r.platform || r.account?.platform || 'googlebusiness'),
        kind: 'comment',
        authorName: (r.author_name || r.author?.name || r.reviewer || r.name || 'مراجعة') + (stars ? ` (★${stars})` : ''),
        body,
        createdAt: toIso(r.created_at || r.created || r.timestamp),
      });
    }
  } catch { /* لا مراجعات */ }
  return out;
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
    // جسم النشر وفق التوثيق: { text, targets: [{account_id}], scheduled_at? }
    const body: Record<string, unknown> = { text: input.text, targets: accountIds.map((id) => ({ account_id: id })) };
    if (input.scheduleAt) body.scheduled_at = input.scheduleAt;
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

  async replyComment(_providerPostId: string, commentId: string, text: string): Promise<void> {
    if (commentId.startsWith('rv:')) {
      // رد على مراجعة
      const account_id = Object.values(this.accounts).filter(Boolean)[0];
      await sapi(this.key, 'POST', EP.replyReview(commentId.slice(3)), { text, ...(account_id ? { account_id } : {}) });
      return;
    }
    // رد على تعليق: POST /inbox/comments/{postId} بجسم {account_id, comment_id, text}
    const dec = decodeCid(commentId);
    if (!dec) throw new Error('تعذّر تحديد المنشور/الحساب للرد على هذا التعليق');
    const account_id = dec.accountId || Object.values(this.accounts).filter(Boolean)[0] || '';
    await sapi(this.key, 'POST', EP.postComments(dec.postId), { account_id, comment_id: dec.commentId, text });
  }
}
