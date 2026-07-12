import type { PublishingProvider, PublishInput, PublishResult, AnalyticsResult } from './provider';

// مزوّد وهمي للتطوير والاختبار — لا يتصل بأي خدمة خارجية.
// يحاكي النشر ويولّد تحليلات ثابتة قابلة للتكرار حسب معرّف المنشور.
export class MockProvider implements PublishingProvider {
  async publish(input: PublishInput): Promise<PublishResult> {
    const providerPostId = `mock_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    return { providerPostId, status: input.scheduleAt ? 'scheduled' : 'published' };
  }

  async getAnalytics(providerPostId: string): Promise<AnalyticsResult> {
    // أرقام حتمية مشتقة من المعرّف كي تكون قابلة للتكرار
    let seed = 0;
    for (const ch of providerPostId) seed = (seed * 31 + ch.charCodeAt(0)) & 0xffffff;
    const impressions = 500 + (seed % 4500);
    const reach = Math.round(impressions * 0.7);
    const engagement = Math.round(impressions * (0.02 + (seed % 50) / 1000));
    return { reach, impressions, engagement };
  }

  async deletePost(_providerPostId: string): Promise<void> {
    // لا شيء
  }
}
