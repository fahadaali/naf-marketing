import { describe, it, expect } from 'vitest';
import { highlightMarks } from '../web/src/lib/markHighlight';
import { EMAIL } from '../web/src/lib/newsletterTheme';

/* الخاصيّة التي يقوم عليها كل شيء: الطبقة تحمل نفس حروف الحقل.
   فإن سقط حرفٌ أو زاد، اختلف الالتفاف وابتعد اللون عن كلامه سطراً
   بعد سطر. تُفحص بنزع الوسوم وفكّ التهريب والمقارنة بالأصل. */
function textOf(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n$/, ''); // السطر الحاجز الذي تضيفه الدالّة عمداً
}

const SAMPLES = [
  'نصّ بلا علامات',
  '{c:#937133|السلام عليكم ورحمة الله وبركاته}',
  '{c:#937133|ملوّن} و{h:#EFEAE2|مظلّل} في سطر',
  'فقرة فيها **غامق** و*مائل* و__مسطّر__',
  '[نصّ الرابط](https://naf.sa) بعده كلام',
  'سطر\nثانٍ\n\nوفقرة',
  'رموز <script> و& و"اقتباس"',
  '{c:red|لون فاسد يبقى نصّاً}',
  'قوس مفتوح { بلا إغلاق',
  '',
];

describe('طبقة تلوين العلامات', () => {
  it('لا تزيد حرفاً ولا تنقص — في كل الحالات', () => {
    for (const s of SAMPLES) expect(textOf(highlightMarks(s))).toBe(s);
  });

  it('اللون يصل الطبقة كما كتبه الكاتب', () => {
    const html = highlightMarks('{c:#937133|ملوّن}');
    expect(html).toContain('color:#937133');
    expect(html).toContain('mk-syn');
  });

  it('التظليل خلفيةٌ لا لون حروف', () => {
    expect(highlightMarks('{h:#EFEAE2|مظلّل}')).toContain('background-color:#EFEAE2');
  });

  /* الطبقة تُري لون الرسالة لا لون المنصة: الرسالة فاتحة دائماً،
     والمنصة تتبع وضع القارئ. */
  it('الكلمة الملوّنة تُعرض على سطح الرسالة لا سطح المنصة', () => {
    expect(highlightMarks('{c:#937133|ملوّن}')).toContain(`background-color:${EMAIL.card}`);
    expect(highlightMarks('{h:#EFEAE2|مظلّل}')).toContain(`color:${EMAIL.foreground}`);
  });

  it('لونٌ فاسد لا يُخرج نمطاً ويُبقي النصّ', () => {
    const html = highlightMarks('{c:red|نصّ}');
    expect(html).not.toContain('style=');
    expect(textOf(html)).toBe('{c:red|نصّ}');
  });

  it('لا يُحقن HTML من نصّ الكاتب', () => {
    const html = highlightMarks('<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('لا يُحقن نمطٌ من داخل العلامة', () => {
    const html = highlightMarks('{c:#fff" onmouseover="x|نصّ}');
    expect(html).not.toContain('onmouseover="x"');
    expect(html).toContain('&quot;');
  });

  it('العلامات تتداخل بلا كسر: لونٌ حول غامق', () => {
    const html = highlightMarks('{c:#000000|**قوي**}');
    expect(html).toContain('color:#000000');
    expect(html).toContain('mk-b');
    expect(textOf(html)).toBe('{c:#000000|**قوي**}');
  });

  it('تنتهي بسطرٍ حاجز كي لا يعلو المؤشّر عن كلامه', () => {
    expect(highlightMarks('سطر\n').endsWith('\n')).toBe(true);
  });
});
