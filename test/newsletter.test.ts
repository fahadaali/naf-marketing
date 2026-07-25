import { describe, it, expect } from 'vitest';
import { renderBlocks, blocksToText, slugify, splitThread, toXThread, toLinkedInPost, escapeHtml, parseBlocks } from '../src/services/newsletter';
import type { Block } from '../src/services/newsletter';

const blocks: Block[] = [
  { type: 'heading', text: 'صياغة العقود', level: 2 },
  { type: 'text', text: 'العقد الجيد يمنع النزاع.\n\nفقرة ثانية.' },
  { type: 'quote', text: 'العقد شريعة المتعاقدين', cite: 'مبدأ' },
  { type: 'divider' },
  { type: 'button', text: 'تواصل', url: 'https://naf.sa' },
];

describe('escapeHtml', () => {
  it('يمنع حقن HTML', () => {
    expect(escapeHtml('<script>x</script>')).toBe('&lt;script&gt;x&lt;/script&gt;');
    expect(escapeHtml('a & "b"')).toBe('a &amp; &quot;b&quot;');
  });
});

describe('parseBlocks', () => {
  it('يتحمّل JSON تالفاً', () => expect(parseBlocks('{ليس JSON')).toEqual([]));
  it('يتحمّل الفارغ', () => expect(parseBlocks(null)).toEqual([]));
});

describe('renderBlocks', () => {
  it('البريد يستخدم أنماطاً مضمّنة سطرياً', () => {
    const html = renderBlocks(blocks, 'email');
    expect(html).toContain('style=');
    expect(html).toContain('<h2');
  });
  it('الويب بلا أنماط مضمّنة على العناوين', () => {
    const html = renderBlocks(blocks, 'web');
    expect(html).toContain('<h2>');
  });
  it('يبني رابط الوسيط من الأصل المطلق (البريد لا يقرأ النسبي)', () => {
    const html = renderBlocks([{ type: 'image', mediaId: 'med_1' }], 'email', 'https://naf.sa');
    expect(html).toContain('https://naf.sa/api/media/med_1');
  });
  it('يهرّب محتوى المستخدم', () => {
    const html = renderBlocks([{ type: 'heading', text: '<img onerror=x>' }], 'web');
    expect(html).not.toContain('<img onerror');
  });
  it('يتخطّى الصورة بلا مصدر والزر بلا رابط', () => {
    expect(renderBlocks([{ type: 'image' }, { type: 'button', text: 'x', url: '' }], 'web')).toBe('');
  });
});

describe('slugify', () => {
  it('يدعم العربية', () => expect(slugify('دليل العقود التجارية')).toBe('دليل-العقود-التجارية'));
  it('يزيل الرموز', () => expect(slugify('a/b?c=1')).toBe('abc1'));
  it('يعطي بديلاً عند الفراغ', () => expect(slugify('!!!')).toMatch(/^article-/));
});

describe('splitThread / toXThread', () => {
  it('لا يقطع الكلمات', () => {
    const parts = splitThread('كلمة '.repeat(200), 100);
    expect(parts.every((p) => p.length <= 100)).toBe(true);
    expect(parts.join(' ')).not.toContain('كلم ة');
  });
  it('يُرقّم السلسلة ويُلحق الرابط', () => {
    const th = toXThread('عنوان', blocks, 'https://naf.sa/a/x');
    expect(th.length).toBeGreaterThan(0);
    expect(th[0]).toMatch(/^1\//);
    expect(th.join('\n')).toContain('https://naf.sa/a/x');
  });
  it('يحترم الحد الأقصى للأجزاء', () => {
    const long: Block[] = [{ type: 'text', text: 'جملة طويلة. '.repeat(400) }];
    expect(toXThread('ع', long, 'https://naf.sa/x', 4).length).toBeLessThanOrEqual(5);
  });
});

describe('toLinkedInPost', () => {
  it('يتضمّن العنوان والرابط', () => {
    const p = toLinkedInPost('عنوان', blocks, 'https://naf.sa/a/x');
    expect(p).toContain('عنوان');
    expect(p).toContain('https://naf.sa/a/x');
  });
  it('يقصّ النص الطويل', () => {
    const long: Block[] = [{ type: 'text', text: 'ا'.repeat(3000) }];
    expect(toLinkedInPost('ع', long, 'https://naf.sa/x').length).toBeLessThan(1100);
  });
  it('يفضّل المقتطف عند وجوده', () => {
    expect(toLinkedInPost('ع', blocks, 'https://x.co', 'مقتطف مخصّص')).toContain('مقتطف مخصّص');
  });
});

describe('blocksToText', () => {
  it('يستخرج النص دون أزرار وفواصل', () => {
    const t = blocksToText(blocks);
    expect(t).toContain('صياغة العقود');
    expect(t).not.toContain('تواصل');
  });
});

// حجم عيّنة اختبار العنوانين — يُحسب في الكود لأن تمرير معامل داخل LIMIT يُخطئ في D1
function abSample(total: number, pct: number): number {
  const p = Math.min(50, Math.max(5, pct || 20));
  return Math.max(1, Math.floor((total * p) / 100));
}

describe('حجم عيّنة اختبار العنوانين', () => {
  it('يحترم النسبة', () => expect(abSample(100, 20)).toBe(20));
  it('لا يقلّ عن واحد', () => expect(abSample(3, 20)).toBe(1));
  it('يحدّ النسبة بـ ٥٠٪', () => expect(abSample(100, 90)).toBe(50));
  it('يرفع النسبة الصغيرة إلى الحد الأدنى', () => expect(abSample(100, 1)).toBe(5));
  it('يستخدم الافتراضي عند الصفر', () => expect(abSample(100, 0)).toBe(20));
});
