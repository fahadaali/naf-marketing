// سبب فشل النشر: الجزء العربي منّا، ورسالة المزوّد الإنجليزية في سطرها باتجاهها.

import { describe, it, expect } from 'vitest';
import { splitProviderReason } from '../web/src/providerReason';

describe('فصل رسالة المزوّد عن السبب العربي', () => {
  it('يقطع عند أول «: » يليه نصٌّ لاتينيّ خالص', () => {
    expect(splitProviderReason('فشل النشر عبر Ayrshare: instagram: Media file too large. The image is 12.56MB.')).toEqual({
      ar: 'فشل النشر عبر Ayrshare',
      ltr: 'instagram: Media file too large. The image is 12.56MB.',
    });
  });

  it('السبب العربي كلُّه يبقى كما هو ولو فيه اسم ملفٍّ لاتيني', () => {
    const r = 'حجم الصورة «cover.png» (12.6 ميغابايت) أكبر من حدّ هذه المنصة (8.0 ميغابايت). صغّره ثم ضعه مكان القديم';
    expect(splitProviderReason(r)).toEqual({ ar: r, ltr: '' });
  });

  it('لا يقطع قبل رسالةٍ فيها عربيّ', () => {
    const r = 'فشل النشر عبر المزوّد: twitter: رفضت المنصة المنشور';
    expect(splitProviderReason(r)).toEqual({ ar: r, ltr: '' });
  });
});
