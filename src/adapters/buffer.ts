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

// يطابق مصفوفة PostMetric من Buffer على reach/impressions/engagement
const ENGAGE_METRICS = new Set(['reactions', 'comments', 'shares', 'reposts', 'saves', 'clicks', 'likes', 'quotes', 'follows']);
export function mapPostMetrics(metrics: any[]): { reach: number; impressions: number; engagement: number } {
  let reach = 0;
  let impressions = 0;
  let views = 0;
  let engagement = 0;
  for (const m of metrics || []) {
    const key = String(m.type || m.name || '').toLowerCase();
    const value = Number(m.value || 0);
    if (!Number.isFinite(value)) continue;
    if (key === 'reach') reach += value;
    else if (key === 'impressions') impressions += value;
    else if (key === 'views') views += value;
    else if (ENGAGE_METRICS.has(key)) engagement += value;
  }
  if (!impressions) impressions = views || reach; // بعض الشبكات تعطي views بدل impressions
  return { reach, impressions, engagement };
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

// مقياس خام واحد من Buffer
export type RawMetric = { type: string; name: string; value: number; unit: string };

// منشور Buffer مُرسَل مع مقاييسه — لسحب تحليلات كل منشورات المؤسسة
export type BufferPostMetric = {
  id: string;
  channelId: string;
  service: string;
  title: string;
  sentAt: string | null;
  reach: number;
  impressions: number;
  engagement: number;
  metrics: RawMetric[]; // كل المقاييس الخام كما تعيدها Buffer (لكل منصة مقاييسها)
};

// يجلب كل المنشورات المُرسَلة (sent) في كل مؤسسات الحساب مع مقاييسها (مع ترقيم صفحات)
export async function listSentPostMetrics(token: string): Promise<BufferPostMetric[]> {
  const orgData = await bufferGraphql<any>(token, 'query { account { organizations { id } } }');
  const orgs: any[] = orgData?.account?.organizations || [];
  const out: BufferPostMetric[] = [];
  for (const org of orgs) {
    let after: string | null = null;
    for (let page = 0; page < 40; page++) {
      // حد أمان ~2000 منشور
      const afterClause = after ? `, after: ${JSON.stringify(after)}` : '';
      const q = `query { posts(first: 50${afterClause}, input: {
        organizationId: ${JSON.stringify(String(org.id))},
        filter: { status: [sent] }
      }) {
        edges { node { id text channelId channelService sentAt metrics { type name value unit } } }
        pageInfo { hasNextPage endCursor }
      } }`;
      const data: any = await bufferGraphql<any>(token, q);
      const conn: any = data?.posts;
      for (const edge of conn?.edges || []) {
        const n = edge?.node;
        if (!n) continue;
        const raw: RawMetric[] = (n.metrics || []).map((m: any) => ({
          type: String(m.type || ''),
          name: String(m.name || m.type || ''),
          value: Number(m.value || 0),
          unit: String(m.unit || 'count'),
        }));
        const { reach, impressions, engagement } = mapPostMetrics(n.metrics || []);
        out.push({
          id: String(n.id),
          channelId: String(n.channelId || ''),
          service: String(n.channelService || ''),
          title: (n.text || '').slice(0, 140),
          sentAt: n.sentAt || null,
          reach,
          impressions,
          engagement,
          metrics: raw,
        });
      }
      if (!conn?.pageInfo?.hasNextPage) break;
      after = conn.pageInfo.endCursor ? String(conn.pageInfo.endCursor) : null;
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
    return mapPostMetrics(data?.post?.metrics || []);
  }

  async deletePost(providerPostId: string): Promise<void> {
    // أفضل جهد — الحذف غير حرِج؛ نتجاهل أي خطأ في الشكل/الصلاحية
    try {
      await bufferGraphql(this.token, `mutation { deletePost(input: { id: ${JSON.stringify(providerPostId)} }) { __typename } }`);
    } catch { /* تُتجاهل */ }
  }
}
