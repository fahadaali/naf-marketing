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
  media: '/media', // POST رفع وسيط من الخادم، GET سرد
  exports: '/exports', // GET سرد، POST إنشاء تصدير تحليلات
  exportItem: (id: string) => `/exports/${id}`, // GET حالة/نتيجة تصدير
  exportVideos: (id: string) => `/exports/${id}/videos`, // GET فيديوهات تصدير مكتمل مع المقاييس
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

/** وقتٌ معلن أو `null` — لا «الآن» مكان الغائب: وقتٌ مخترعٌ يجعل كل رسالةٍ أحدث مما قبلها. */
function isoOrNull(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  const d = Number.isFinite(n) && n > 1e9 && n < 1e11 ? new Date(n * 1000) : new Date(v as string);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function toIso(v: unknown): string {
  if (v == null) return new Date().toISOString();
  const n = Number(v);
  const d = Number.isFinite(n) && n > 1e9 && n < 1e11 ? new Date(n * 1000) : new Date(v as string);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

export type SocialApiAccount = { id: string; platform: string; name: string };

/* ═══ ميزانيةُ النداءات ═══

   عاملُ كلاودفلير يُحدّ بعدد الطلبات الخارجية في الاستدعاء الواحد: خمسون
   في الخطة المجانية. والمزامنة كانت تنادي منشوراً منشوراً بلا حدّ، فإذا
   بلغ الاستدعاء حدّه سقط كل نداءٍ بعده بخطأ «Too many subrequests» —
   وكلُّها محاطةٌ بـ`catch` صامت. فيصل من الصندوق ما سبق الحدّ ويغيب ما بعده،
   ويتبدّل الغائب من ساعةٍ إلى ساعة بحسب ما سبقه من مهام: تعليقاتٌ لا تظهر
   أبداً، وأرقامٌ تظهر مرّةً وتغيب أخرى.

   فكل دورة تحمل ميزانيةً معلومة، وتقف عندها واقفةً لا ساقطة: تحفظ ما جمعت
   وتقول إنها لم تكمل، وتُكمل الدورةُ التالية من حيث بلغت. */

/** نفدت ميزانية الدورة — ليس عطلاً في المزوّد، فلا يُعرض خطأً. */
export class BudgetExhausted extends Error {
  constructor() {
    super('budget_exhausted');
    this.name = 'BudgetExhausted';
  }
}

/**
 * عدّادُ نداءات الدورة الواحدة، ومعه سقفُ وقتها. وتقف كذلك حين يطلب المزوّد
 * التمهّل أو يبلغ الاستدعاء حدّ طلباته — وقفاً تُكمله الدورة التالية، لا عطلاً.
 */
export class CallBudget {
  used = 0;
  /** سببُ الوقف قبل الحصّة — `null` ما دامت الحصّة وحدها تحكم. */
  stoppedBy: 'rate_limit' | 'platform_cap' | null = null;
  constructor(readonly max: number, private readonly deadline: number = Number.POSITIVE_INFINITY) {}
  get left(): number {
    if (this.stoppedBy || Date.now() >= this.deadline) return 0;
    return Math.max(this.max - this.used, 0);
  }
  spend(): void {
    if (this.left <= 0) throw new BudgetExhausted();
    this.used++;
  }
  stop(reason: 'rate_limit' | 'platform_cap'): void {
    this.stoppedBy = reason;
  }
}

/** حدُّ طلبات الاستدعاء في كلاودفلير — نصٌّ إنجليزي يرميه وقتُ التشغيل. */
function isPlatformCap(err: unknown): boolean {
  return /too many subrequests|too many api requests by single worker invocation/i.test(String((err as Error)?.message || err));
}

/** خطأ المزوّد بحالته — كي يُفرَّق «غير مدعوم» (404/405/501) عن العطل. */
export class SocialApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'SocialApiError';
  }
}

/**
 * مسارٌ لا تدعمه هذه المنصّة أو هذا الحساب — غيابٌ معلوم لا عطل. ويشمل
 * ٤٠٠ و٤٢٢ لأنه يُستعمل حين تُجرَّب صيغتان لنداءٍ واحد ويُقبل ما أجاب.
 */
export function isUnsupported(err: unknown): boolean {
  return err instanceof SocialApiError && [400, 404, 405, 422, 501].includes(err.status);
}

/** المسار غير موجودٍ أو غير مدعوم أصلاً — أضيق من `isUnsupported`: طلبٌ مرفوضٌ بمحتواه عطلٌ يُقال. */
export function isNotFound(err: unknown): boolean {
  return err instanceof SocialApiError && [404, 405, 501].includes(err.status);
}

// منفّذ REST مشترك
async function sapi<T = any>(apiKey: string, method: string, path: string, body?: unknown, budget?: CallBudget): Promise<T> {
  budget?.spend();
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${apiKey.trim()}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    if (budget && isPlatformCap(err)) {
      budget.stop('platform_cap');
      throw new BudgetExhausted();
    }
    throw err;
  }
  // المزوّد يطلب التمهّل: تقف الدورة ولا تُلحّ، وتُكمل التي بعدها
  if (res.status === 429 && budget) {
    budget.stop('rate_limit');
    throw new BudgetExhausted();
  }
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : {}; } catch { /* رد غير JSON */ }
  if (res.status === 401 || res.status === 403) {
    throw new SocialApiError(`رمز SocialAPI مرفوض (${res.status}) — تأكد من صحة المفتاح.`, res.status);
  }
  if (!res.ok) {
    const detail = data?.message || data?.error?.message || data?.error || text.slice(0, 160);
    throw new SocialApiError(`SocialAPI ${method} ${path} → ${res.status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`, res.status);
  }
  return data as T;
}

/* ═══ القوائم صفحاتٌ لا ردٌّ واحد ═══

   كل قائمةٍ في SocialAPI تُردّ صفحةً: `{ data: [...], next_cursor }`، أو
   `{ data, pagination: { next_cursor } }` في قائمة المنشورات. وتعليقات
   المنشور تُرتَّب من الأقدم إلى الأحدث بخمسٍ وعشرين في الصفحة — فقراءةُ
   الصفحة الأولى وحدها، كما كانت، تقرأ أقدم التعليقات وتترك أحدثها أبداً
   على كل منشورٍ تجاوز الخمسة والعشرين. */

/** مؤشّر الصفحة التالية بأيّ الشكلين جاء — وإلا `null`. */
export function nextCursor(page: any): string | null {
  const c = page?.next_cursor ?? page?.pagination?.next_cursor ?? page?.meta?.next_cursor ?? page?.paging?.next_cursor ?? null;
  return typeof c === 'string' && c.trim() ? c : null;
}

/** عناصر الصفحة — `data` أولاً ثم الأسماء البديلة، أو الردّ نفسه إن كان مصفوفة. */
export function itemsOf(page: any, ...keys: string[]): any[] {
  if (Array.isArray(page)) return page;
  for (const k of ['data', ...keys]) {
    const v = page?.[k];
    if (Array.isArray(v)) return v;
  }
  return [];
}

export type ListResult = {
  items: any[];
  /** قُرئت القائمة إلى آخرها — لا حدّ صفحاتٍ ولا ميزانية أوقفها. */
  complete: boolean;
  /** وقفت لأن الميزانية نفدت. */
  exhausted: boolean;
  /**
   * من أين تبدأ القراءة التالية: مؤشّرُ آخر صفحةٍ قُرئت إن اكتملت القائمة
   * (فتُعاد وحدها ويُلحق بها ما جدّ)، أو مؤشّرُ الصفحة التي لم تُقرأ بعدُ
   * إن وقفت دونها. `null` = من البداية.
   */
  resume: string | null;
};

/** يقرأ قائمةً صفحةً صفحة حتى تنفد أو يبلغ الحدّ — ويحفظ ما جمع إن وقف. */
export async function sapiList(
  apiKey: string,
  path: string,
  params: Record<string, string | number | undefined | null>,
  opts: { budget?: CallBudget; maxPages: number; keys?: string[]; startCursor?: string | null },
): Promise<ListResult> {
  const items: any[] = [];
  const seen = new Set<string>();
  let cursor: string | null = opts.startCursor || null;
  for (let page = 0; page < opts.maxPages; page++) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
    }
    if (cursor) q.set('cursor', cursor);
    const qs = q.toString();
    let data: any;
    try {
      data = await sapi<any>(apiKey, 'GET', `${path}${qs ? `?${qs}` : ''}`, undefined, opts.budget);
    } catch (err) {
      if (err instanceof BudgetExhausted) return { items, complete: false, exhausted: true, resume: cursor };
      throw err;
    }
    items.push(...itemsOf(data, ...(opts.keys ?? [])));
    const next = nextCursor(data);
    // مؤشّرٌ يتكرّر حلقةٌ لا صفحة — تُقطع
    if (!next || seen.has(next) || next === cursor) return { items, complete: true, exhausted: false, resume: cursor };
    seen.add(next);
    cursor = next;
  }
  return { items, complete: false, exhausted: false, resume: cursor };
}

// جلب الحسابات المربوطة (للربط بمنصات المنصة)
export async function listSocialApiAccounts(apiKey: string, budget?: CallBudget): Promise<SocialApiAccount[]> {
  return (await listSocialApiAccountsDetailed(apiKey, budget)).map(({ id, platform, name }) => ({ id, platform, name }));
}

/** الحساب ومعه ما يُعرف به صاحبه على منصّته — لتمييز ردودنا عن ردود الناس. */
export type SocialApiOwnedAccount = SocialApiAccount & { ownerKeys: string[] };

/** يوحّد معرّفاً أو اسماً للمقارنة: بلا مسافاتٍ طرفية ولا «@» ولا فرق حروف. */
export function normKey(v: unknown): string {
  return String(v ?? '').trim().toLowerCase().replace(/^@/, '');
}

export async function listSocialApiAccountsDetailed(apiKey: string, budget?: CallBudget): Promise<SocialApiOwnedAccount[]> {
  const data = await sapi<any>(apiKey, 'GET', EP.accounts, undefined, budget);
  const list: any[] = data?.accounts || data?.data || (Array.isArray(data) ? data : []);
  return list.map((a) => {
    const meta = a?.metadata && typeof a.metadata === 'object' ? a.metadata : {};
    /* ما يُعرف به الحساب على منصّته: معرّفُه هناك واسمُه ومعرّفُ صفحته أو
       قناته. والاسم الظاهر وحده لا يُقبل إن قصُر — «ناف» تطابق من ليس نحن. */
    const keys = [
      a.platform_user_id, a.platform_account_id, a.platform_id, a.external_id, a.user_id, a.page_id,
      a.username, a.handle, a.name, a.display_name,
      meta.username, meta.name, meta.page_id, meta.page_name, meta.user_id, meta.channel_id, meta.channel_title, meta.ig_user_id,
    ]
      .map(normKey)
      .filter((k) => k.length >= 3);
    return {
      id: String(a.id || a.account_id || a.accountId),
      platform: String(a.platform || a.network || a.service || ''),
      name: String(a.name || a.username || a.display_name || a.handle || a.id),
      ownerKeys: [...new Set(keys)],
    };
  });
}

// منشور SocialAPI مع مقاييسه — سطر لكل وجهة نشر (target) لأن المنشور الواحد قد يُنشر لعدّة منصات
export type SocialApiPost = {
  id: string; // معرّف المنشور على المنصة (platform_post_id) — فريد لكل وجهة
  postUuid: string; // معرّف المنشور الداخلي في SocialAPI (يربطه بجدول النشر)
  platform: string;
  accountId: string;
  title: string;
  sentAt: string | null;
  /** `null` = لم يُعلنه المزوّد — لا صفر. */
  reach: number | null;
  impressions: number | null;
  engagement: number | null;
  /** أعلن المزوّد أرقاماً لهذه الوجهة أصلاً — وإلا فغيابٌ لا أصفار. */
  hasMetrics: boolean;
  /** متى زامنها المزوّد من المنصّة، إن أعلنه. */
  metricsSyncedAt: string | null;
  externalUrl: string | null;
  metrics: any[];
};

// رابط احتياطي للمنشور على منصته حين لا يوفّر SocialAPI حقل permalink.
function buildPermalink(platform: string, id: string): string | null {
  if (!id) return null;
  switch (platform) {
    case 'youtube': return `https://www.youtube.com/watch?v=${id}`;
    case 'twitter': return `https://x.com/i/web/status/${id}`;
    case 'facebook': return `https://www.facebook.com/${id}`;
    case 'threads': return `https://www.threads.net/t/${id}`;
    case 'linkedin':
    case 'linkedin_page':
      return id.startsWith('urn:')
        ? `https://www.linkedin.com/feed/update/${id}`
        : `https://www.linkedin.com/feed/update/urn:li:activity:${id}`;
    default: return null; // إنستقرام/تيك توك يحتاجان اسم المستخدم/الرمز القصير — لا نبني رابطاً غير موثوق
  }
}

// يجبر SocialAPI على مزامنة كل فيديوهات قنوات يوتيوب المربوطة (المسار الوحيد الموثّق
// للمزامنة القسرية للمحتوى القديم). أفضل جهد — نتجاهل أي فشل.
// والحسابات تُمرَّر إن سبق جلبُها في الدورة نفسها — نداءٌ واحد لا اثنان.
export async function syncYouTubePosts(apiKey: string, accounts?: SocialApiAccount[], budget?: CallBudget): Promise<void> {
  let accts: SocialApiAccount[] = accounts ?? [];
  if (!accounts) {
    try { accts = await listSocialApiAccounts(apiKey, budget); } catch { return; }
  }
  for (const a of accts) {
    if (a.platform !== 'youtube') continue;
    try { await sapi(apiKey, 'POST', `/platforms/youtube/accounts/${a.id}/sync`, undefined, budget); } catch { /* أفضل جهد */ }
  }
}

/** منشورٌ ووجهاته كما يردّها `/posts` — سطرٌ لكل وجهة. */
export function mapPublishedPost(p: any): SocialApiPost[] {
  const postUuid = String(p?.id || p?.post_id || '');
  const title = String(p?.text || p?.caption || '').slice(0, 140);
  const targets: any[] = Array.isArray(p?.targets) ? p.targets : [];
  const out: SocialApiPost[] = [];
  for (const t of targets) {
    const platformPostId = String(t.platform_post_id || t.platform_id || '');
    const mapped = mapMetrics(t.metrics ?? null);
    out.push({
      id: platformPostId || `${postUuid}:${t.platform || ''}`,
      postUuid,
      platform: String(t.platform || ''),
      accountId: String(t.account_id || ''),
      title,
      // وقتٌ يُقرأ أو لا شيء — رقمٌ خامٌ يُسقط كل مقارنةٍ بعده (`isoOrNull`)
      sentAt: isoOrNull(t.published_at || p.published_at || p.created_at),
      reach: mapped.reach,
      impressions: mapped.impressions,
      engagement: mapped.engagement,
      hasMetrics: mapped.present,
      metricsSyncedAt: mapped.syncedAt,
      externalUrl: t.permalink || t.url || buildPermalink(String(t.platform || ''), platformPostId),
      metrics: mapped.raw,
    });
  }
  return out;
}

/**
 * ما نُشر عبر SocialAPI — صفحةً صفحة.
 *
 * و`/posts` قراءةٌ من قاعدة المزوّد لا من المنصّات: فيه ما نُشر عبره وحده،
 * بمقاييسَ حُفظت آخر مرّةٍ حُدّثت. وما نُشر من تطبيق المنصّة مباشرةً ليس
 * فيه أصلاً — ذاك يُقرأ من سجلّ الحساب (`listAccountPosts`).
 */
export async function listSocialApiPostsPaged(
  apiKey: string,
  opts: { budget?: CallBudget; maxPages: number },
): Promise<{ posts: SocialApiPost[]; complete: boolean; exhausted: boolean }> {
  const r = await sapiList(apiKey, EP.posts, { limit: 100, sort: 'created_desc' }, { budget: opts.budget, maxPages: opts.maxPages, keys: ['posts'] });
  return { posts: r.items.flatMap(mapPublishedPost), complete: r.complete, exhausted: r.exhausted };
}

/**
 * أرقامٌ حيّة لمنشورٍ نُشر عبر SocialAPI — سطرٌ لكل وجهة.
 *
 * هذا وحده ما يطلب الأرقام من المنصّات نفسها في لحظتها؛ و`/posts` يردّ ما
 * حُفظ. وكانت المنصة لا تناديه إطلاقاً لمزوّد SocialAPI، فبقيت أرقامُ كل
 * منشورٍ على ما كانت عليه لحظة نشره — أصفاراً في الغالب.
 */
export async function fetchPostMetrics(
  apiKey: string,
  postUuid: string,
  budget?: CallBudget,
): Promise<{ platformPostId: string; platform: string; accountId: string; metrics: ReturnType<typeof mapMetrics> }[]> {
  const data = await sapi<any>(apiKey, 'GET', EP.metrics(postUuid), undefined, budget);
  let entries: any[] = itemsOf(data, 'targets', 'metrics', 'results');
  if (!entries.length && data?.data && typeof data.data === 'object' && !Array.isArray(data.data)) {
    const inner = itemsOf(data.data, 'targets', 'metrics');
    entries = inner.length ? inner : [data.data];
  }
  if (!entries.length && data && typeof data === 'object' && !Array.isArray(data)) entries = [data];
  return entries.map((e) => ({
    platformPostId: String(e?.platform_post_id || e?.platform_id || ''),
    platform: String(e?.platform || ''),
    accountId: String(e?.account_id || e?.account?.id || ''),
    metrics: mapMetrics(e?.metrics ?? e),
  }));
}

/** منشورٌ من سجلّ الحساب على منصّته — ومنه ما نُشر من خارج المنصة. */
export type AccountPost = {
  id: string;
  platform: string;
  accountId: string;
  title: string;
  sentAt: string | null;
  externalUrl: string | null;
  metrics: ReturnType<typeof mapMetrics>;
};

/** يخرّط منشوراً من `/accounts/{id}/posts` — الحقول بأسمائها المتعدّدة. */
export function mapAccountPost(p: any, account: SocialApiAccount): AccountPost | null {
  const id = String(p?.platform_post_id || p?.platform_id || p?.id || '');
  if (!id) return null;
  const platform = String(p?.platform || account.platform || '');
  // المقاييس في كائنٍ واحد إن وُجد، وإلا فالحقول الرقمية على المنشور نفسه
  const source = p?.metrics ?? p?.engagement ?? p?.stats ?? p?.insights ?? pickMetricFields(p);
  return {
    id,
    platform,
    accountId: account.id,
    title: String(p?.text || p?.caption || p?.title || p?.message || '').slice(0, 140),
    sentAt: isoOrNull(p?.published_at || p?.timestamp || p?.created_at || p?.created_time),
    externalUrl: p?.permalink || p?.url || p?.link || buildPermalink(platform, id),
    metrics: mapMetrics(source),
  };
}

/** الحقول الرقمية المعروفة على المنشور نفسه — لا معرّفاته ولا أبعاده. */
function pickMetricFields(p: any): Record<string, number> {
  const out: Record<string, number> = {};
  if (!p || typeof p !== 'object') return out;
  for (const [k, v] of Object.entries(p)) {
    if (typeof v === 'number' && canonicalMetric(k.toLowerCase())) out[k] = v;
  }
  return out;
}

/**
 * منشورات الحساب على منصّته — الأحدث أوّلاً، ومنها ما نُشر من تطبيق المنصّة.
 * الدورة المعتادة تقرأ صفحتها الأولى وحدها؛ وسحبُ السجلّ يمضي من مؤشّرٍ محفوظ
 * إلى أقدم منشور، صفحاتٍ في كل دورة، حتى تُقرأ السنوات كلُّها مرّة.
 */
export async function listAccountPosts(
  apiKey: string,
  account: SocialApiAccount,
  opts: { budget?: CallBudget; maxPages?: number; startCursor?: string | null } = {},
): Promise<{ posts: AccountPost[]; complete: boolean; exhausted: boolean; resume: string | null }> {
  const r = await sapiList(apiKey, `/accounts/${encodeURIComponent(account.id)}/posts`, { limit: 50 }, {
    budget: opts.budget, maxPages: opts.maxPages ?? 1, keys: ['posts', 'media'], startCursor: opts.startCursor,
  });
  const posts = r.items.map((p) => mapAccountPost(p, account)).filter((p): p is AccountPost => p !== null);
  return { posts, complete: r.complete, exhausted: r.exhausted, resume: r.resume };
}

/* ═══ تخريط المقاييس ═══

   المزوّد يوحّد أربعةً في المستوى الأعلى — الإعجاب والتعليق والمشاركة
   والحفظ — ويضع ما عداها في `extra` بأسماء المنصّة نفسها: `view_count`
   لتيك توك، و`impressionCount` للينكدإن، و`reach` لإنستغرام. وقد يردّ
   الأربعة بلاحقة (`like_count`، `comments_count`).

   وثلاث قواعد:
   ١) الاسم يُردّ إلى أصله قبل الجمع — `like_count` إعجابٌ كـ`likes`. وكان
      التطابق حرفياً، فكل مقياسٍ بلاحقةٍ خارج التفاعل: صفر.
   ٢) ما في `extra` لا يُضاف إلى ما في المستوى الأعلى باسمه الموحّد — وإلا
      عُدّ الإعجاب مرّتين.
   ٣) الغياب ليس صفراً: ما لم يُعلَن يعود `null`، ومنشورٌ لم تُعلَن له أرقام
      أصلاً `present: false` — فلا يدخل مجموعاً ولا متوسّطاً. */

const METRIC_ALIASES: Record<string, string> = {
  like: 'likes', like_count: 'likes', likes_count: 'likes', likecount: 'likes', favorite_count: 'favorites',
  favorites: 'favorites', favourites: 'favorites',
  reaction_count: 'reactions', reactions_count: 'reactions', reactioncount: 'reactions',
  comment: 'comments', comment_count: 'comments', comments_count: 'comments', commentcount: 'comments',
  share: 'shares', share_count: 'shares', shares_count: 'shares', sharecount: 'shares',
  repost_count: 'reposts', reposts_count: 'reposts', retweet_count: 'retweets', quote_count: 'quotes',
  save: 'saves', saved: 'saves', save_count: 'saves', saves_count: 'saves', bookmark_count: 'bookmarks',
  click: 'clicks', click_count: 'clicks', clicks_count: 'clicks', clickcount: 'clicks',
  follow_count: 'follows',
  view: 'views', view_count: 'views', views_count: 'views', viewcount: 'views', video_views: 'views', play_count: 'views', plays: 'views',
  impression_count: 'impressions', impressioncount: 'impressions',
  reach_count: 'reach',
};

/** مقاييس التفاعل — تُجمع في «التفاعل». */
const ENGAGE = new Set(['reactions', 'comments', 'shares', 'reposts', 'saves', 'clicks', 'likes', 'quotes', 'follows', 'favorites', 'retweets', 'bookmarks']);

/** الاسم الموحّد لمقياس — أو `null` لما ليس مقياساً معروفاً. */
function canonicalMetric(key: string): string | null {
  const k = METRIC_ALIASES[key] ?? key;
  if (ENGAGE.has(k) || k === 'reach' || k === 'impressions' || k === 'views') return k;
  return null;
}

/** أسماءٌ لا تُعدّ ظهوراً ولا وصولاً وإن حوت الكلمة: مدّةٌ ونسبةٌ ومتوسّط. */
function isRatioLike(key: string): boolean {
  return /rate|ratio|percent|avg|average|duration|time|_ms$|seconds/.test(key);
}

export function mapMetrics(metricsObj: any): {
  reach: number | null;
  impressions: number | null;
  engagement: number | null;
  raw: any[];
  /** أعلن المزوّد أرقاماً أصلاً — لا صفراً افتراضياً عن غياب. */
  present: boolean;
  /** متى زامن المزوّد هذه الأرقام من المنصّة (`metrics_synced_at`) إن أعلنه. */
  syncedAt: string | null;
} {
  const top = new Map<string, number>();
  const nested = new Map<string, number>();
  // الاسم كما أرسله المزوّد — يُحفظ مع الموحَّد فلا يضيع أصلُه
  const original = new Map<string, string>();
  let syncedAt: unknown;

  const put = (into: Map<string, number>, key: string, value: unknown) => {
    const n = typeof value === 'number' ? value : Number(value);
    // معرّفٌ أو ترتيبٌ رقميّ ليس مقياساً — ولا يجعل منشوراً بلا أرقام «مقيساً»
    if (!key || !Number.isFinite(n) || key === 'id' || /_id$|^index$|position|version/.test(key)) return;
    const k = METRIC_ALIASES[key] ?? key;
    if (!into.has(k)) into.set(k, n);
    if (!original.has(k)) original.set(k, key);
  };

  if (Array.isArray(metricsObj)) {
    for (const m of metricsObj) put(top, String(m?.type || m?.name || '').toLowerCase(), m?.value);
  } else if (metricsObj && typeof metricsObj === 'object') {
    if ('metrics_synced_at' in metricsObj) syncedAt = metricsObj.metrics_synced_at;
    // نتعمّق في الكائنات المتداخلة (مثل extra:{view_count}) لتسطيح كل المقاييس الرقمية
    const walk = (o: any) => {
      for (const [k, v] of Object.entries(o)) {
        if (v && typeof v === 'object' && !Array.isArray(v)) walk(v);
        else if (typeof v === 'number') put(nested, k.toLowerCase(), v);
      }
    };
    // المستوى الأعلى أوّلاً ثم المتداخل — فيُحفظ للاسم الموحَّد أصلُه من حيث أُخذت قيمته
    for (const [k, v] of Object.entries(metricsObj)) if (typeof v === 'number') put(top, k.toLowerCase(), v);
    for (const v of Object.values(metricsObj)) if (v && typeof v === 'object' && !Array.isArray(v)) walk(v);
  }

  // المستوى الأعلى يسبق: ما في `extra` يُكمل ولا يُكرّر
  const entries = new Map(top);
  for (const [k, v] of nested) if (!entries.has(k)) entries.set(k, v);

  const raw: any[] = [];
  for (const [key, value] of entries) {
    raw.push({ type: key, name: original.get(key) ?? key, value, unit: key.includes('rate') ? 'percentage' : 'count' });
  }

  /* الوصول والظهور والمشاهدات: الاسم الصريح أوّلاً، وإلا أكبرُ ما حمل الكلمة.
     الجمعُ على كل ما حوى «impression» كان يضمّ الظهور الكلّي والفريد
     والمدفوع والعضوي في رقمٍ واحد — أضعافَ الحقيقة. */
  const pick = (exact: string, word: string): number | null => {
    if (entries.has(exact)) return entries.get(exact) as number;
    let best: number | null = null;
    for (const [k, v] of entries) {
      // «reviews» تحوي «view» وليست مشاهدة
      if (k.includes(word) && !isRatioLike(k) && !k.includes('review') && (best === null || v > best)) best = v;
    }
    return best;
  };
  const reach = pick('reach', 'reach');
  const views = pick('views', 'view');
  const impressions = pick('impressions', 'impression') ?? views ?? reach;

  let engagement: number | null = null;
  for (const [k, v] of entries) {
    if (ENGAGE.has(k)) engagement = (engagement ?? 0) + v;
  }

  /* مزوّدٌ صرّح بأنه لم يُزامن أرقام هذا المنشور بعد (`metrics_synced_at: null`)
     وأعاد أصفاراً: أصفارُه غيابٌ لا قياس. */
  const allZero = raw.every((r) => r.value === 0);
  const present = raw.length > 0 && !(syncedAt === null && allZero);
  const stamp = typeof syncedAt === 'string' && syncedAt ? toIso(syncedAt) : null;

  if (!present) return { reach: null, impressions: null, engagement: null, raw, present, syncedAt: stamp };
  return { reach, impressions, engagement, raw, present, syncedAt: stamp };
}

/* ═══ صندوق الوارد ═══

   كل ما في الصندوق «تفاعل» عند المزوّد: معرّفٌ ثابت ونوعٌ ومنصّةٌ وكاتبٌ
   ونصٌّ ووقت. وهذه الدوال تقرأه صفحاتٍ بميزانية وتخرّطه — ولا تكتب شيئاً:
   الكتابة وتتبّع ما قُرئ في `services/commentsSync.ts`. */

/** عنصر صندوق وارد موحّد (تعليق/رسالة/إشارة/مراجعة) مع منصّته */
export type InboxItem = {
  id: string;
  platform: string;
  kind: 'comment' | 'dm' | 'mention' | 'review';
  authorName: string;
  body: string;
  createdAt: string;
  capabilities?: Record<string, boolean>;
  isHidden?: boolean;
  repliedBody?: string | null; // ردٌّ موجود على المنصة كُتب من خارج هذه المنصة
  repliedAt?: string | null; // ووقته إن أعلنه المزوّد
  rating?: number | null; // تقييم بالنجوم (١..٥) للمراجعات
  /** معرّف المزوّد `sapi_cmt_…` — يُحفظ كي تُفحص ردود التعليق القديم بالمسار الآخر أيضاً. */
  interactionId?: string | null;
};

/** منشورٌ عليه تعليقات كما يردّه `/inbox/comments`. */
export type InboxPost = {
  postId: string;
  accountId: string;
  platform: string;
  /** بصمةُ نشاطه — تتغيّر بتعليقٍ جديد، فيُعاد جلبُ تعليقاته. فارغةٌ إن لم يُعلِن المزوّد شيئاً. */
  signature: string;
};

export function mapInboxPost(row: any): InboxPost | null {
  const postId = String(row?.id || row?.post_id || row?.inbox_post_id || '');
  if (!postId) return null;
  const count = row?.comment_count ?? row?.comments_count ?? row?.total_comments ?? row?.count ?? '';
  const touched = row?.last_comment_at ?? row?.updated_at ?? row?.last_activity_at ?? '';
  return {
    postId,
    accountId: String(row?.account_id || row?.account?.id || ''),
    platform: String(row?.platform || row?.account?.platform || 'unknown'),
    signature: count === '' && touched === '' ? '' : `${count}|${touched}`,
  };
}

/**
 * المنشورات التي عليها تعليقات — الأحدث نشاطاً أوّلاً، مئةٌ في الصفحة. والدورة
 * المعتادة تقرأ أوّلها؛ وسحبُ السجلّ يمضي من مؤشّرٍ محفوظ إلى آخرها.
 */
export async function listInboxPosts(
  apiKey: string,
  opts: { budget?: CallBudget; maxPages: number; startCursor?: string | null },
): Promise<{ posts: InboxPost[]; complete: boolean; exhausted: boolean; resume: string | null }> {
  const r = await sapiList(apiKey, EP.comments, { limit: 100 }, {
    budget: opts.budget, maxPages: opts.maxPages, keys: ['posts', 'comments'], startCursor: opts.startCursor,
  });
  const posts = r.items.map(mapInboxPost).filter((p): p is InboxPost => p !== null);
  return { posts, complete: r.complete, exhausted: r.exhausted, resume: r.resume };
}

/** تعليقٌ كما يردّه المزوّد، بما يلزم للكتابة ولتمييز الردود. */
export type SapiComment = {
  /** معرّف التعليق المستعمل في ترميز السجلّ — بترتيب الأسبقية القديم نفسه كي لا يتكرّر سجلّ. */
  commentId: string;
  /** معرّف المزوّد `sapi_cmt_…` إن وُجد — به تُقرأ الردود في المسار الآخر. */
  interactionId: string;
  body: string;
  authorName: string;
  createdAt: string;
  capabilities?: Record<string, boolean>;
  isHidden: boolean;
  /** عدد الردود على المنصة كما يعلنه المزوّد — `null` إن لم يُعلنه. */
  replyCount: number | null;
  /** ردودٌ مضمّنة في التعليق نفسه إن جاءت معه. */
  replies: any[] | null;
  /** ردٌّ على تعليقٍ آخر لا تعليقٌ مستقلّ. */
  parentId: string | null;
  raw: any;
};

function textOf(c: any): string {
  if (typeof c?.content === 'string') return c.content;
  return String(c?.text || c?.content?.text || c?.body || c?.message || c?.comment || '');
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function mapComment(c: any): SapiComment {
  const embedded = Array.isArray(c?.replies) ? c.replies : Array.isArray(c?.replies?.data) ? c.replies.data : null;
  const rawId = String(c?.id ?? '');
  return {
    commentId: String(c?.platform_id || c?.id || c?.comment_id || ''),
    interactionId: rawId.startsWith('sapi_') ? rawId : String(c?.interaction_id || ''),
    body: textOf(c),
    authorName: c?.author_name || c?.author_username || c?.author?.name || c?.author?.username || 'مستخدم',
    createdAt: toIso(c?.created_at || c?.created || c?.timestamp),
    capabilities: c?.capabilities && typeof c.capabilities === 'object' ? c.capabilities : undefined,
    isHidden: !!c?.is_hidden,
    replyCount: numOrNull(c?.reply_count ?? c?.replies_count ?? c?.replies?.count ?? c?.replies?.total_count ?? c?.replies?.total),
    replies: embedded,
    parentId: (() => {
      const p = c?.parent_id ?? c?.parent_comment_id ?? c?.in_reply_to ?? c?.parent?.id ?? null;
      return p === null || p === undefined || p === '' ? null : String(p);
    })(),
    raw: c,
  };
}

/**
 * أمِن حسابنا هذا التفاعل؟
 *
 * العلامة الصريحة أولاً إن أعلنها المزوّد، ثم المطابقة بمعرّف الكاتب أو اسمه
 * مع ما يُعرف به الحساب. وما لم تثبت نسبتُه إلينا فليس منّا: تعليقُ عميلٍ
 * يُحسب ردّاً منّا يسقط من «بلا رد» ولا يجيبه أحد — وهذا أسوأ الخطأين.
 */
export function isOwnAuthor(c: any, ownerKeys: Set<string>): boolean {
  const flags = [c?.is_owner, c?.is_own, c?.is_self, c?.is_mine, c?.from_owner, c?.from_me, c?.is_from_me, c?.is_page_owner,
    c?.author?.is_owner, c?.author?.is_self, c?.author?.is_me];
  if (flags.some((f) => f === true)) return true;
  const dir = normKey(c?.direction);
  if (dir === 'outgoing' || dir === 'outbound' || dir === 'sent') return true;
  if (!ownerKeys.size) return false;
  const a = c?.author && typeof c.author === 'object' ? c.author : {};
  const candidates = [a.id, a.platform_id, a.username, a.handle, a.name, c?.author_id, c?.author_username, c?.author_name, c?.username, c?.from?.id, c?.from?.name]
    .map(normKey)
    .filter((k) => k.length >= 3);
  return candidates.some((k) => ownerKeys.has(k));
}

/**
 * تعليقات منشور — من الأقدم إلى الأحدث، فتُقرأ الصفحات إلى آخرها كي لا يضيع
 * أحدثُها. ومنشورٌ قُرئ من قبل يُستأنف من آخر صفحةٍ بلغها لا من أوّله.
 */
export async function listPostComments(
  apiKey: string,
  postId: string,
  accountId: string,
  opts: { budget?: CallBudget; maxPages: number; startCursor?: string | null },
): Promise<{ comments: SapiComment[]; complete: boolean; exhausted: boolean; resume: string | null }> {
  const r = await sapiList(
    apiKey,
    EP.postComments(postId),
    { account_id: accountId || undefined, limit: 100 },
    { budget: opts.budget, maxPages: opts.maxPages, keys: ['comments'], startCursor: opts.startCursor },
  );
  return { comments: r.items.map(mapComment), complete: r.complete, exhausted: r.exhausted, resume: r.resume };
}

export type RepliesPath = 'inbox' | 'interactions';

/**
 * ردود تعليقٍ على المنصة.
 *
 * مساران موثّقان عند المزوّد: `‎/inbox/comments/{post}/{comment}/replies` في
 * عقدته الأحدث، و`‎/accounts/{account}/interactions/{sapi_cmt}/replies` في
 * الأقدم. يُجرّب المسار الذي نجح آخر مرّة أوّلاً، ويُعاد أيّهما أجاب — أو
 * `null` إن لم يُجب أيٌّ منهما لهذه المنصّة.
 */
export async function listCommentReplies(
  apiKey: string,
  args: { postId: string; accountId: string; commentId: string; interactionId: string },
  opts: { budget?: CallBudget; prefer?: RepliesPath | null },
): Promise<{ replies: any[]; path: RepliesPath | null }> {
  const order: RepliesPath[] = opts.prefer === 'interactions' ? ['interactions', 'inbox'] : ['inbox', 'interactions'];
  for (const path of order) {
    if (path === 'interactions' && (!args.interactionId || !args.accountId)) continue;
    const url = path === 'inbox'
      ? `${EP.postComments(args.postId)}/${encodeURIComponent(args.commentId)}/replies`
      : `/accounts/${encodeURIComponent(args.accountId)}/interactions/${encodeURIComponent(args.interactionId)}/replies`;
    try {
      const r = await sapiList(apiKey, url, { account_id: path === 'inbox' ? args.accountId || undefined : undefined, limit: 50 }, { budget: opts.budget, maxPages: 1, keys: ['replies', 'comments'] });
      if (r.exhausted) throw new BudgetExhausted();
      return { replies: r.items, path };
    } catch (err) {
      if (isUnsupported(err)) continue;
      throw err;
    }
  }
  return { replies: [], path: null };
}

/** أحدثُ ردٍّ من حسابنا بين ردود تعليق — نصُّه ووقته ومعرّفه على المنصة. */
export function ownReply(replies: any[], ownerKeys: Set<string>): { text: string; at: string | null; id: string | null } | null {
  let best: { text: string; at: string | null; id: string | null; t: number } | null = null;
  for (const r of replies) {
    if (!isOwnAuthor(r, ownerKeys)) continue;
    const atRaw = r?.created_at || r?.created || r?.timestamp || null;
    const at = atRaw ? toIso(atRaw) : null;
    const t = at ? new Date(at).getTime() : 0;
    if (!best || t >= best.t) best = { text: textOf(r), at, id: r?.platform_id || r?.id ? String(r.platform_id || r.id) : null, t };
  }
  return best ? { text: best.text, at: best.at, id: best.id } : null;
}

/** يخرّط مراجعةً — والمعرّف بالترميز القديم نفسه «rv:{حساب}:{مراجعة}» كي لا تتكرّر. */
export function mapReview(r: any, fallbackAccountId: string, fallbackPlatform: string): InboxItem | null {
  const body = String(r?.text || r?.comment || (typeof r?.content === 'string' ? r.content : r?.content?.text) || r?.body || '');
  const rid = String(r?.id || r?.review_id || r?.platform_id || '');
  // نتجاهل التقييمات بلا نص (تقييم نجوم فقط) — نعرض ما فيه تعليق مكتوب فقط.
  if (!body.trim() || !rid) return null;
  const accountId = String(r?.account_id || r?.account?.id || fallbackAccountId || '');
  const stars = Number(r?.rating ?? r?.star_rating ?? r?.stars);
  const reply = r?.reply ?? r?.owner_reply ?? r?.business_reply ?? r?.response ?? null;
  const replyText = typeof reply === 'string' ? reply : reply?.text || reply?.comment || r?.reply_text || null;
  const replyAtRaw = (reply && typeof reply === 'object' ? reply.created_at || reply.updated_at || reply.timestamp : null) || r?.replied_at || r?.reply_created_at || null;
  return {
    id: `rv:${accountId}:${rid}`,
    platform: String(r?.platform || fallbackPlatform || 'google'),
    kind: 'review',
    // الاسم نظيف — التقييم يُخزَّن رقماً في حقل مستقل ويُعرض نجوماً في الواجهة
    authorName: r?.author_name || r?.reviewer || r?.name || r?.author?.name || 'مراجعة',
    body,
    createdAt: toIso(r?.created_at || r?.updated_at || r?.created || r?.timestamp),
    repliedBody: replyText ? String(replyText) : null,
    repliedAt: replyText && replyAtRaw ? toIso(replyAtRaw) : null,
    rating: Number.isFinite(stars) && stars > 0 ? stars : null,
  };
}

/**
 * المراجعات — قائمةً مباشرة في عقد المزوّد الحالي، أو ملخّصاً لكل حساب يتبعه
 * نداءٌ لكل حساب في العقد الأقدم. يُقرأ الشكلان.
 */
export async function listReviews(apiKey: string, opts: { budget?: CallBudget; maxPages: number }): Promise<{ items: InboxItem[]; complete: boolean; exhausted: boolean }> {
  const r = await sapiList(apiKey, EP.reviews, { limit: 100 }, { budget: opts.budget, maxPages: opts.maxPages, keys: ['reviews'] });
  const items: InboxItem[] = [];
  let complete = r.complete;
  let exhausted = r.exhausted;
  for (const row of r.items) {
    if (looksLikeReview(row)) {
      const it = mapReview(row, '', String(row?.platform || 'google'));
      if (it) items.push(it);
      continue;
    }
    // ملخّص حساب — المراجعات في نداءٍ ثانٍ
    const accountId = String(row?.account_id || row?.id || '');
    if (!accountId) continue;
    try {
      const detail = await sapiList(apiKey, EP.reviewsForAccount(accountId), { limit: 100 }, { budget: opts.budget, maxPages: 1, keys: ['reviews'] });
      if (detail.exhausted) { exhausted = true; complete = false; break; }
      for (const d of detail.items) {
        const it = mapReview(d, accountId, String(row?.platform || 'google'));
        if (it) items.push(it);
      }
    } catch (err) {
      if (!isUnsupported(err)) throw err;
    }
  }
  return { items, complete, exhausted };
}

/** محادثةٌ خاصة كما تردّها القائمة. */
export type SapiConversation = {
  id: string;
  accountId: string;
  platform: string;
  participant: string;
  lastText: string;
  /** وقت آخر رسالة إن أعلنه المزوّد — `null` إن غاب. */
  lastAt: string | null;
  /** اتجاه آخر رسالة إن أعلنه المزوّد — `in` منهم و`out` منّا. */
  lastDirection: 'in' | 'out' | null;
};

export function directionOf(v: unknown): 'in' | 'out' | null {
  const d = normKey(v);
  if (['incoming', 'inbound', 'received', 'in'].includes(d)) return 'in';
  if (['outgoing', 'outbound', 'sent', 'out'].includes(d)) return 'out';
  return null;
}

export function mapConversation(cv: any, account: SocialApiAccount | null): SapiConversation | null {
  const id = String(cv?.id || cv?.conversation_id || '');
  if (!id) return null;
  const last = cv?.last_message;
  const lastObj = last && typeof last === 'object' ? last : null;
  const fromMe = cv?.last_message_from_me ?? cv?.last_message_is_from_me ?? lastObj?.is_from_me ?? lastObj?.from_me;
  return {
    id,
    accountId: String(cv?.account_id || cv?.account?.id || account?.id || ''),
    platform: String(cv?.platform || account?.platform || 'unknown'),
    participant: cv?.participant_name || cv?.participant?.name || cv?.participant?.username || cv?.from || 'مستخدم',
    lastText: typeof last === 'string' ? last : String(lastObj?.text || cv?.last_message_text || cv?.snippet || ''),
    lastAt: isoOrNull(lastObj?.created_at || cv?.last_message_at || cv?.updated_at || cv?.created_at),
    lastDirection: directionOf(lastObj?.direction ?? cv?.last_message_direction) ?? (fromMe === true ? 'out' : fromMe === false ? 'in' : null),
  };
}

/** منصّاتٌ يدعم المزوّد فيها الرسائل الخاصة والإشارات — وما عداها يردّ «غير مدعوم». */
export function supportsDirectInbox(platform: string): boolean {
  return /instagram|facebook|messenger/.test(platform.toLowerCase());
}

/**
 * المحادثات — نداءٌ واحد لكل الحسابات إن حملت كلُّ محادثةٍ حسابَها، وإلا
 * نداءٌ لكل حسابٍ يدعم الرسائل. والمعرّف يُبنى بالحساب كما كان يُبنى، فلا
 * يتكرّر سجلٌّ كُتب قبل هذا.
 */
export async function listConversations(
  apiKey: string,
  accounts: SocialApiAccount[],
  opts: { budget?: CallBudget; pages?: number },
): Promise<{ conversations: SapiConversation[]; complete: boolean; exhausted: boolean }> {
  const pages = opts.pages ?? 2;
  try {
    const all = await sapiList(apiKey, EP.conversations, { limit: 100 }, { budget: opts.budget, maxPages: pages, keys: ['conversations'] });
    if (all.exhausted) return { conversations: [], complete: false, exhausted: true };
    const mapped = all.items.map((cv) => mapConversation(cv, accounts.find((a) => a.id === String(cv?.account_id || '')) ?? null));
    if (mapped.every((c) => c && c.accountId)) {
      return { conversations: mapped.filter((c): c is SapiConversation => c !== null), complete: all.complete, exhausted: false };
    }
  } catch (err) {
    if (err instanceof BudgetExhausted) return { conversations: [], complete: false, exhausted: true };
    if (!isUnsupported(err)) throw err;
  }
  const out: SapiConversation[] = [];
  for (const acc of accounts.filter((a) => supportsDirectInbox(a.platform))) {
    try {
      const r = await sapiList(apiKey, EP.conversations, { account_id: acc.id, platform: acc.platform, limit: 50 }, { budget: opts.budget, maxPages: Math.max(pages - 1, 1), keys: ['conversations'] });
      if (r.exhausted) return { conversations: out, complete: false, exhausted: true };
      for (const cv of r.items) {
        const c = mapConversation(cv, acc);
        if (c) out.push({ ...c, accountId: acc.id });
      }
    } catch (err) {
      if (!isUnsupported(err)) throw err;
    }
  }
  return { conversations: out, complete: true, exhausted: false };
}

/** أحدثُ رسالةٍ واردة وأحدثُ رسالةٍ منّا في محادثة — من رسائلها، الأحدث أوّلاً. */
export async function conversationLatest(
  apiKey: string,
  conversationId: string,
  budget?: CallBudget,
): Promise<{ lastIn: { text: string; at: string } | null; lastOut: { text: string; at: string; id: string | null } | null }> {
  const r = await sapiList(apiKey, EP.conversationMessages(conversationId), { limit: 20 }, { budget, maxPages: 1, keys: ['messages'] });
  if (r.exhausted) throw new BudgetExhausted();
  let lastIn: { text: string; at: string } | null = null;
  let lastOut: { text: string; at: string; id: string | null } | null = null;
  for (const m of r.items) {
    // رسالةٌ بلا وقت لا تُرتَّب — فلا تُحسب أحدث ولا أقدم
    const at = isoOrNull(m?.created_at || m?.timestamp || m?.sent_at);
    if (!at) continue;
    const dir = directionOf(m?.direction) ?? (m?.is_from_me === true || m?.from_me === true ? 'out' : m?.is_from_me === false ? 'in' : null);
    if (dir === 'in' && (!lastIn || at > lastIn.at)) lastIn = { text: textOf(m), at };
    if (dir === 'out' && (!lastOut || at > lastOut.at)) lastOut = { text: textOf(m), at, id: m?.id ? String(m.id) : null };
  }
  return { lastIn, lastOut };
}

export type MentionsPath = 'accounts' | 'inbox';

/**
 * الإشارات لحسابٍ واحد — `‎/accounts/{id}/mentions` في عقد المزوّد، و`‎/inbox/mentions`
 * احتياطاً لمن بقي على العقد الأقدم. ولا تُطلب إلا لمنصّةٍ تدعمها.
 */
export async function listMentions(
  apiKey: string,
  account: SocialApiAccount,
  opts: { budget?: CallBudget; prefer?: MentionsPath | null; pages?: number },
): Promise<{ items: InboxItem[]; path: MentionsPath | null }> {
  const pages = opts.pages ?? 1;
  const order: MentionsPath[] = opts.prefer === 'inbox' ? ['inbox', 'accounts'] : ['accounts', 'inbox'];
  for (const path of order) {
    try {
      const r = path === 'accounts'
        ? await sapiList(apiKey, `/accounts/${encodeURIComponent(account.id)}/mentions`, { limit: 50 }, { budget: opts.budget, maxPages: pages, keys: ['mentions'] })
        : await sapiList(apiKey, EP.mentions, { account_id: account.id, platform: account.platform, limit: 50 }, { budget: opts.budget, maxPages: pages, keys: ['mentions'] });
      if (r.exhausted) throw new BudgetExhausted();
      const items: InboxItem[] = [];
      for (const m of r.items) {
        const mid = String(m?.id || m?.platform_id || '');
        if (!mid) continue;
        const accountId = String(m?.account_id || m?.account?.id || account.id);
        const mediaId = String(m?.metadata?.media_id || m?.media_id || '');
        // نُرمّز "mn:{mentionId}:{accountId}:{mediaId}" للرد لاحقاً — الترميز القديم نفسه.
        items.push({
          id: `mn:${mid}:${accountId}:${mediaId}`,
          platform: String(m?.platform || account.platform),
          kind: 'mention',
          authorName: m?.author?.name || m?.author_name || m?.username || 'مستخدم',
          body: String(m?.content?.text || m?.text || m?.caption || ''),
          createdAt: toIso(m?.created_at || m?.received_at || m?.timestamp),
        });
      }
      return { items, path };
    } catch (err) {
      if (isUnsupported(err)) continue;
      throw err;
    }
  }
  return { items: [], path: null };
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
  // 5) الإشارات
  try { out.mentions = await sapi<any>(apiKey, 'GET', `${EP.mentions}?limit=5`); }
  catch (e: any) { out.mentions_error = String(e?.message || e); }
  // 6.5) تصديرات التحليلات (قراءة مجانية — لتأكيد الشكل قبل استهلاك رصيد التصدير)
  try { out.exports = await sapi<any>(apiKey, 'GET', EP.exports); }
  catch (e: any) { out.exports_error = String(e?.message || e); }
  // 6) المحادثات (رسائل خاصة) لأول حساب
  let allAccts: SocialApiAccount[] = [];
  try {
    allAccts = await listSocialApiAccounts(apiKey);
    out.accounts_sample = allAccts.map((a) => ({ id: a.id, platform: a.platform, name: a.name }));
    const first = allAccts[0];
    if (first) {
      const q = `?account_id=${encodeURIComponent(first.id)}${first.platform ? `&platform=${encodeURIComponent(first.platform)}` : ''}&limit=5`;
      out.conversations = await sapi<any>(apiKey, 'GET', `${EP.conversations}${q}`);
    }
  } catch (e: any) { out.conversations_error = String(e?.message || e); }
  return out;
}

/* ═══ تشخيص الصندوق ═══

   التعليقات لا تُحفظ ولا يظهر خطأ: المزوّد يجيب ولا يُقرأ من جوابه شيء. وسببُه
   في شكل الجواب — أين قائمته، وبأيّ معرّفٍ يُطلب المنشور — ولا يُعرف إلا منه.
   فهذا يطلب ما تطلبه المزامنة، ويعيد بنية كل جوابٍ لا قيمَه: مفاتيحَ كل مستوى
   وأنواعَها وأطوال القوائم، ومعها المعرّفات والأعداد وحدها. وما تحت كاتبٍ أو
   مُرسِلٍ يُطوى إلى نوعه، والنصوص كذلك: التشخيص يُفتح في المتصفح ويُصوَّر
   ويُرسل، وتعليقُ عميلٍ واسمُه لا يخرجان في صورة.

   وليس هو `debugSocialApi` أعلاه: ذاك يعيد الجواب خاماً بنصوصه وأسمائه. */

/** مفاتيح تُعرض قيمُها — معرّفاتٌ وأعدادٌ لا تكشف أحداً. */
const DIAG_VALUES = new Set([
  'id', 'post_id', 'inbox_post_id', 'platform_post_id', 'platform_id', 'account_id', 'platform', 'interaction_id', 'parent_id',
  'comment_count', 'comments_count', 'reply_count', 'replies_count', 'count', 'total', 'has_more', 'next_cursor', 'cursor', 'status',
]);
/** ما تحتها شخصٌ لا منشور — لا تُعرض منها قيمة ولو كانت معرّفاً. */
const DIAG_PERSONAL = new Set(['author', 'from', 'user', 'sender', 'recipient', 'commenter', 'owner', 'profile']);

/** بنية قيمةٍ بلا محتواها: الكائن مفاتيحُه، والقائمة طولُها وبنيةُ أوّلها، والباقي نوعُه. */
export function shapeOf(v: unknown, key = '', depth = 0, personal = false): unknown {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.length ? [`${v.length}×`, shapeOf(v[0], key, depth + 1, personal)] : ['0×'];
  if (typeof v === 'object') {
    if (depth >= 5) return '{…}';
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, shapeOf(x, k, depth + 1, personal || DIAG_PERSONAL.has(k))]),
    );
  }
  return !personal && DIAG_VALUES.has(key) ? v : typeof v;
}

/** أوّل ثلاثة أحرفٍ وطولُ الباقي — تكفي لمقارنة كاتبٍ بحسابنا، ولا تكشف اسم عميل. */
function maskKey(v: unknown): string {
  const s = normKey(v);
  return s.length <= 3 ? '•'.repeat(s.length) : `${s.slice(0, 3)}…(${s.length})`;
}

/** حقول الكاتب التي يقارنها `isOwnAuthor`، مقنّعةً، ومع كلٍّ منها: أهو من مفاتيح حسابنا؟ */
function maskedAuthor(r: any, ownerKeys: Set<string>): Record<string, { hint: string; ours: boolean }> {
  const a = r?.author && typeof r.author === 'object' ? r.author : {};
  const fields: Record<string, unknown> = {
    'author.id': a.id, 'author.platform_id': a.platform_id, 'author.username': a.username, 'author.handle': a.handle,
    'author.name': a.name, author_id: r?.author_id, author_username: r?.author_username, author_name: r?.author_name,
    username: r?.username, 'from.id': r?.from?.id, 'from.name': r?.from?.name,
  };
  const out: Record<string, { hint: string; ours: boolean }> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null || v === '') continue;
    out[k] = { hint: maskKey(v), ours: ownerKeys.has(normKey(v)) };
  }
  return out;
}

type DiagTry = { field: string; value: string; error?: string; shape?: unknown; parsed: number };
type DiagPost = { id: string; platform: string; comments: unknown; updated: unknown };

const diagPost = (r: any): DiagPost => ({
  id: String(r?.id ?? r?.post_id ?? ''),
  platform: String(r?.platform || r?.account?.platform || ''),
  comments: r?.comment_count ?? r?.comments_count ?? null,
  updated: r?.updated_at ?? r?.last_comment_at ?? null,
});
type DiagReply = { own: boolean; author: Record<string, { hint: string; ours: boolean }> };

export type InboxDiagnosis = {
  at: string;
  calls: number;
  accounts: { id: string; platform: string; ownerKeys: string[] }[] | { error: string };
  /** `parsed` ما يقرؤه المحلّل نفسه الذي تقرأ به المزامنة، و`posts` عددُ تعليقات كلٍّ كما يعلنه المزوّد. */
  inbox: { error?: string; shape?: unknown; parsed: number; posts?: DiagPost[] };
  /** ما عليه تعليقٌ واحدٌ على الأقل بمرشّح المزوّد نفسه (`min_comments=1`) — لا بعدّنا. */
  withComments: { error?: string; parsed: number; posts?: DiagPost[] };
  posts: { platform: string; accountId: string; tries: DiagTry[] }[];
  replies: {
    comment: string;
    embedded: DiagReply[] | null;
    tries: { path: RepliesPath; error?: string; shape?: unknown; replies: DiagReply[] }[];
  } | null;
};

/**
 * يطلب ما تطلبه المزامنة ويعيد بنيته: الحسابات ومفاتيحها، وقائمة الصندوق،
 * وتعليقات منشورٍ من كل منصّة بكل معرّفٍ محتمل له، وردود تعليقٍ واحد بمساريها.
 * أربعةٌ وعشرون نداءً على الأكثر.
 */
export async function diagnoseInbox(apiKey: string): Promise<InboxDiagnosis> {
  const budget = new CallBudget(24);
  const errorOf = (e: unknown) => String((e as Error)?.message || e).slice(0, 300);
  const out: InboxDiagnosis = {
    at: new Date().toISOString(), calls: 0, accounts: [], inbox: { parsed: 0 }, withComments: { parsed: 0 }, posts: [], replies: null,
  };

  let accounts: SocialApiOwnedAccount[] = [];
  try {
    accounts = await listSocialApiAccountsDetailed(apiKey, budget);
    out.accounts = accounts.map((a) => ({ id: a.id, platform: a.platform, ownerKeys: a.ownerKeys }));
  } catch (e) {
    out.accounts = { error: errorOf(e) };
  }

  let rows: any[] = [];
  try {
    const data = await sapi<any>(apiKey, 'GET', `${EP.comments}?limit=25`, undefined, budget);
    rows = itemsOf(data, 'posts', 'comments');
    out.inbox = { shape: shapeOf(data), parsed: rows.length, posts: rows.map(diagPost) };
  } catch (e) {
    out.inbox = { error: errorOf(e), parsed: 0 };
  }

  let withComments: any[] = [];
  try {
    const data = await sapi<any>(apiKey, 'GET', `${EP.comments}?min_comments=1&limit=25`, undefined, budget);
    withComments = itemsOf(data, 'posts', 'comments');
    out.withComments = { parsed: withComments.length, posts: withComments.map(diagPost) };
  } catch (e) {
    out.withComments = { error: errorOf(e), parsed: 0 };
  }

  /* منشورٌ من كل منصّة، ثلاثةٌ على الأكثر — فما يخصّ منصّةً لا يُحسب على غيرها.
     وما عليه تعليقات أوّلاً: منشورٌ بلا تعليقٍ يعيد قائمةً فارغة ولا يدلّ على شيء. */
  const count = (r: any) => Number(r?.comment_count ?? r?.comments_count ?? 0) || 0;
  const ordered = [...withComments, ...[...rows].sort((a, b) => count(b) - count(a))];
  const picked: any[] = [];
  const platforms = new Set<string>();
  for (const r of ordered) {
    const p = String(r?.platform || r?.account?.platform || '');
    if (platforms.has(p)) continue;
    platforms.add(p);
    picked.push(r);
    if (picked.length === 3) break;
  }

  let sample: { postId: string; accountId: string; comment: any } | null = null;
  for (const r of picked) {
    const accountId = String(r?.account_id || r?.account?.id || '');
    const entry = { platform: String(r?.platform || r?.account?.platform || ''), accountId, tries: [] as DiagTry[] };
    // كل معرّفٍ محتمل للمنشور مرّةً واحدة — أيّها يُعيد التعليقات هو الجواب
    const ids = new Map<string, string>();
    for (const field of ['id', 'inbox_post_id', 'post_id', 'platform_post_id']) {
      const v = r?.[field];
      if (v !== undefined && v !== null && v !== '' && !ids.has(String(v))) ids.set(String(v), field);
    }
    for (const [value, field] of ids) {
      if (budget.left <= 3) break;
      try {
        const q = accountId ? `?account_id=${encodeURIComponent(accountId)}` : '';
        const data = await sapi<any>(apiKey, 'GET', `${EP.postComments(value)}${q}`, undefined, budget);
        const list = itemsOf(data, 'comments');
        entry.tries.push({ field, value, shape: shapeOf(data), parsed: list.length });
        if (!sample && list.length) {
          const withReplies = list.find((x) => Number(x?.reply_count ?? x?.replies_count ?? 0) > 0);
          sample = { postId: value, accountId, comment: withReplies ?? list[0] };
        }
      } catch (e) {
        entry.tries.push({ field, value, error: errorOf(e), parsed: 0 });
      }
    }
    out.posts.push(entry);
  }

  if (sample) {
    const s = sample;
    const m = mapComment(s.comment);
    const keys = new Set(accounts.find((a) => a.id === s.accountId)?.ownerKeys ?? accounts.flatMap((a) => a.ownerKeys));
    const describe = (list: any[]): DiagReply[] => list.slice(0, 5).map((r) => ({ own: isOwnAuthor(r, keys), author: maskedAuthor(r, keys) }));
    out.replies = { comment: m.commentId, embedded: m.replies ? describe(m.replies) : null, tries: [] };
    for (const path of ['inbox', 'interactions'] as RepliesPath[]) {
      if (path === 'interactions' && !m.interactionId) {
        out.replies.tries.push({ path, error: 'لا معرّف sapi_cmt_ للتعليق', replies: [] });
        continue;
      }
      if (budget.left <= 0) break;
      const url = path === 'inbox'
        ? `${EP.postComments(s.postId)}/${encodeURIComponent(m.commentId)}/replies${s.accountId ? `?account_id=${encodeURIComponent(s.accountId)}` : ''}`
        : `/accounts/${encodeURIComponent(s.accountId)}/interactions/${encodeURIComponent(m.interactionId)}/replies`;
      try {
        const data = await sapi<any>(apiKey, 'GET', url, undefined, budget);
        out.replies.tries.push({ path, shape: shapeOf(data), replies: describe(itemsOf(data, 'replies', 'comments')) });
      } catch (e) {
        out.replies.tries.push({ path, error: errorOf(e), replies: [] });
      }
    }
  }

  out.calls = budget.used;
  return out;
}

// تصدير التحليلات (Analytics Export) — مهمة غير متزامنة لحساب مربوط تُرجع فيديوهاته مع مقاييسها.
// خاضعة لحدود الخطة (المجانية: تصديران/شهر، ≤٣٠ فيديو، تهدئة ٧ أيام). أساساً ليوتيوب/تيك توك.
export type ExportJob = { id: string; status: string; accountId?: string; platform?: string; progress?: number; videoCount?: number; createdAt?: string };

function mapExportJob(j: any): ExportJob {
  return {
    id: String(j?.id || j?.export_id || ''),
    status: String(j?.status || 'pending'),
    accountId: j?.account_id ? String(j.account_id) : undefined,
    platform: j?.platform ? String(j.platform) : undefined,
    progress: typeof j?.progress === 'number' ? j.progress : undefined,
    videoCount: typeof j?.video_count === 'number' ? j.video_count : (typeof j?.videos_count === 'number' ? j.videos_count : undefined),
    createdAt: j?.created_at ? String(j.created_at) : undefined,
  };
}

export async function createAnalyticsExport(apiKey: string, accountId: string): Promise<ExportJob> {
  const d = await sapi<any>(apiKey, 'POST', EP.exports, { account_id: accountId });
  return mapExportJob(d?.data || d);
}
export async function listAnalyticsExports(apiKey: string): Promise<ExportJob[]> {
  const d = await sapi<any>(apiKey, 'GET', EP.exports);
  const list: any[] = d?.data || d?.exports || (Array.isArray(d) ? d : []);
  return list.map(mapExportJob);
}
export async function getAnalyticsExport(apiKey: string, id: string): Promise<ExportJob> {
  const d = await sapi<any>(apiKey, 'GET', EP.exportItem(id));
  return mapExportJob(d?.data || d);
}
// فيديو من تصدير مكتمل — نُعيده خاماً ويُخرَّط في طبقة التحليلات
export async function getExportVideos(apiKey: string, id: string): Promise<any[]> {
  const d = await sapi<any>(apiKey, 'GET', EP.exportVideos(id));
  return d?.data || d?.videos || (Array.isArray(d) ? d : []);
}

/* ═══ أرقام على مستوى الحساب لا المنشور ═══

   مقاييس المنشورات تصل من `/posts` ومنها تُحتسب الطبقتان الأولى والثانية.
   وما يلي أرقامُ الحساب نفسه — عدد المتابعين وملخّص المراجعات — ولا مسار
   لها من المنشورات: حسابٌ لم يَنشر شيئاً هذا الشهر له متابعون ومراجعات.

   والحقول تُقرأ بأسماءٍ متعدّدة لأن الردّ يختلف بين منصّة ومنصّة، وما لم
   يُوجد منها لا يُكتب صفراً — الغياب ليس صفراً، ومصدرٌ لا يعيد المتابعين
   يترك المؤشر بلا قيمة ويبقى تسجيلُه باليد ممكناً. */

/** يقرأ عدداً من أول اسمٍ موجود في الكائن — وإلا `null`. */
function pickNumber(obj: any, names: string[]): number | null {
  if (!obj || typeof obj !== 'object') return null;
  for (const n of names) {
    const v = obj[n];
    const num = Number(v);
    if (v !== null && v !== undefined && v !== '' && Number.isFinite(num)) return num;
  }
  return null;
}

const FOLLOWER_FIELDS = ['followers', 'followers_count', 'follower_count', 'subscribers', 'subscriber_count', 'audience_size'];

export type SocialApiAudience = { platform: string; accountId: string; followers: number | null };

/**
 * المتابعون لكل حساب — من `/accounts`.
 *
 * والمزوّد يضع العدد في `metadata` مع بقية بيانات المنصّة (`follower_count`
 * بجوار `avatar_url`)، وكانت القراءة تبحث في `stats` و`metrics` و`insights`
 * وحدها — فبقي «إجمالي المتابعين» بلا قيمة لكل منصّة.
 */
export async function socialApiAudience(apiKey: string): Promise<SocialApiAudience[]> {
  const data = await sapi<any>(apiKey, 'GET', EP.accounts);
  const list: any[] = data?.accounts || data?.data || (Array.isArray(data) ? data : []);
  return list.map((a) => ({
    platform: String(a.platform || a.network || a.service || 'unknown'),
    accountId: String(a.id || a.account_id || a.accountId || ''),
    followers:
      pickNumber(a, FOLLOWER_FIELDS) ??
      pickNumber(a.metadata, FOLLOWER_FIELDS) ??
      pickNumber(a.stats, FOLLOWER_FIELDS) ??
      pickNumber(a.metrics, FOLLOWER_FIELDS) ??
      pickNumber(a.insights, FOLLOWER_FIELDS),
  }));
}

/** أهذا العنصر مراجعةٌ بعينها لا ملخّصُ حساب؟ الملخّص يحمل عدداً ومتوسطاً — والمتوسط قد يُسمّى `rating`. */
function looksLikeReview(r: any): boolean {
  if (!r || typeof r !== 'object') return false;
  if (String(r.id || '').startsWith('sapi_rev_')) return true;
  const hasText = typeof r.text === 'string' || typeof r.comment === 'string' || typeof r.content === 'string' || typeof r.content?.text === 'string';
  const hasCount = ['total', 'count', 'total_reviews', 'review_count', 'reviews_count'].some((k) => r[k] !== null && r[k] !== undefined);
  if (hasCount && !hasText) return false;
  return hasText || r.rating != null || r.star_rating != null || r.stars != null || r.reviewer != null || r.author != null;
}

export type SocialApiReviewSummary = { platform: string; accountId: string; count: number | null; average: number | null };

/**
 * ملخّص المراجعات لكل حساب — العدد والمتوسط كما يعلنهما المزوّد.
 *
 * ولا يُحتسبان من المراجعات المسحوبة إلى الصندوق: تلك تُسقط ما لا نصّ له
 * (تقييم نجومٍ بلا تعليق)، فمتوسطُها متوسطُ من كتب لا متوسطُ من قيّم.
 */
export async function socialApiReviewSummary(apiKey: string): Promise<SocialApiReviewSummary[]> {
  /* شكلان: ملخّصٌ لكل حساب (عددٌ ومتوسط)، أو المراجعات نفسها قائمةً — وهو
     عقد المزوّد الحالي. وفي الثاني يُحسب العدد والمتوسط منها كلِّها،
     وفيها تقييمُ النجوم بلا تعليق: القائمة لا تُسقطه، الصندوق وحده يُسقطه. */
  const r = await sapiList(apiKey, EP.reviews, { limit: 100 }, { maxPages: 10, keys: ['reviews'] });
  const list = r.items;
  if (list.length && list.every((x) => looksLikeReview(x))) {
    const byAccount = new Map<string, { platform: string; n: number; rated: number; sum: number }>();
    for (const x of list) {
      const key = String(x.account_id || x.account?.id || '');
      const e = byAccount.get(key) ?? { platform: String(x.platform || 'google'), n: 0, rated: 0, sum: 0 };
      e.n += 1;
      const stars = Number(x.rating ?? x.star_rating ?? x.stars);
      if (Number.isFinite(stars) && stars > 0) {
        e.rated += 1;
        e.sum += stars;
      }
      byAccount.set(key, e);
    }
    return [...byAccount.entries()].map(([accountId, e]) => ({
      platform: e.platform,
      accountId,
      // قائمةٌ لم تُقرأ إلى آخرها لا تُعطي عدداً — تُعطي حدّاً أدنى يُقرأ نقصاً
      count: r.complete ? e.n : null,
      average: e.rated ? Math.round((e.sum / e.rated) * 100) / 100 : null,
    }));
  }
  return list.map((x) => ({
    platform: String(x.platform || 'google'),
    accountId: String(x.account_id || x.id || ''),
    count: pickNumber(x, ['total', 'count', 'total_reviews', 'review_count', 'reviews_count']),
    average: pickNumber(x, ['average', 'average_rating', 'rating', 'avg_rating', 'star_rating']),
  }));
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
// استهلاك الحصة مقابل حدود الخطة (القيمة -1 تعني بلا حد)
export async function socialApiUsage(apiKey: string): Promise<any> {
  return sapi<any>(apiKey, 'GET', '/usage');
}

export async function deleteSocialApiWebhook(apiKey: string, id: string): Promise<void> {
  try { await sapi(apiKey, 'DELETE', `/webhooks/${id}`); } catch { /* غير حرِج */ }
}

export class SocialApiProvider implements PublishingProvider {
  private key: string;
  constructor(apiKey: string, private accounts: Record<string, string>) {
    this.key = (apiKey || '').trim();
  }

  // يرفع وسيطاً إلى SocialAPI ويُعيد media_id (التوثيق: الرابط العام الخام داخل media_ids يُتجاهل،
  // فالرفع أولاً إلزامي). نستخدم multipart لأن المسار يقبل ملفاً مباشرة من الخادم.
  private async uploadMedia(m: { data?: ArrayBuffer; mimeType: string; filename: string }): Promise<string> {
    if (!m.data) throw new Error(`تعذّر قراءة الوسيط «${m.filename}» للرفع`);
    const form = new FormData();
    form.append('file', new Blob([m.data], { type: m.mimeType || 'application/octet-stream' }), m.filename || 'media');
    const res = await fetch(`${BASE}${EP.media}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.key}` }, // بلا content-type — يضبطه FormData مع الحدود
      body: form,
    });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : {}; } catch { /* رد غير JSON */ }
    if (!res.ok) throw new Error(`فشل رفع الوسيط «${m.filename}» إلى SocialAPI (${res.status}): ${data?.error?.message || data?.message || text.slice(0, 140)}`);
    const id = data?.id || data?.media_id || data?.data?.id;
    if (!id) throw new Error(`لم يُعِد SocialAPI معرّف وسيط لـ «${m.filename}»`);
    return String(id);
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    const accountIds = input.platforms.map((p) => this.accounts[p]).filter(Boolean);
    if (!accountIds.length) {
      throw new Error(`لا يوجد حساب SocialAPI مربوط للمنصات: ${input.platforms.join('، ')} — اربطها من الإعدادات، قسم المنصات والمزوّد`);
    }
    // جسم النشر وفق التوثيق: { text, targets:[{account_id}], media_ids?, scheduled_at? }
    // والنشر الفوري يحتاج publish_now
    const body: Record<string, unknown> = { text: input.text, targets: accountIds.map((id) => ({ account_id: id })) };
    if (input.media?.length) {
      const mediaIds: string[] = [];
      for (const m of input.media) mediaIds.push(await this.uploadMedia(m));
      if (mediaIds.length) body.media_ids = mediaIds;
    }
    if (input.firstComment?.trim()) body.first_comment = input.firstComment.trim();
    if (input.scheduleAt) body.scheduled_at = input.scheduleAt;
    else body.publish_now = true;
    const data = await sapi<any>(this.key, 'POST', EP.posts, body);
    const id = data?.id || data?.post_id || data?.data?.id;
    return { providerPostId: String(id || ''), status: input.scheduleAt ? 'scheduled' : (data?.status || 'published') };
  }

  async getAnalytics(providerPostId: string): Promise<AnalyticsResult> {
    const data = await sapi<any>(this.key, 'GET', EP.metrics(providerPostId));
    const m = mapMetrics(data?.metrics || data?.data || data);
    return { reach: m.reach ?? 0, impressions: m.impressions ?? 0, engagement: m.engagement ?? 0 };
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

  private static replyId(data: any): string {
    return String(data?.comment_id || data?.id || data?.data?.id || data?.reply?.id || '');
  }

  async replyComment(_providerPostId: string, commentId: string, text: string): Promise<string> {
    if (commentId.startsWith('rv:')) {
      // مراجعة: "rv:{accountId}:{reviewId}" → POST /inbox/reviews/{reviewId}/reply {account_id, text}
      const [, accountId, reviewId] = commentId.split(':');
      const d = await sapi<any>(this.key, 'POST', EP.replyReview(reviewId), { account_id: accountId || this.fallbackAccount(), text });
      return SocialApiProvider.replyId(d);
    }
    if (commentId.startsWith('dm:')) {
      // رسالة خاصة: "dm:{conversationId}:{accountId}" → POST /inbox/conversations/{id}/messages {account_id, text}
      const [, convId, accountId] = commentId.split(':');
      const d = await sapi<any>(this.key, 'POST', EP.conversationMessages(convId), { account_id: accountId || this.fallbackAccount(), text });
      return SocialApiProvider.replyId(d);
    }
    if (commentId.startsWith('mn:')) {
      // إشارة: "mn:{mentionId}:{accountId}:{mediaId}" → POST /inbox/mentions/{id}/reply {account_id, media_id?, text}
      const [, mentionId, accountId, mediaId] = commentId.split(':');
      const payload: Record<string, unknown> = { account_id: accountId || this.fallbackAccount(), text };
      if (mediaId) payload.media_id = mediaId;
      const d = await sapi<any>(this.key, 'POST', EP.replyMention(mentionId), payload);
      return SocialApiProvider.replyId(d);
    }
    // تعليق: POST /inbox/comments/{postId} بجسم {account_id, comment_id, text}
    const dec = decodeCid(commentId);
    if (!dec) throw new Error('تعذّر تحديد المنشور/الحساب للرد على هذا التعليق');
    const d = await sapi<any>(this.key, 'POST', EP.postComments(dec.postId), { account_id: dec.accountId || this.fallbackAccount(), comment_id: dec.commentId, text });
    return SocialApiProvider.replyId(d);
  }

  async editReply(commentId: string, replyProviderId: string | null, text: string): Promise<string> {
    // التقييمات: إعادة إرسال الرد تُحدّثه على Google مباشرةً.
    if (commentId.startsWith('rv:')) {
      const [, accountId, reviewId] = commentId.split(':');
      const d = await sapi<any>(this.key, 'POST', EP.replyReview(reviewId), { account_id: accountId || this.fallbackAccount(), text });
      return SocialApiProvider.replyId(d);
    }
    // الرسائل والإشارات: لا تملك واجهة تعديل — الرسالة المُرسَلة لا تُعدَّل.
    if (commentId.startsWith('dm:') || commentId.startsWith('mn:')) {
      throw new Error('تعديل الرد غير مدعوم للرسائل والإشارات — أرسل رداً جديداً بدلاً من ذلك');
    }
    // التعليقات: لا يوجد تعديل، فنُرسل الرد الجديد أولاً ثم نحذف القديم.
    // (الترتيب مقصود: لو فشل الحذف يبقى ردّان مرئيان — أهون من فقدان الرد لو فشل الإرسال بعد الحذف)
    const newId = (await this.replyComment('', commentId, text)) || '';
    if (replyProviderId) {
      const dec = decodeCid(commentId);
      const account_id = dec?.accountId || this.fallbackAccount();
      try {
        await sapi(this.key, 'POST', EP.moderateComment(replyProviderId), { account_id, action: 'delete' });
      } catch { /* حذف القديم أفضل جهد — قد لا تدعمه المنصة */ }
    }
    return newId;
  }

  async deleteReply(commentId: string, replyProviderId: string | null): Promise<void> {
    if (commentId.startsWith('rv:')) {
      // حذف الرد على تقييم Google
      const [, accountId, reviewId] = commentId.split(':');
      await sapi(this.key, 'DELETE', EP.replyReview(reviewId), { account_id: accountId || this.fallbackAccount() });
      return;
    }
    if (commentId.startsWith('dm:') || commentId.startsWith('mn:')) {
      throw new Error('حذف الرد غير مدعوم للرسائل والإشارات');
    }
    if (!replyProviderId) {
      throw new Error('تعذّر حذف الرد — معرّف الرد على المنصة غير متوفّر (رد قديم قبل تفعيل هذه الميزة)');
    }
    // حذف تعليق الرد نفسه عبر الإشراف
    const dec = decodeCid(commentId);
    await sapi(this.key, 'POST', EP.moderateComment(replyProviderId), { account_id: dec?.accountId || this.fallbackAccount(), action: 'delete' });
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
