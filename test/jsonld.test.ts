import { describe, it, expect } from 'vitest';
import { articleJsonLd } from '../src/routes/publicPages';

const base = {
  title: 'صياغة العقود',
  description: 'دليل مختصر',
  canonical: 'https://naf.sa/articles/x',
  siteName: 'ناف',
};

describe('articleJsonLd', () => {
  it('يبني Article صالحاً', () => {
    const d = JSON.parse(articleJsonLd(base));
    expect(d['@type']).toBe('Article');
    expect(d.headline).toBe('صياغة العقود');
    expect(d.inLanguage).toBe('ar');
    expect(d.mainEntityOfPage['@id']).toBe(base.canonical);
    expect(d.publisher.name).toBe('ناف');
  });

  it('يُسقط الحقول بلا قيمة ولا يملؤها بفراغ', () => {
    const d = JSON.parse(articleJsonLd(base));
    expect(d).not.toHaveProperty('datePublished');
    expect(d).not.toHaveProperty('author');
    expect(d).not.toHaveProperty('image');
  });

  it('يضيف التواريخ والمؤلّف عند وجودها', () => {
    const d = JSON.parse(articleJsonLd({
      ...base, published: '2026-08-01T10:00:00Z', modified: '2026-08-02T10:00:00Z', author: 'فهد',
    }));
    expect(d.datePublished).toBe('2026-08-01T10:00:00Z');
    expect(d.dateModified).toBe('2026-08-02T10:00:00Z');
    expect(d.author.name).toBe('فهد');
  });

  // الأهمّ: عنوانٌ يحمل </script> كان سيغلق الوسم ويحقن ما بعده
  it('يهرّب < فيستحيل كسر وسم script', () => {
    const out = articleJsonLd({ ...base, title: 'اختبار</script><img src=x onerror=alert(1)>' });
    expect(out).not.toContain('</script>');
    expect(out).not.toContain('<img');
    expect(out).toContain('\\u003c');
  });

  it('ويبقى JSON صالحاً بعد التهريب', () => {
    const d = JSON.parse(articleJsonLd({ ...base, title: 'أ</script>ب' }));
    expect(d.headline).toBe('أ</script>ب');
  });
});

/* النوع يتبع الصفحة. كانت layout تُصدّر Article بلا شرط، فحملته
   صفحةُ الفهرس و٤٠٤ وتأكيدُ الاشتراك وإلغاؤه — أربعُ صفحات تُخبر
   المفهرس أنها مقالات وليست. */
describe('نوع البيانات المنظّمة', () => {
  it('Article هو الافتراضي', () => {
    expect(JSON.parse(articleJsonLd(base))['@type']).toBe('Article');
  });
  it('الفهرس CollectionPage لا Article', () => {
    expect(JSON.parse(articleJsonLd({ ...base, kind: 'CollectionPage' }))['@type']).toBe('CollectionPage');
  });
});
