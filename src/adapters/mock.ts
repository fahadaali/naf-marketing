import type { PublishingProvider, PublishInput, PublishResult, AnalyticsResult } from './provider';

// مزوّد وهمي للتطوير والاختبار — لا يتصل بأي خدمة خارجية، ويحاكي النشر وحده.
//
// كان يولّد أرقام وصولٍ وتفاعل من بصمة المعرّف، وتعليقاتٍ ورسائلَ بأسماءٍ
// مخترعة — تُخزَّن كما تُخزَّن الحقيقية فتدخل المؤشرات واللوحة. فلم يعد يقيس
// شيئاً ولا يقرأ صندوقاً: الرقم في المنصة رقمٌ قيس أو لا رقم.
export class MockProvider implements PublishingProvider {
  async publish(input: PublishInput): Promise<PublishResult> {
    const providerPostId = `mock_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    return { providerPostId, status: input.scheduleAt ? 'scheduled' : 'published' };
  }

  async getAnalytics(_providerPostId: string): Promise<AnalyticsResult> {
    // لا رقم يُخترع — ومن يناديه يتخطّى المنشور ولا يكتب شيئاً
    throw new Error('المزوّد التجريبي لا يقيس شيئاً. اضبط مزوّد نشرٍ حقيقياً من الإعدادات.');
  }

  async deletePost(_providerPostId: string): Promise<void> {
    // لا شيء
  }

  async replyComment(_providerPostId: string, _commentId: string, _text: string): Promise<void> {
    // لا شيء — وضع تجريبي
  }
}
