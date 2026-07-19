import type { PublishingProvider, PublishInput, PublishResult, AnalyticsResult, CommentItem } from './provider';

// مثال تنفيذ لمزوّد حقيقي (Ayrshare) — يوضّح كيف يُبنى أي مزوّد خلف نفس الواجهة.
// ملاحظة: أسماء المنصات قد تحتاج مواءمة حسب المزوّد؛ عُدّلها عند التفعيل الفعلي.
export class AyrshareProvider implements PublishingProvider {
  constructor(private apiKey: string, private baseUrl = 'https://app.ayrshare.com/api') {}

  private headers() {
    return {
      authorization: `Bearer ${this.apiKey}`,
      'content-type': 'application/json',
    };
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    const body: Record<string, unknown> = {
      post: input.text,
      platforms: input.platforms,
    };
    if (input.mediaUrls?.length) body.mediaUrls = input.mediaUrls;
    if (input.scheduleAt) body.scheduleDate = input.scheduleAt;

    const res = await fetch(`${this.baseUrl}/post`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as any;
    if (!res.ok) throw new Error(`فشل النشر عبر المزوّد: ${data?.message || res.status}`);
    return { providerPostId: data.id || data.postId, status: data.status || 'success' };
  }

  async getAnalytics(providerPostId: string): Promise<AnalyticsResult> {
    const res = await fetch(`${this.baseUrl}/analytics/post`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ id: providerPostId }),
    });
    const data = (await res.json()) as any;
    if (!res.ok) throw new Error(`فشل سحب التحليلات: ${data?.message || res.status}`);
    // تجميع مبسّط عبر المنصات
    let reach = 0;
    let impressions = 0;
    let engagement = 0;
    for (const key of Object.keys(data || {})) {
      const m = data[key]?.analytics || data[key];
      if (!m || typeof m !== 'object') continue;
      reach += Number(m.reach || m.reachCount || 0);
      impressions += Number(m.impressions || m.impressionCount || 0);
      engagement += Number(m.engagement || m.likeCount || 0) + Number(m.commentCount || 0);
    }
    return { reach, impressions, engagement };
  }

  async deletePost(providerPostId: string): Promise<void> {
    await fetch(`${this.baseUrl}/delete`, {
      method: 'DELETE',
      headers: this.headers(),
      body: JSON.stringify({ id: providerPostId }),
    });
  }

  // تعليقات Ayrshare — وفق واجهتهم الموثّقة (best-effort)
  async getComments(providerPostId: string): Promise<CommentItem[]> {
    const res = await fetch(`${this.baseUrl}/comments`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ id: providerPostId }),
    });
    const data = (await res.json()) as any;
    if (!res.ok) throw new Error(`فشل جلب التعليقات: ${data?.message || res.status}`);
    const list: any[] = data?.comments || data?.data || [];
    return list.map((c) => ({
      id: String(c.id || c.commentId),
      kind: 'comment' as const,
      authorName: c.name || c.username || c.from || 'مستخدم',
      body: c.comment || c.text || c.message || '',
      createdAt: c.created || c.timestamp || new Date().toISOString(),
    }));
  }

  async replyComment(providerPostId: string, commentId: string, text: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/comments/reply`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ id: providerPostId, commentId, comment: text }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as any;
      throw new Error(`فشل الرد على التعليق: ${data?.message || res.status}`);
    }
  }
}
