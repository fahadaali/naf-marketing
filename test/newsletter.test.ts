import { describe, it, expect } from 'vitest';
import { renderBlocks, blocksToText, slugify, splitThread, toXThread, toLinkedInPost, escapeHtml, parseBlocks, embedSrc } from '../src/services/newsletter';
import type { Block } from '../src/services/newsletter';
import { retryWindowPassed } from '../src/services/newsletterSend';

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
    // كان الفحص `toContain('<h2>')`. صار العنوان في الويب يحمل معرّفاً
    // يربط إليه فهرس المحتويات، فالوسم لم يعد مجرّداً. والمقصود من
    // الاختبار أن الويب بلا style — وهو ما يفحصه الآن صراحةً.
    const h2 = html.match(/<h2[^>]*>/)?.[0] || '';
    expect(h2).toBeTruthy();
    expect(h2).not.toContain('style=');
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

// ===== نافذة إعادة محاولة النشرة المجدولة =====
// الفشل في الكرون لا مستخدمَ أمامه، فالسلوك يُختبر هنا لا يُقرأ في السجلّ.
describe('retryWindowPassed', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const due = '2026-08-05T10:00:00Z';
  const at = (ms: number) => Date.parse(due) + ms;

  it('لا تنقضي قبل يوم — تُعاد المحاولة', () => {
    expect(retryWindowPassed(due, at(60_000))).toBe(false);
    expect(retryWindowPassed(due, at(DAY - 1000))).toBe(false);
  });
  it('تنقضي بعد يوم', () => {
    expect(retryWindowPassed(due, at(DAY + 1000))).toBe(true);
  });
  it('لا تنقضي عند الحدّ تماماً', () => {
    expect(retryWindowPassed(due, at(DAY))).toBe(false);
  });
  it('موعد تالف يُعدّ منقضياً فلا يُعاد إلى الأبد', () => {
    expect(retryWindowPassed('ليس تاريخاً', Date.now())).toBe(true);
    expect(retryWindowPassed('', Date.now())).toBe(true);
  });
});

// ===== الكتل الجديدة =====
describe('كتلة البطاقة', () => {
  it('نغمة الحالة تحمل عنوانها ظاهراً — §6 يمنع اللون وحده', () => {
    const h = renderBlocks([{ type: 'callout', text: 'نصّ', tone: 'warning' }], 'email');
    expect(h).toContain('تحذير');
  });
  it('عنوان الكاتب يسبق العنوان الافتراضي', () => {
    const h = renderBlocks([{ type: 'callout', text: 'ن', tone: 'info', title: 'مهلة نظامية' }], 'email');
    expect(h).toContain('مهلة نظامية');
    expect(h).not.toContain('>معلومة<');
  });
  it('«تمييز» بلا عنوان افتراضي — إبرازٌ بلا حكم', () => {
    const h = renderBlocks([{ type: 'callout', text: 'ن', tone: 'primary' }], 'web');
    expect(h).not.toContain('callout-title');
  });
  it('نغمة مجهولة تسقط إلى «تمييز» ولا تنكسر', () => {
    const h = renderBlocks([{ type: 'callout', text: 'ن', tone: 'خطأ' as any }], 'web');
    expect(h).toContain('callout-primary');
  });
  it('تقبل التنسيق داخلها', () => {
    expect(renderBlocks([{ type: 'callout', text: '**غامق**' }], 'web')).toContain('<strong>غامق</strong>');
  });
});

describe('كتلة الجدول', () => {
  const rows = [['المادة', 'المدة'], ['الأولى', '30 يوماً']];
  it('صفّ العناوين th والباقي td', () => {
    const h = renderBlocks([{ type: 'table', rows, header: true }], 'web');
    expect(h).toContain('<th');
    expect(h).toContain('<td');
  });
  it('بلا صفّ عناوين لا th', () => {
    expect(renderBlocks([{ type: 'table', rows, header: false }], 'web')).not.toContain('<th');
  });
  it('الويب يلفّها بحاوية تمرير والبريد لا', () => {
    expect(renderBlocks([{ type: 'table', rows }], 'web')).toContain('table-scroll');
    expect(renderBlocks([{ type: 'table', rows }], 'email')).not.toContain('table-scroll');
  });
  it('تتخطّى الجدول الفارغ', () => {
    expect(renderBlocks([{ type: 'table', rows: [] }], 'web')).toBe('');
  });
  it('تهرّب محتوى الخلايا', () => {
    const h = renderBlocks([{ type: 'table', rows: [['<img onerror=x>']] }], 'web');
    expect(h).not.toContain('<img onerror');
  });
});

describe('كتلة الكود', () => {
  it('لا تفسّر علامات التنسيق — نجمةٌ في الكود نجمة', () => {
    const h = renderBlocks([{ type: 'code', text: 'a = **b**' }], 'web');
    expect(h).toContain('a = **b**');
    expect(h).not.toContain('<strong>');
  });
  it('تهرّب الكود', () => {
    expect(renderBlocks([{ type: 'code', text: '<script>' }], 'web')).toContain('&lt;script&gt;');
  });
});

describe('الحواشي', () => {
  const withNotes: Block[] = [
    { type: 'text', text: 'الأولى' },
    { type: 'footnote', text: 'المادة الخامسة' },
    { type: 'text', text: 'الثانية' },
    { type: 'footnote', text: 'المادة السابعة' },
  ];
  it('تُرقَّم بترتيب ورودها', () => {
    const h = renderBlocks(withNotes, 'web');
    expect(h).toContain('>1</a>');
    expect(h).toContain('>2</a>');
  });
  it('نصوصها في قسم واحد آخر المقال', () => {
    const h = renderBlocks(withNotes, 'web');
    expect(h).toContain('الحواشي');
    expect(h.indexOf('المادة الخامسة')).toBeGreaterThan(h.indexOf('الثانية'));
  });
  it('بلا حواشٍ لا قسم', () => {
    expect(renderBlocks([{ type: 'text', text: 'ن' }], 'web')).not.toContain('الحواشي');
  });
  it('«رجوع» كلمةً لا سهماً — §3 يمنع الإيموجي', () => {
    const h = renderBlocks(withNotes, 'web');
    expect(h).toContain('رجوع');
    expect(h).not.toContain('\u21A9'); // بالمهرب لا بالحرف — الملف نفسه يخلو منه
  });
});

describe('فهرس المحتويات', () => {
  const withToc: Block[] = [
    { type: 'toc' },
    { type: 'heading', text: 'التمهيد', level: 2 },
    { type: 'heading', text: 'الخاتمة', level: 2 },
  ];
  it('يُبنى من عناوين لاحقة له — مرورٌ أوّل لا واحد', () => {
    const h = renderBlocks(withToc, 'web');
    expect(h).toContain('التمهيد');
    expect(h).toContain('الخاتمة');
  });
  it('الويب يربط والبريد لا — Gmail يحذف id', () => {
    expect(renderBlocks(withToc, 'web')).toContain('href="#h-1-');
    const mail = renderBlocks(withToc, 'email');
    expect(mail).toContain('التمهيد');
    expect(mail).not.toContain('href="#h-');
  });
  it('العناوين تحمل معرّفاتها في الويب وحده', () => {
    expect(renderBlocks(withToc, 'web')).toContain('<h2 id="h-1-');
    expect(renderBlocks(withToc, 'email')).not.toContain('id="h-');
  });
  it('فهرسٌ بلا عناوين لا يُعرض فارغاً', () => {
    expect(renderBlocks([{ type: 'toc' }], 'web')).toBe('');
  });
});

describe('blocksToText مع الكتل الجديدة', () => {
  it('تدخل البطاقة ويخرج الكود والجدول والحاشية', () => {
    const t = blocksToText([
      { type: 'callout', text: 'نصّ البطاقة' },
      { type: 'code', text: 'const x = 1' },
      { type: 'table', rows: [['خلية']] },
      { type: 'footnote', text: 'مرجع' },
    ]);
    expect(t).toContain('نصّ البطاقة');
    expect(t).not.toContain('const x');
    expect(t).not.toContain('خلية');
    expect(t).not.toContain('مرجع');
  });
});

// ===== التضمين: القائمة البيضاء هي الحدّ الأمني =====
describe('embedSrc', () => {
  it('يوتيوب بصيغتيه إلى nocookie', () => {
    expect(embedSrc('https://www.youtube.com/watch?v=abc123XY')).toBe('https://www.youtube-nocookie.com/embed/abc123XY');
    expect(embedSrc('https://youtu.be/abc123XY')).toBe('https://www.youtube-nocookie.com/embed/abc123XY');
  });
  it('ڤيميو', () => {
    expect(embedSrc('https://vimeo.com/123456789')).toBe('https://player.vimeo.com/video/123456789');
  });
  it('يرفض ما ليس في القائمة', () => {
    expect(embedSrc('https://example.com/x')).toBeNull();
    expect(embedSrc('https://x.com/naf/status/1')).toBeNull();
    expect(embedSrc('https://www.linkedin.com/posts/1')).toBeNull();
  });
  it('يرفض http وjavascript — https وحدها', () => {
    expect(embedSrc('http://www.youtube.com/watch?v=abc123XY')).toBeNull();
    expect(embedSrc('javascript:alert(1)')).toBeNull();
  });
  it('يرفض نطاقاً يتشبّه بيوتيوب', () => {
    expect(embedSrc('https://youtube.com.evil.test/watch?v=abc123XY')).toBeNull();
    expect(embedSrc('https://notyoutube.com/watch?v=abc123XY')).toBeNull();
  });
});

describe('كتل الوسائط — البريد يسقط إلى بطاقة رابط', () => {
  it('الصوت بطاقة في البريد ومشغّل في الويب', () => {
    const b: Block[] = [{ type: 'audio', mediaId: 'm1', title: 'المرافعة' }];
    expect(renderBlocks(b, 'email', 'https://naf.sa')).toContain('المرافعة');
    expect(renderBlocks(b, 'email', 'https://naf.sa')).not.toContain('<audio');
    expect(renderBlocks(b, 'web')).toContain('<audio');
  });
  it('الفيديو لا يُضمَّن في البريد', () => {
    const b: Block[] = [{ type: 'video', url: 'https://youtu.be/abc123XY' }];
    expect(renderBlocks(b, 'email')).not.toContain('<iframe');
    expect(renderBlocks(b, 'web')).toContain('<iframe');
  });
  it('التضمين غير المسجّل بطاقة في الوجهتين', () => {
    const b: Block[] = [{ type: 'embed', url: 'https://example.com/a', title: 'مصدر' }];
    expect(renderBlocks(b, 'web')).not.toContain('<iframe');
    expect(renderBlocks(b, 'web')).toContain('مصدر');
    expect(renderBlocks(b, 'email')).not.toContain('<iframe');
  });
  it('الإطار المسموح يحمل ضوابطه', () => {
    const h = renderBlocks([{ type: 'embed', url: 'https://vimeo.com/123456789' }], 'web');
    expect(h).toContain('referrerpolicy="strict-origin-when-cross-origin"');
    expect(h).toContain('loading="lazy"');
  });
  it('بطاقة الرابط ترفض ما ليس http(s)', () => {
    expect(renderBlocks([{ type: 'embed', url: 'javascript:alert(1)' }], 'web')).toBe('');
  });
  it('الملف بلا مصدر يُتخطّى', () => {
    expect(renderBlocks([{ type: 'file' }], 'web')).toBe('');
  });
});

describe('الأعمدة وقائمة المهام', () => {
  it('الأعمدة جدولٌ في البريد وgrid في الويب', () => {
    const b: Block[] = [{ type: 'columns', start: 'أ', end: 'ب' }];
    expect(renderBlocks(b, 'email')).toContain('<table');
    expect(renderBlocks(b, 'web')).toContain('class="columns"');
  });
  it('قائمة المهام input معطَّل في الويب ومؤشّر نصّي في البريد', () => {
    const b: Block[] = [{ type: 'checklist', items: [{ text: 'أنجز', done: true }, { text: 'لم يُنجز' }] }];
    const web = renderBlocks(b, 'web');
    expect(web).toContain('type="checkbox" disabled checked');
    expect(web).toContain('type="checkbox" disabled>');
    const mail = renderBlocks(b, 'email');
    expect(mail).not.toContain('<input');
    expect(mail).toContain('[x]');
  });
  it('قائمة فارغة لا تُعرض', () => {
    expect(renderBlocks([{ type: 'checklist', items: [] }], 'web')).toBe('');
  });
});
