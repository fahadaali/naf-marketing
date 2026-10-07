// منصات المحتوى لصفّ الشعارات: اتحاد المجدولة والمخطّطة، بلا تكرار، بترتيبٍ ثابت.

import { describe, it, expect } from 'vitest';
import { platformsOf, sortPlatforms, normalizePlatform, PLATFORM_KEYS } from '../web/src/platformKeys';

describe('platformsOf', () => {
  it('المجدولة والمخطّطة معاً، كلٌّ مرةً واحدة', () => {
    expect(platformsOf({ scheduled_platforms: 'x,instagram', planned_platforms: '["linkedin","x"]' }))
      .toEqual(['linkedin', 'x', 'instagram']);
  });

  it('الترتيب ثابتٌ أياً كان ترتيب المصدر — فلا تختلف بطاقتان', () => {
    expect(platformsOf({ scheduled_platforms: 'threads,facebook,x' }))
      .toEqual(platformsOf({ scheduled_platforms: 'x,threads,facebook' }));
  });

  it('مرادفات المزوّد توحَّد، والمخصّصة بعد المعروفة أبجدياً', () => {
    expect(platformsOf({ scheduled_platforms: 'twitter,zeta_local,alpha_local,x' }))
      .toEqual(['x', 'alpha_local', 'zeta_local']);
  });

  it('بلا موعدٍ ولا خطة لا منصات، وJSON المشوَّه لا يُسقط شيئاً', () => {
    expect(platformsOf({})).toEqual([]);
    expect(platformsOf({ scheduled_platforms: null, planned_platforms: null })).toEqual([]);
    expect(platformsOf({ planned_platforms: '{oops' })).toEqual([]);
  });
});

describe('sortPlatforms وnormalizePlatform', () => {
  it('المعروفة بترتيب PLATFORM_KEYS', () => {
    expect(sortPlatforms([...PLATFORM_KEYS].reverse())).toEqual([...PLATFORM_KEYS]);
  });

  it('التوحيد لا يغيّر المفتاح الأساسي', () => {
    expect(normalizePlatform(' LinkedIn-Page ')).toBe('linkedin_page');
    expect(normalizePlatform('gbp')).toBe('google');
    expect(normalizePlatform('instagram')).toBe('instagram');
  });
});
