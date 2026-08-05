import { describe, it, expect } from 'vitest';
import { renderInline, stripInline, escapeHtml } from '../src/services/inline';
import { EMAIL } from '../src/services/emailTheme';

describe('renderInline — التهريب أساس لا يُتخطّى', () => {
  it('يهرّب HTML قبل أي علامة', () => {
    expect(renderInline('<script>x</script>', false)).toBe('&lt;script&gt;x&lt;/script&gt;');
  });
  it('لا يسمح بوسم داخل نصّ الرابط', () => {
    const h = renderInline('[<b>س</b>](https://naf.sa)', false);
    expect(h).not.toContain('<b>');
    expect(h).toContain('&lt;b&gt;');
  });
});

describe('renderInline — الروابط', () => {
  it('يبني الرابط المكتوب', () => {
    expect(renderInline('[الدليل](https://naf.sa/a)', false))
      .toBe('<a href="https://naf.sa/a">الدليل</a>');
  });
  it('يربط الرابط العاري', () => {
    expect(renderInline('راجع https://naf.sa', false))
      .toBe('راجع <a href="https://naf.sa">https://naf.sa</a>');
  });
  it('يُخرج الترقيم اللاصق من الرابط', () => {
    const h = renderInline('راجع https://naf.sa.', false);
    expect(h).toBe('راجع <a href="https://naf.sa">https://naf.sa</a>.');
  });
  it('يقبل mailto', () => {
    expect(renderInline('[راسلنا](mailto:a@naf.sa)', false)).toContain('href="mailto:a@naf.sa"');
  });
  it('يرفض javascript: ويُبقيه نصّاً', () => {
    const h = renderInline('[اضغط](javascript:alert(1))', false);
    expect(h).not.toContain('<a');
    expect(h).toContain('[اضغط]');
  });
  it('يرفض data: ويُبقيه نصّاً', () => {
    expect(renderInline('[x](data:text/html,<b>)', false)).not.toContain('<a');
  });
  it('يهرّب المحارف الخاصة داخل عنوان الرابط', () => {
    const h = renderInline('[ب](https://naf.sa/?a=1&b=2)', false);
    expect(h).toContain('href="https://naf.sa/?a=1&amp;b=2"');
    expect(h).not.toContain('&b=2"');
  });
  it('لا يكسر رابطاً يحمل نجمة في مساره', () => {
    const h = renderInline('[ب](https://naf.sa/a*b*c) و*مائل*', false);
    expect(h).toContain('href="https://naf.sa/a*b*c"');
    expect(h).toContain('<em>مائل</em>');
  });
});

describe('renderInline — التنسيق', () => {
  it('غامق قبل مائل', () => {
    expect(renderInline('**غامق**', false)).toBe('<strong>غامق</strong>');
  });
  it('مائل', () => expect(renderInline('*مائل*', false)).toBe('<em>مائل</em>'));
  it('تسطير', () => expect(renderInline('__تسطير__', false)).toBe('<u>تسطير</u>'));
  it('يجمع الثلاثة في سطر واحد', () => {
    const h = renderInline('**أ** و*ب* و__ج__', false);
    expect(h).toBe('<strong>أ</strong> و<em>ب</em> و<u>ج</u>');
  });
  it('يترك النجمة المفردة نصّاً', () => {
    expect(renderInline('٥ * ٣', false)).toBe('٥ * ٣');
  });
});

describe('renderInline — وجهة البريد', () => {
  it('الرابط يحمل لونه سطرياً في البريد', () => {
    // القيمة من emailTheme.ts لا مكتوبةً هنا — تغييرُ الثيم يجب أن يمرّ
    // من ملف واحد، والاختبار الذي يثبّت القيمة نسخةٌ ثانية منها.
    expect(renderInline('[أ](https://naf.sa)', true)).toContain(`style="color:${EMAIL.primary}`);
  });
  it('ولا يحمله في الويب', () => {
    expect(renderInline('[أ](https://naf.sa)', false)).not.toContain('style=');
  });
});

describe('stripInline', () => {
  it('يُبقي نصّ الرابط ويُسقط عنوانه', () => {
    expect(stripInline('اقرأ [الدليل](https://naf.sa)')).toBe('اقرأ الدليل');
  });
  it('يجرّد علامات التنسيق', () => {
    expect(stripInline('**أ** و*ب* و__ج__')).toBe('أ وب وج');
  });
});

describe('escapeHtml', () => {
  it('يتحمّل الفارغ', () => expect(escapeHtml(null as any)).toBe(''));
});
