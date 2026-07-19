import type { PublishingProvider, PublishInput, PublishResult, AnalyticsResult, CommentItem } from './provider';

const MOCK_NAMES = ['سارة العتيبي', 'محمد القحطاني', 'نورة الدوسري', 'خالد الشمري'];
const MOCK_BODIES = [
  'شكراً على المعلومة القيّمة!',
  'هل يمكن التواصل معكم لمزيد من التفاصيل؟',
  'محتوى مفيد جداً، بالتوفيق.',
  'أرغب بمعرفة المزيد عن هذه الخدمة.',
];

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

  // تعليقات/رسائل تجريبية حتمية (لغرض الاختبار وتجربة الواجهة بلا مزوّد حقيقي)
  async getComments(providerPostId: string): Promise<CommentItem[]> {
    let seed = 0;
    for (const ch of providerPostId) seed = (seed * 31 + ch.charCodeAt(0)) & 0xffffff;
    const count = seed % 3; // صفر إلى اثنين
    const out: CommentItem[] = [];
    for (let i = 0; i < count; i++) {
      out.push({
        id: `${providerPostId}_c${i}`,
        kind: i === 0 ? 'comment' : 'dm',
        authorName: MOCK_NAMES[(seed + i) % MOCK_NAMES.length],
        body: MOCK_BODIES[(seed + i * 2) % MOCK_BODIES.length],
        createdAt: new Date(Date.now() - i * 3600_000).toISOString(),
      });
    }
    return out;
  }

  async replyComment(_providerPostId: string, _commentId: string, _text: string): Promise<void> {
    // لا شيء — وضع تجريبي
  }
}
