import type { PublishingProvider, PublishInput, PublishResult, AnalyticsResult } from './provider';

// مزوّد Buffer — واجهة Buffer الحديثة (GraphQL) على https://api.buffer.com
// المصادقة: ترويسة Authorization: Bearer <مفتاح شخصي من publish.buffer.com/settings/api>
// يدعم: النشر والجدولة (createPost)، وحذف المنشور، والتحليلات (post.metrics).
// لا يدعم التعليقات/الردود عبر الـ API (لوحة Buffer فقط) — لذا لا نُنفّذ getComments.
//
// ملاحظة: Buffer ينشر إلى «قنوات» (channels) لها معرّفات؛ نمرّر خريطة (منصة → معرّف قناة)
// تُضبط من الإعدادات (buffer_profiles).
const BUFFER_ENDPOINT = 'https://api.buffer.com';

// منفّذ GraphQL مشترك — يُصدَّر لاستعماله في مسار جلب القنوات أيضاً.
export async function bufferGraphql<T = any>(token: string, query: string): Promise<T> {
  const res = await fetch(BUFFER_ENDPOINT, {
    method: 'POST',
    headers: { authorization: `Bearer ${token.trim()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* رد غير JSON */ }
  if (res.status === 401 || res.status === 403) {
    throw new Error(`رمز وصول Buffer مرفوض (${res.status}) — تأكد من صحة المفتاح الشخصي وأنه غير منتهٍ.`);
  }
  if (json?.errors?.length) throw new Error(`Buffer: ${json.errors[0]?.message || 'خطأ GraphQL'}`);
  if (!res.ok || json == null) throw new Error(`تعذّر الاتصال بـ Buffer (${res.status})`);
  return json.data as T;
}

// قناة Buffer كما تظهر للربط
export type BufferChannel = { id: string; service: string; name: string };

// يجلب كل قنوات الحساب عبر كل مؤسساته
export async function listBufferChannels(token: string): Promise<BufferChannel[]> {
  const orgData = await bufferGraphql<any>(token, 'query { account { organizations { id name } } }');
  const orgs: any[] = orgData?.account?.organizations || [];
  const out: BufferChannel[] = [];
  for (const org of orgs) {
    const chData = await bufferGraphql<any>(
      token,
      `query { channels(input: { organizationId: ${JSON.stringify(String(org.id))} }) { id name displayName service } }`,
    );
    for (const ch of chData?.channels || []) {
      out.push({ id: String(ch.id), service: ch.service || '', name: ch.displayName || ch.name || String(ch.id) });
    }
  }
  return out;
}

export class BufferProvider implements PublishingProvider {
  private token: string;
  constructor(accessToken: string, private profiles: Record<string, string>) {
    this.token = (accessToken || '').trim();
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    const channelIds = input.platforms.map((p) => this.profiles[p]).filter(Boolean);
    if (!channelIds.length) {
      throw new Error(`لا توجد قناة Buffer مربوطة للمنصات: ${input.platforms.join('، ')} — اربطها من الإعدادات ← المنصات والمزوّد`);
    }
    const modeClause = input.scheduleAt
      ? `mode: customScheduled, dueAt: ${JSON.stringify(input.scheduleAt)}`
      : 'mode: shareNow';
    // AssetInput.image نوعه ImageAssetInput (كائن فيه url) — لا نصّ
    const assetsClause = input.mediaUrls?.length
      ? `, assets: [{ image: { url: ${JSON.stringify(input.mediaUrls[0])} } }]`
      : '';

    let lastId = '';
    for (const channelId of channelIds) {
      const q = `mutation { createPost(input: {
        text: ${JSON.stringify(input.text)},
        channelId: ${JSON.stringify(channelId)},
        schedulingType: automatic,
        ${modeClause}${assetsClause}
      }) {
        ... on PostActionSuccess { post { id } }
        ... on MutationError { message }
      } }`;
      const data = await bufferGraphql<any>(this.token, q);
      const result = data?.createPost;
      if (result?.message) throw new Error(`فشل النشر عبر Buffer: ${result.message}`);
      lastId = result?.post?.id ? String(result.post.id) : lastId;
    }
    return { providerPostId: lastId, status: input.scheduleAt ? 'scheduled' : 'published' };
  }

  async getAnalytics(providerPostId: string): Promise<AnalyticsResult> {
    const q = `query { post(input: { id: ${JSON.stringify(providerPostId)} }) {
      metrics { type name value unit }
    } }`;
    const data = await bufferGraphql<any>(this.token, q);
    const metrics: any[] = data?.post?.metrics || [];
    // نطابق على PostMetricType (enum دقيق) لا على الاسم البشري
    const ENGAGE = new Set(['reactions', 'comments', 'shares', 'reposts', 'saves', 'clicks', 'likes', 'quotes', 'follows']);
    let reach = 0;
    let impressions = 0;
    let views = 0;
    let engagement = 0;
    for (const m of metrics) {
      const key = String(m.type || m.name || '').toLowerCase();
      const value = Number(m.value || 0);
      if (!Number.isFinite(value)) continue;
      if (key === 'reach') reach += value;
      else if (key === 'impressions') impressions += value;
      else if (key === 'views') views += value;
      else if (ENGAGE.has(key)) engagement += value;
    }
    if (!impressions) impressions = views || reach; // بعض الشبكات تعطي views بدل impressions
    return { reach, impressions, engagement };
  }

  async deletePost(providerPostId: string): Promise<void> {
    // أفضل جهد — الحذف غير حرِج؛ نتجاهل أي خطأ في الشكل/الصلاحية
    try {
      await bufferGraphql(this.token, `mutation { deletePost(input: { id: ${JSON.stringify(providerPostId)} }) { __typename } }`);
    } catch { /* تُتجاهل */ }
  }
}
