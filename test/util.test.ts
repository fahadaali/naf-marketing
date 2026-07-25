import { describe, it, expect } from 'vitest';
import { htmlToText, extractMediaIds } from '../src/util';

// تجريد HTML قبل النشر — كان محتوى المحرر يُنشر خاماً فتظهر الوسوم حرفياً
describe('htmlToText', () => {
  it('يُبقي النص العادي كما هو', () => {
    expect(htmlToText('مرحباً بكم في ناف')).toBe('مرحباً بكم في ناف');
  });

  it('يُزيل الوسوم ويحوّل الفقرات إلى أسطر', () => {
    expect(htmlToText('<p>سطر أول</p><p>سطر ثانٍ</p>')).toBe('سطر أول\nسطر ثانٍ');
  });

  it('يحوّل القوائم إلى نقاط', () => {
    expect(htmlToText('<ul><li>عقود</li><li>استشارات</li></ul>')).toBe('• عقود\n• استشارات');
  });

  it('يحوّل <br> إلى سطر جديد', () => {
    expect(htmlToText('أ<br>ب')).toBe('أ\nب');
  });

  it('يفكّ كيانات HTML', () => {
    expect(htmlToText('<p>ناف &amp; شركاؤه&nbsp;هنا</p>')).toBe('ناف & شركاؤه هنا');
  });

  it('يحذف محتوى script وstyle', () => {
    expect(htmlToText('<p>نص</p><script>alert(1)</script>')).toBe('نص');
  });

  it('يمنع تراكم الأسطر الفارغة', () => {
    expect(htmlToText('<p>أ</p><p></p><p></p><p>ب</p>')).toBe('أ\n\nب');
  });

  it('يتعامل مع الفارغ بأمان', () => {
    expect(htmlToText('')).toBe('');
  });
});

// استخراج الوسائط المضمّنة في المتن لنشرها مع المنشور
describe('extractMediaIds', () => {
  it('يستخرج معرّفاً واحداً', () => {
    expect(extractMediaIds('<img src="/api/media/med_abc123">')).toEqual(['med_abc123']);
  });

  it('يستخرج عدة معرّفات دون تكرار', () => {
    const html = '<img src="/api/media/a1"><img src="/api/media/b2"><img src="/api/media/a1">';
    expect(extractMediaIds(html)).toEqual(['a1', 'b2']);
  });

  it('يُعيد فارغاً عند غياب الوسائط', () => {
    expect(extractMediaIds('<p>نص فقط</p>')).toEqual([]);
  });
});
