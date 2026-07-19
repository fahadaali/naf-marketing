import type { Env } from '../types';

// طبقة توليد الفيديو المجرّدة — محايدة للمزوّد. التوليد غير متزامن (مهمة + استقصاء حالة)
// لأن مزوّدي الفيديو (Runway/Pika/Kling...) يعملون بنمط: إرسال طلب ثم استعلام دوري عن النتيجة.
export interface VideoGenProvider {
  start(prompt: string): Promise<{ externalJobId: string }>;
  check(externalJobId: string): Promise<{ status: 'processing' | 'completed' | 'failed'; url?: string; error?: string }>;
}

// مزوّد تجريبي: يُنهي «التهيئة» فقط — يوضّح أن الربط جاهز وينتظر مزوّداً حقيقياً.
// (توليد فيديو حقيقي يتطلّب اشتراكاً في مزوّد فعلي؛ هذا وضع الاختبار فقط)
export class MockVideoProvider implements VideoGenProvider {
  async start(_prompt: string): Promise<{ externalJobId: string }> {
    return { externalJobId: `mock_${Date.now().toString(36)}` };
  }
  async check(_externalJobId: string): Promise<{ status: 'processing' | 'completed' | 'failed'; url?: string; error?: string }> {
    return {
      status: 'failed',
      error: 'مزوّد الفيديو التجريبي (mock) للاختبار فقط ولا يُنتج فيديو حقيقياً. اضبط مزوّداً فعلياً (مثل Runway) من الإعدادات لتفعيل التوليد الفعلي.',
    };
  }
}

// مزوّد Runway ML (Gen-3/Gen-4) — نمط إرسال/استقصاء وفق واجهتهم الموثّقة. يتطلّب VIDEO_PROVIDER_API_KEY.
export class RunwayVideoProvider implements VideoGenProvider {
  constructor(private apiKey: string, private base = 'https://api.dev.runwayml.com/v1') {}

  async start(prompt: string): Promise<{ externalJobId: string }> {
    const res = await fetch(`${this.base}/text_to_video`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
        'X-Runway-Version': '2024-11-06',
      },
      body: JSON.stringify({ promptText: prompt, model: 'gen3a_turbo', duration: 5, ratio: '1280:720' }),
    });
    const data = (await res.json()) as any;
    if (!res.ok) throw new Error(`فشل بدء توليد الفيديو: ${data?.error || res.status}`);
    return { externalJobId: data.id };
  }

  async check(externalJobId: string): Promise<{ status: 'processing' | 'completed' | 'failed'; url?: string; error?: string }> {
    const res = await fetch(`${this.base}/tasks/${externalJobId}`, {
      headers: { authorization: `Bearer ${this.apiKey}`, 'X-Runway-Version': '2024-11-06' },
    });
    const data = (await res.json()) as any;
    if (!res.ok) return { status: 'failed', error: `${res.status}` };
    if (data.status === 'SUCCEEDED') return { status: 'completed', url: data.output?.[0] };
    if (data.status === 'FAILED') return { status: 'failed', error: data.failureReason || 'فشل التوليد' };
    return { status: 'processing' };
  }
}

export async function getVideoProvider(env: Env): Promise<VideoGenProvider> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'video_provider'").first<{ value: string }>();
  const name = (row?.value || 'mock').toLowerCase();
  if (name === 'runway') {
    if (!env.VIDEO_PROVIDER_API_KEY) throw new Error('VIDEO_PROVIDER_API_KEY غير مضبوط');
    return new RunwayVideoProvider(env.VIDEO_PROVIDER_API_KEY);
  }
  return new MockVideoProvider();
}
