// معرّف المنشور على منصته من رابطه — يوتيوب وإكس وتيك توك وحدها.

import { describe, it, expect } from 'vitest';
import { nativeIdFromUrl } from '../src/services/nativePostId';

describe('nativeIdFromUrl', () => {
  it('يوتيوب: الرابط الطويل والقصير والقصص والبثّ', () => {
    expect(nativeIdFromUrl('youtube', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10')).toBe('dQw4w9WgXcQ');
    expect(nativeIdFromUrl('youtube', 'https://youtu.be/dQw4w9WgXcQ?si=abc')).toBe('dQw4w9WgXcQ');
    expect(nativeIdFromUrl('youtube', 'https://youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(nativeIdFromUrl('youtube', 'https://m.youtube.com/live/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(nativeIdFromUrl('youtube', 'https://www.youtube.com/@naf')).toBeNull();
    expect(nativeIdFromUrl('youtube', 'https://www.youtube.com/watch?v=short')).toBeNull();
  });

  it('إكس: رقم التغريدة من x.com وtwitter.com', () => {
    expect(nativeIdFromUrl('x', 'https://x.com/naf/status/1790000000000000001')).toBe('1790000000000000001');
    expect(nativeIdFromUrl('x', 'https://twitter.com/i/web/status/1790000000000000002?s=20')).toBe('1790000000000000002');
    expect(nativeIdFromUrl('x', 'https://x.com/naf')).toBeNull();
  });

  it('تيك توك: رقم الفيديو', () => {
    expect(nativeIdFromUrl('tiktok', 'https://www.tiktok.com/@naf/video/7420000000000000000')).toBe('7420000000000000000');
    expect(nativeIdFromUrl('tiktok', 'https://vm.tiktok.com/ZSabc/')).toBeNull();
  });

  it('لا يُستنتج لغيرها، ولا من رابطٍ معطوب', () => {
    expect(nativeIdFromUrl('instagram', 'https://www.instagram.com/p/Cabc123/')).toBeNull();
    expect(nativeIdFromUrl('youtube', 'ليس رابطاً')).toBeNull();
    expect(nativeIdFromUrl('youtube', null)).toBeNull();
    // رابط منصةٍ أخرى لا يُقرأ
    expect(nativeIdFromUrl('x', 'https://example.com/naf/status/123')).toBeNull();
  });
});
