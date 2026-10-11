// معاينة «نسخة كل منصة» تقرأ مواصفات الخادم بالقاعدة نفسها — فلا تقول
// المعاينة «كما هي» لصورةٍ سيكيّفها النشر، ولا العكس.

import { describe, it, expect } from 'vitest';
import * as server from '../src/services/mediaSpecs';
import { imageTarget, platformMedia, needsAttention, bodyMediaIds, ratioLabel, videoMode, type MediaSpecs } from '../web/src/mediaPlan';

const specs: MediaSpecs = {
  image: server.IMAGE_SPECS,
  video: server.VIDEO_SPECS,
  facebook_reel_ms: server.FACEBOOK_REEL_MS,
  youtube_short_max_ms: server.YOUTUBE_SHORT_MAX_MS,
};

describe('المعاينة كالنشر', () => {
  it('imageTarget في الواجهة يطابق الخادم على كل منصة ونسبة', () => {
    const sizes = [
      [1080, 1920], [1079, 1920], [1080, 1350], [1080, 1080], [1600, 900], [1920, 1080],
      [3000, 1000], [500, 4000], [1200, 627], [1000, 1001], [2400, 1000], [100, 1100],
    ];
    for (const p of [...Object.keys(server.IMAGE_SPECS), 'x', 'facebook', 'youtube']) {
      for (const [w, h] of sizes) {
        expect(imageTarget(specs, p, w, h), `${p} ${w}×${h}`).toEqual(server.imageTarget(p, w, h));
      }
    }
  });
});

describe('وسائط المنصة', () => {
  const assets = {
    a: { id: 'a', mime_type: 'image/jpeg', width: 1600, height: 900 },
    b: { id: 'b', mime_type: 'image/png', width: 1080, height: 1920 },
    v: { id: 'v', mime_type: 'video/mp4', width: 1080, height: 1920, duration_ms: 30000 },
  };

  it('معرّفات المتن بترتيبها بلا تكرار', () => {
    expect(bodyMediaIds('<img src="/api/media/a"><a href="/api/media/b">x</a><img src="/api/media/a">')).toEqual(['a', 'b']);
  });

  it('الأفقية لسناب تُكيَّف، ولإكس تبقى', () => {
    expect(platformMedia(specs, 'snapchat', ['a'], undefined, assets).items[0].frame).toEqual([1080, 1920]);
    expect(platformMedia(specs, 'x', ['a'], undefined, assets).items[0].frame).toBeNull();
  });

  it('ما اختير للمنصة باليد يحلّ محلّ المتن', () => {
    const p = platformMedia(specs, 'snapchat', ['a'], { platform: 'snapchat', media_asset_id: 'b' }, assets);
    expect(p).toMatchObject({ source: 'variant', items: [{ id: 'b', frame: null }] });
    expect(needsAttention(p)).toBe(false);
  });

  it('تيك توك بصورةٍ واحدة يحتاج مقطعاً، وجاهزٌ ما دام مولّداً من الصورة نفسها', () => {
    expect(platformMedia(specs, 'tiktok', ['b'], undefined, assets)).toMatchObject({ needsVideo: true, videoReady: false });
    const v = { platform: 'tiktok', generated_media_id: 'v', generated_from_id: 'b' };
    expect(platformMedia(specs, 'tiktok', ['b'], v, assets)).toMatchObject({ needsVideo: true, videoReady: true });
    expect(platformMedia(specs, 'tiktok', ['a'], v, assets)).toMatchObject({ needsVideo: true, videoReady: false });
    expect(platformMedia(specs, 'tiktok', ['a', 'b'], undefined, assets).needsVideo).toBe(false);
    expect(platformMedia(specs, 'tiktok', ['v'], undefined, assets).needsVideo).toBe(false);
  });

  it('نسبة الإطار نصّاً، ونوع نشر المقطع', () => {
    expect(ratioLabel([1080, 1920])).toBe('9:16');
    expect(ratioLabel([1080, 566])).toBe('1.91:1');
    expect(videoMode(specs, 'facebook', assets.v)).toBe('ريلز');
    expect(videoMode(specs, 'youtube', assets.v)).toBe('شورتس');
    expect(videoMode(specs, 'youtube', { ...assets.v, width: 1920, height: 1080 })).toBeNull();
    expect(videoMode(specs, 'x', assets.v)).toBeNull();
  });
});
