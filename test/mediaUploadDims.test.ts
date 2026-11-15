import { describe, it, expect } from 'vitest';
import { oversizedImage } from '../src/routes/media';

describe('صورةٌ أكبر مما يُجهَّز للنشر تُردّ عند الرفع', () => {
  const dims = (width: number | null, height: number | null) => ({ width, height, duration_ms: null });

  it('فوق مئة مليون بكسل تُردّ بأبعادها وما يُفعل بها', () => {
    const msg = oversizedImage({ type: 'image/png' }, dims(8990, 15999));
    expect(msg).toContain('8990×15999');
    expect(msg).toContain('2160×3840');
  });

  it('ما دونها، والمقطع، وما لم تُعرف أبعاده — يُرفع', () => {
    expect(oversizedImage({ type: 'image/png' }, dims(2160, 3840))).toBeNull();
    expect(oversizedImage({ type: 'image/jpeg' }, dims(10000, 10000))).toBeNull();
    expect(oversizedImage({ type: 'video/mp4' }, dims(8990, 15999))).toBeNull();
    expect(oversizedImage({ type: 'image/png' }, dims(null, null))).toBeNull();
  });
});
