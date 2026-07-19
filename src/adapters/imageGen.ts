import type { Env } from '../types';
import { buildPlaceholderPng } from '../services/pngGen';

// طبقة توليد الصور المجرّدة — محايدة للمزوّد، تشبه طبقة النشر.
export interface ImageGenProvider {
  generate(prompt: string): Promise<{ bytes: Uint8Array; mimeType: string }>;
}

// مزوّد تجريبي: يولّد صورة تدرّج لوني حتمية من النص (للتطوير والاختبار بلا تكلفة)
export class MockImageProvider implements ImageGenProvider {
  async generate(prompt: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
    return { bytes: buildPlaceholderPng(prompt), mimeType: 'image/png' };
  }
}

// مزوّد OpenAI (Images API) — يتطلّب IMAGE_PROVIDER_API_KEY
export class OpenAIImageProvider implements ImageGenProvider {
  constructor(private apiKey: string) {}
  async generate(prompt: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-image-1', prompt, size: '1024x1024', n: 1 }),
    });
    const data = (await res.json()) as any;
    if (!res.ok) throw new Error(`فشل توليد الصورة: ${data?.error?.message || res.status}`);
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) throw new Error('لم يُعِد المزوّد بيانات صورة');
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, mimeType: 'image/png' };
  }
}

export async function getImageProvider(env: Env): Promise<ImageGenProvider> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'image_provider'").first<{ value: string }>();
  const name = (row?.value || 'mock').toLowerCase();
  if (name === 'openai') {
    if (!env.IMAGE_PROVIDER_API_KEY) throw new Error('IMAGE_PROVIDER_API_KEY غير مضبوط');
    return new OpenAIImageProvider(env.IMAGE_PROVIDER_API_KEY);
  }
  return new MockImageProvider();
}
