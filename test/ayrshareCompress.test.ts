// ضغط الصورة الأكبر من حدّ المنصة عند النشر عبر Ayrshare: أعلى جودةٍ تقع تحت
// الحدّ، ثم تصغير الأبعاد إن لم تكفِ أدنى جودة. والأصل لا يُمسّ.

import { describe, it, expect } from 'vitest';
import { fitImage, ayrshareImageLimit, ayrshareMediaIssues } from '../src/adapters/ayrshare';

const MB = 1048576;

/** ربط Images مزيّف: حجم JPEG يتبع الجودة ومربّع العرض كما في الواقع تقريباً. */
function fakeImages(sizeAt: (q: number, w: number) => number, width0 = 4000) {
  const calls: { q: number; w: number; bg?: string }[] = [];
  const binding = {
    info: async () => ({ format: 'image/png', fileSize: 0, width: width0, height: 3000 }),
    input: () => {
      let w = width0;
      const t: any = {
        transform: (o: { width?: number }) => { if (o.width) w = o.width; return t; },
        output: async (o: { quality: number; format: string; background?: string }) => {
          calls.push({ q: o.quality, w, bg: o.background });
          const n = Math.round(sizeAt(o.quality, w));
          return { image: () => new Blob([new Uint8Array(n)]).stream(), contentType: () => o.format, response: () => new Response() };
        },
      };
      return t;
    },
  } as unknown as ImagesBinding;
  return { binding, calls };
}

const original = { data: new Uint8Array(12 * MB).buffer, mimeType: 'image/png', filename: 'cover.png' };

describe('ضغط الصورة إلى حدّ المنصة', () => {
  it('أعلى جودةٍ يقع حجمها تحت الحدّ — لا أقلّ منها', async () => {
    // ١٠٠ ألف بايت لكل درجة جودة: ٨٠ → ٨٫٠٠ م.ب، ٨١ → ٨٫١ — والحدّ ٨ م.ب
    const { binding, calls } = fakeImages((q) => q * 100_000);
    const out = await fitImage(binding, original, 8 * MB);
    expect(out.size).toBeLessThanOrEqual(8 * MB);
    expect(out.size).toBe(83 * 100_000); // ٨٣ = أعلى جودة تحت ٨٣٨٨٦٠٨
    expect(out).toMatchObject({ mimeType: 'image/jpeg', filename: 'cover.jpg' });
    expect(calls.every((c) => c.w === 4000)).toBe(true); // لم تُمسّ الأبعاد
    expect(calls.length).toBeLessThanOrEqual(6);
  });

  it('حين لا تكفي أدنى جودة تُصغّر الأبعاد بقدر الزائد ثم يُبحث من جديد', async () => {
    // عند العرض الأصلي حتى جودة ٧٥ = ١٥ م.ب، والحدّ ٥
    const { binding, calls } = fakeImages((q, w) => q * 0.2 * MB * (w / 4000) ** 2);
    const out = await fitImage(binding, original, 5 * MB);
    expect(out.size).toBeLessThanOrEqual(5 * MB);
    const widths = [...new Set(calls.map((c) => c.w))];
    expect(widths[0]).toBe(4000);
    expect(widths.length).toBe(2);
    expect(widths[1]).toBeGreaterThan(2000); // تصغيرٌ بقدر الحاجة لا أكثر
    // وبعد التصغير تُختار أعلى جودةٍ ممكنة: الحجم قريبٌ من الحدّ لا بعيدٌ تحته
    expect(out.size).toBeGreaterThan(0.95 * 5 * MB);
  });

  it('الشفافية تُسطَّح على أبيض', async () => {
    const { binding, calls } = fakeImages((q) => q * 50_000);
    await fitImage(binding, original, 5 * MB);
    expect(calls.every((c) => c.bg === 'white')).toBe(true);
  });

  it('أصغر حدٍّ بين منصات المنشور، ولا حدّ لمنصةٍ لا يُعرف حدّها', () => {
    expect(ayrshareImageLimit(['x'])).toBe(5 * MB);
    expect(ayrshareImageLimit(['instagram', 'facebook'])).toBe(8 * MB);
    expect(ayrshareImageLimit(['google'])).toBeNull();
  });

  it('مع الضغط لا يُحذَّر إلا مما لا يُضغط (GIF)', () => {
    const png = { filename: 'a.png', mimeType: 'image/png', size: 9 * MB };
    const gif = { filename: 'b.gif', mimeType: 'image/gif', size: 9 * MB };
    const input = { platforms: ['x'], text: '', media: [png, gif] } as any;
    expect(ayrshareMediaIssues(input, false)).toHaveLength(2);
    const withCompress = ayrshareMediaIssues(input, true);
    expect(withCompress).toHaveLength(1);
    expect(withCompress[0]).toContain('b.gif');
  });
});

describe('تعذّر الضغط', () => {
  it('خطأ Cloudflare Images يُقال بسببٍ عربيٍّ يسمّي الصورة', async () => {
    const binding = {
      info: async () => ({ format: 'image/png', fileSize: 0, width: 4000, height: 3000 }),
      input: () => ({ transform: () => { throw new Error('x'); }, output: async () => { throw new Error('Images not enabled'); } }),
    } as unknown as ImagesBinding;
    await expect(fitImage(binding, original, 5 * MB)).rejects.toThrow(/تعذّر ضغط الصورة «cover\.png».*Images not enabled/);
  });
});
