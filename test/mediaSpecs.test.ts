// الوسيط على مقاس كل منصة: الصورة تُترك ما قبلتها المنصة، وتُوضع في إطارٍ
// مموّه بمقاسها حين تخرج عن مداها. والمقطع لا يُمسّ، ويُحذَّر مما سيُرفض منه.

import { describe, it, expect } from 'vitest';
import {
  imageTarget, containSize, adaptImage, videoIssues, facebookReel, youtubeShort, IMAGE_SPECS,
} from '../src/services/mediaSpecs';
import { mediaIssues } from '../src/services/publish';

/** ربط Images مزيّف يسجّل ما طُلب منه. */
function fakeImages(width = 1600, height = 900) {
  const log: any[] = [];
  const make = (src: string): any => {
    const t: any = {
      ops: [] as any[],
      transform: (o: any) => { t.ops.push(o); return t; },
      draw: (img: any, o: any) => { t.ops.push({ draw: img.ops, at: o }); return t; },
      output: async (o: any) => {
        log.push({ src, ops: t.ops, out: o });
        return { image: () => new Blob([new Uint8Array(1234)]).stream(), contentType: () => o.format };
      },
    };
    return t;
  };
  let n = 0;
  const binding = {
    info: async () => { log.push({ info: true }); return { format: 'image/png', fileSize: 0, width, height }; },
    input: () => make(`in${n++}`),
  } as unknown as ImagesBinding;
  return { binding, log };
}

const img = (over: Record<string, unknown> = {}) => ({
  data: new Uint8Array(10).buffer, mimeType: 'image/jpeg', filename: 'cover.jpg', ...over,
});

describe('هل تُكيَّف الصورة لهذه المنصة', () => {
  it('سناب ‎9:16‎ وحدها: الأفقية والمربّعة تُكيَّفان، والطولية تبقى', () => {
    expect(imageTarget('snapchat', 1600, 900)).toEqual([1080, 1920]);
    expect(imageTarget('snapchat', 1080, 1080)).toEqual([1080, 1920]);
    expect(imageTarget('snapchat', 1080, 1920)).toBeNull();
    // فرقُ بكسلٍ لا يُكيَّف له
    expect(imageTarget('snapchat', 1079, 1920)).toBeNull();
  });

  it('إنستغرام بين ‎4:5‎ و‎1.91:1‎: ما داخلها كما هو، والأطول إلى ‎4:5‎ والأعرض إلى ‎1.91:1‎', () => {
    expect(imageTarget('instagram', 1080, 1080)).toBeNull();
    expect(imageTarget('instagram', 1080, 1350)).toBeNull();
    expect(imageTarget('instagram', 1080, 1920)).toEqual([1080, 1350]);
    expect(imageTarget('instagram', 3000, 1000)).toEqual([1080, 566]);
  });

  it('إكس وفيسبوك يقبلان كل نسبة، والمنصة المجهولة لا تُكيَّف لها', () => {
    expect(imageTarget('x', 4000, 500)).toBeNull();
    expect(imageTarget('facebook', 500, 4000)).toBeNull();
    expect(imageTarget('mystery', 500, 4000)).toBeNull();
    expect(IMAGE_SPECS.x).toBeUndefined();
  });

  it('جوجل للأعمال: الطولية إلى إطارٍ أفقي', () => {
    expect(imageTarget('google', 1080, 1350)).toEqual([1200, 900]);
    expect(imageTarget('google', 1600, 900)).toBeNull();
  });

  it('الصورة في الإطار أكبر ما يسعه بلا قصّ', () => {
    expect(containSize(1600, 900, [1080, 1920])).toEqual([1080, 608]);
    expect(containSize(900, 1600, [1080, 1350])).toEqual([759, 1350]);
  });
});

describe('تكييف الصورة', () => {
  it('خارج المدى: خلفيّتها نفسها مموّهة بمقاس الإطار، وهي كاملةً في وسطه — JPEG', async () => {
    const { binding, log } = fakeImages();
    const out = await adaptImage(binding, 'snapchat', img({ width: 1600, height: 900 }));
    expect(out).toMatchObject({ mimeType: 'image/jpeg', filename: 'cover-snapchat.jpg', width: 1080, height: 1920 });
    expect(out.data?.byteLength).toBe(1234);
    const run = log.find((l) => l.out)!;
    expect(run.ops[0]).toEqual({ width: 1080, height: 1920, fit: 'cover' });
    expect(run.ops[1].blur).toBeGreaterThan(0);
    expect(run.ops[2].draw).toEqual([{ width: 1080, height: 608, fit: 'contain' }]);
    expect(run.ops[2].at).toEqual({ top: 656, left: 0 });
    expect(run.out.format).toBe('image/jpeg');
    // الأبعاد محفوظة فلا يُقرأ الملف لها
    expect(log.some((l) => l.info)).toBe(false);
  });

  it('داخل المدى تبقى الصورة بأصلها دون أيّ معالجة', async () => {
    const { binding, log } = fakeImages();
    const original = img({ width: 1080, height: 1350 });
    expect(await adaptImage(binding, 'instagram', original)).toBe(original);
    expect(await adaptImage(binding, 'x', original)).toBe(original);
    expect(log).toEqual([]);
  });

  it('صورةٌ بلا أبعاد محفوظة تُقرأ أبعادها من الملف', async () => {
    const { binding, log } = fakeImages(1600, 900);
    const out = await adaptImage(binding, 'snapchat', img());
    expect(log[0]).toEqual({ info: true });
    expect(out.width).toBe(1080);
  });

  it('تيك توك يرفض PNG: تُحوَّل إلى JPEG بأبعادها وإن قُبلت نسبتها', async () => {
    const { binding, log } = fakeImages();
    const out = await adaptImage(binding, 'tiktok', img({ mimeType: 'image/png', filename: 'a.png', width: 1080, height: 1920 }));
    expect(out).toMatchObject({ mimeType: 'image/jpeg', filename: 'a.jpg', width: 1080, height: 1920 });
    expect(log[0].ops).toEqual([]);
    expect(log[0].out).toMatchObject({ format: 'image/jpeg', background: 'white' });
  });

  it('المتحرّكة والمقطع لا يُمسّان', async () => {
    const { binding, log } = fakeImages();
    const gif = img({ mimeType: 'image/gif', width: 1600, height: 900 });
    const video = img({ mimeType: 'video/mp4', width: 1600, height: 900 });
    expect(await adaptImage(binding, 'snapchat', gif)).toBe(gif);
    expect(await adaptImage(binding, 'snapchat', video)).toBe(video);
    expect(log).toEqual([]);
  });

  it('فشل الربط يُقال بالصورة والمنصة', async () => {
    const binding = {
      input: () => { throw new Error('boom'); },
      info: async () => ({ width: 1, height: 1 }),
    } as unknown as ImagesBinding;
    await expect(adaptImage(binding, 'snapchat', img({ width: 1600, height: 900 })))
      .rejects.toThrow(/تعذّر تكييف الصورة «cover.jpg»/);
  });
});

describe('المقطع', () => {
  const clip = (over: Record<string, unknown> = {}) => ({
    mimeType: 'video/mp4', filename: 'clip.mp4', width: 1080, height: 1920, duration_ms: 30_000, size: 10, ...over,
  });

  it('يُحذَّر من مدّةٍ خارج حدّ المنصة بنصٍّ يقول ما يُفعل', () => {
    expect(videoIssues('snapchat', clip({ duration_ms: 90_000 }))[0]).toMatch(/أطول من حدّ هذه المنصة \(60 ثانية/);
    expect(videoIssues('snapchat', clip({ duration_ms: 3_000 }))[0]).toMatch(/أقصر من حدّ هذه المنصة \(5 ثانية/);
    expect(videoIssues('x', clip({ duration_ms: 200_000 }))).toHaveLength(1);
    expect(videoIssues('youtube', clip({ duration_ms: 3_600_000 }))).toEqual([]);
    // مدّةٌ لا تُعرف لا يُحذَّر منها
    expect(videoIssues('snapchat', clip({ duration_ms: null }))).toEqual([]);
  });

  it('الحجم الزائد يُرفض ولا يُضغط', () => {
    const issues = videoIssues('linkedin', clip({ size: 600 * 1048576 }));
    expect(issues[0]).toMatch(/لا يُضغط المقطع حفاظاً على جودته/);
  });

  it('فحص النشر يمرّ على المقاطع وحدها', () => {
    expect(mediaIssues('snapchat', [img() as any, clip({ duration_ms: 90_000 }) as any])).toHaveLength(1);
  });

  it('ريلز فيسبوك للطوليّ بين ٣ و٩٠ ثانية، وشورتس يوتيوب للطوليّ حتى ثلاث دقائق', () => {
    expect(facebookReel(clip())).toBe(true);
    expect(facebookReel(clip({ duration_ms: 120_000 }))).toBe(false);
    expect(facebookReel(clip({ width: 1920, height: 1080 }))).toBe(false);
    expect(facebookReel(clip({ width: null }))).toBe(false);
    expect(youtubeShort(clip({ duration_ms: 170_000 }))).toBe(true);
    expect(youtubeShort(clip({ duration_ms: 200_000 }))).toBe(false);
    expect(youtubeShort(clip({ duration_ms: null }))).toBe(false);
  });
});
