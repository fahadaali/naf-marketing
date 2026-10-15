// رقائق المنصات تتحكّم بالمواعيد: حال كل منصة، وما يعنيه الحفظ.

import { describe, it, expect } from 'vitest';
import { platformStates, platformChanges, lockedState, cancellable } from '../web/src/postPlatforms';

const NOW = Date.parse('2026-10-15T12:00:00Z');
const row = (platform: string, status: string, at = '2026-10-16T09:00:00Z', deleted_at: string | null = null) =>
  ({ platform, status, scheduled_at: at, deleted_at });

describe('حال كل منصة', () => {
  it('من موعدها: منشور وفاشل وقيد النشر ومجدول، وما فات موعده متأخر', () => {
    expect(platformStates([
      row('x', 'published'),
      row('tiktok', 'failed'),
      row('linkedin_page', 'processing'),
      row('instagram', 'pending'),
      row('facebook', 'pending', '2026-10-14T09:00:00Z'),
    ], NOW)).toEqual({ x: 'published', tiktok: 'failed', linkedin_page: 'processing', instagram: 'pending', facebook: 'late' });
  });

  it('ما حُذف من منصته بلا موعد — يُجدوَل من جديد', () => {
    expect(platformStates([row('x', 'published', undefined, '2026-10-10T00:00:00Z')], NOW)).toEqual({});
  });

  it('المنشور وما يُنشر الآن مقفلان، وما ينتظر أو فشل يُلغى', () => {
    expect(['published', 'processing'].every((s) => lockedState(s as any))).toBe(true);
    expect(['pending', 'late', 'failed'].every((s) => cancellable(s as any))).toBe(true);
    expect(lockedState('failed')).toBe(false);
  });
});

describe('ما يعنيه الحفظ', () => {
  const states = platformStates([row('x', 'published'), row('tiktok', 'failed'), row('instagram', 'pending')], NOW);

  it('إلغاء تحديد المتعثّرة يلغي جدولتها، والمنشورة لا تُمسّ', () => {
    expect(platformChanges(states, ['x', 'tiktok', 'instagram'], ['x', 'instagram'])).toEqual({ cancel: ['tiktok'], schedule: [] });
  });

  it('تحديدُ منصةٍ بلا موعد يجدولها، وإعادة تحديد ما له موعد لا تجدوله ثانيةً', () => {
    expect(platformChanges(states, ['x', 'tiktok'], ['x', 'tiktok', 'linkedin_page', 'instagram']))
      .toEqual({ cancel: [], schedule: ['linkedin_page'] });
  });
});
