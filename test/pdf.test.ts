import { describe, it, expect } from 'vitest';
import { inlineMedia } from '../src/services/pdf';

/* inlineMedia هي ما يمنع خروج PDF بمربّعات فارغة: مسار /api/media
   محميّ بالمصادقة، فما لم تُضمَّن الصورة data: URI لا يراها المتصفّح.
   كانت بلا اختبار وهي أخطر قطعة في المسار. */
function env(rows: Record<string, { r2_key: string; mime_type: string }>, bytes = new Uint8Array([1, 2, 3])) {
  return {
    DB: { prepare: (_q: string) => ({ bind: (id: string) => ({ first: async () => rows[id] || null }) }) },
    MEDIA: { get: async (k: string) => (Object.values(rows).some((r) => r.r2_key === k) ? { arrayBuffer: async () => bytes.buffer } : null) },
  } as any;
}

describe('inlineMedia', () => {
  it('يستبدل مرجع الوسيط بصورة مضمّنة', async () => {
    const e = env({ m1: { r2_key: 'm1.png', mime_type: 'image/png' } });
    const out = await inlineMedia(e, '<img src="/api/media/m1">');
    expect(out).toContain('data:image/png;base64,');
    expect(out).not.toContain('/api/media/m1');
  });

  it('يستبدل المرجع المطلق أيضاً', async () => {
    const e = env({ m1: { r2_key: 'm1.png', mime_type: 'image/png' } });
    const out = await inlineMedia(e, '<img src="https://naf.sa/api/media/m1">');
    expect(out).toContain('data:image/png');
    expect(out).not.toContain('naf.sa/api/media');
  });

  it('لا يضمّن غير الصور — الصوت والفيديو ينفخان المستند بلا فائدة', async () => {
    const e = env({ m2: { r2_key: 'm2.mp4', mime_type: 'video/mp4' } });
    const out = await inlineMedia(e, '<a href="/api/media/m2">م</a>');
    expect(out).toContain('/api/media/m2');
    expect(out).not.toContain('data:video');
  });

  it('وسيطٌ مفقود يُترك كما هو ولا يُسقط المستند', async () => {
    const out = await inlineMedia(env({}), '<img src="/api/media/ghost">');
    expect(out).toContain('/api/media/ghost');
  });

  it('بلا مراجع يعيد النصّ كما هو', async () => {
    expect(await inlineMedia(env({}), '<p>لا وسيط</p>')).toBe('<p>لا وسيط</p>');
  });
});
