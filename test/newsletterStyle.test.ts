import { describe, it, expect } from 'vitest';
import {
  hexColor, parseStyle, parseTheme, isCustomTheme, DEFAULT_THEME, baseSize, WIDTH_PX,
} from '../src/services/blockStyle';
import { renderBlocks, parseBlocks } from '../src/services/newsletter';
import type { Block } from '../src/services/newsletter';
import { renderInline, stripInline } from '../src/services/inline';

describe('hexColor', () => {
  it('يقبل الستّ خانات ويوحّد الحالة', () => {
    expect(hexColor('#937133')).toBe('#937133'.toUpperCase());
    expect(hexColor('#abcdef')).toBe('#ABCDEF');
  });
  it('يمدّ الثلاث خانات إلى ستّ', () => expect(hexColor('#abc')).toBe('#AABBCC'));
  it('يرفض ما ليس لوناً — وهو الباب الذي يُغلق مرة واحدة', () => {
    for (const bad of ['red', 'rgb(1,2,3)', 'url(javascript:alert(1))', '#12', '#1234567',
      'expression(x)', '#ab;background:url(x)', '', null, undefined, {}]) {
      expect(hexColor(bad as any)).toBe('');
    }
  });
});

describe('parseStyle', () => {
  it('يُسقط ما ليس في المجموعة المغلقة', () => {
    const s = parseStyle({ align: 'justify', size: 'huge', weight: 900, radius: 'round', color: 'blue' });
    expect(s).toBeUndefined();
  });
  it('يقبل القيم المسجّلة', () => {
    expect(parseStyle({ align: 'center', size: 'lg', weight: 700, radius: 'full', color: '#fff', full: true }))
      .toEqual({ align: 'center', size: 'lg', weight: 700, radius: 'full', color: '#FFFFFF', full: true });
  });
  it('كتلةٌ بلا تخصيص تعود بلا كائن', () => expect(parseStyle({})).toBeUndefined());
});

describe('parseTheme', () => {
  it('السمة التالفة تعود إلى الافتراضي', () => {
    expect(parseTheme('{ليس JSON')).toEqual(DEFAULT_THEME);
    expect(parseTheme(null)).toEqual(DEFAULT_THEME);
    expect(parseTheme('[]')).toEqual(DEFAULT_THEME);
  });
  it('يقبل اللون الصالح ويتجاهل غيره', () => {
    const t = parseTheme(JSON.stringify({ text: '#123456', heading: 'chartreuse', width: 'wide', size: 'nope' }));
    expect(t.text).toBe('#123456');
    expect(t.heading).toBe(DEFAULT_THEME.heading);
    expect(t.width).toBe('wide');
    expect(t.size).toBe(DEFAULT_THEME.size);
  });
  it('يميّز المخصّصة من الافتراضية', () => {
    expect(isCustomTheme(DEFAULT_THEME)).toBe(false);
    expect(isCustomTheme(parseTheme('{"text":"#123456"}'))).toBe(true);
  });
  it('مقياس المتن يتبع السمة', () => {
    expect(baseSize(parseTheme('{"size":"lg"}'))).toBe(18);
    expect(baseSize(DEFAULT_THEME)).toBe(16);
  });
});

describe('علامتا اللون داخل النصّ', () => {
  it('اللون يصير span بلونه', () => {
    expect(renderInline('نصّ {c:#937133|ملوّن} هنا', true)).toContain('<span style="color:#937133">ملوّن</span>');
  });
  it('التظليل خلفيةٌ لا لون حروف', () => {
    expect(renderInline('{h:#EFEAE2|مظلّل}', false)).toBe('<span style="background-color:#EFEAE2">مظلّل</span>');
  });
  it('اللون الفاسد يُسقط العلامة ويُبقي النصّ ظاهراً', () => {
    const out = renderInline('{c:red|نصّ}', true);
    expect(out).not.toContain('<span');
    expect(out).toContain('نصّ');
  });
  it('لا يقبل قيمةً تحمل ما يكسر الخاصية', () => {
    const out = renderInline('{c:#fff" onmouseover="x|نصّ}', true);
    // لا نمط يخرج، والاقتباس مهرَّب فيبقى نصّاً يراه الكاتب فيصحّحه
    expect(out).not.toContain('<span');
    expect(out).not.toContain('"');
    expect(out).toContain('&quot;');
  });
  it('يعمل فوق الغامق', () => {
    expect(renderInline('{c:#000000|**قوي**}', false)).toBe('<span style="color:#000000"><strong>قوي</strong></span>');
  });
  it('التجريد ينزع اللون والغامق معاً', () => {
    expect(stripInline('{c:#000000|**قوي**} عادي')).toBe('قوي عادي');
  });
  it('لون الروابط يتبع السمة في البريد', () => {
    expect(renderInline('[نص](https://naf.sa)', true, '#123456')).toContain('color:#123456');
  });
});

describe('renderBlocks مع التخصيص', () => {
  const plain: Block[] = [{ type: 'text', text: 'فقرة' }];

  it('كتلةٌ بلا تخصيص في الويب تبقى بلا style', () => {
    expect(renderBlocks(plain, 'web')).toBe('<p>فقرة</p>');
  });

  it('لون الفقرة يصل الوجهتين', () => {
    const blocks: Block[] = [{ type: 'text', text: 'فقرة', style: { color: '#112233' } }];
    expect(renderBlocks(blocks, 'web')).toContain('color:#112233');
    expect(renderBlocks(blocks, 'email')).toContain('color:#112233');
  });

  it('خلفية الفقرة تُخرج حاويةً بحشوة لا صندوقاً لكل فقرة', () => {
    const blocks: Block[] = [{ type: 'text', text: 'أولى\n\nثانية', style: { background: '#EEEEEE' } }];
    const html = renderBlocks(blocks, 'web');
    expect(html.match(/background:#EEEEEE/g)).toHaveLength(1);
    expect(html).toContain('padding:12px 14px');
    expect(html.match(/<p/g)).toHaveLength(2);
  });

  it('المحاذاة منطقية في الويب وفيزيائية في البريد', () => {
    const blocks: Block[] = [{ type: 'text', text: 'ن', style: { align: 'end' } }];
    expect(renderBlocks(blocks, 'web')).toContain('text-align:end');
    // الرسالة dir=rtl وعملاء سطح المكتب لا يقرؤون الخصائص المنطقية
    expect(renderBlocks(blocks, 'email')).toContain('text-align:left');
  });

  it('لون الزر من الكتلة يعلو السمة', () => {
    const blocks: Block[] = [{ type: 'button', text: 'زر', url: 'https://naf.sa', style: { background: '#101010' } }];
    expect(renderBlocks(blocks, 'email', '', parseTheme('{"buttonBackground":"#202020"}')))
      .toContain('background:#101010');
  });

  it('زرٌّ بلا تخصيص في الويب يبقى على صنف الثيم', () => {
    const html = renderBlocks([{ type: 'button', text: 'زر', url: 'https://naf.sa' }], 'web');
    expect(html).toContain('class="btn"');
    expect(html).not.toContain('style="display');
  });

  it('السمة تصبغ المتن والعناوين في البريد', () => {
    const theme = parseTheme('{"text":"#0A0A0A","heading":"#0B0B0B"}');
    const html = renderBlocks([{ type: 'heading', text: 'ع', level: 2 }, { type: 'text', text: 'ن' }], 'email', '', theme);
    expect(html).toContain('color:#0B0B0B');
    expect(html).toContain('color:#0A0A0A');
  });

  it('السمة لا تُكتب على الويب إلا حين تُخصَّص', () => {
    const same = renderBlocks([{ type: 'heading', text: 'ع', level: 2 }], 'web');
    expect(same).not.toContain('style=');
    const custom = renderBlocks([{ type: 'heading', text: 'ع', level: 2 }], 'web', '', parseTheme('{"heading":"#0B0B0B"}'));
    expect(custom).toContain('color:#0B0B0B');
  });

  it('حجم المتن يجرّ العناوين معه', () => {
    const html = renderBlocks([{ type: 'heading', text: 'ع', level: 2 }], 'email', '', parseTheme('{"size":"lg"}'));
    expect(html).toContain('font-size:25px'); // 22 × 18/16
  });

  it('البطاقة تحتفظ بعنوان نغمتها مهما لُوّنت', () => {
    const html = renderBlocks(
      [{ type: 'callout', text: 'ن', tone: 'warning', style: { background: '#FFEECC' } }], 'email',
    );
    expect(html).toContain('تحذير');
    expect(html).toContain('background:#FFEECC');
  });

  /* الحارس الذي بدونه تكون الميزة ثغرة: `blocks_json` نصٌّ تكتبه
     الواجهة، ونداءٌ مباشر على PATCH يستطيع كتابة ما يشاء فيه. */
  it('تخصيصٌ ملفَّق في المخزن لا يصل خاصية style', () => {
    const stored = JSON.stringify([{
      type: 'text', text: 'ن',
      style: { color: 'red;position:fixed', background: 'url(javascript:alert(1))', align: 'justify' },
    }]);
    const html = renderBlocks(parseBlocks(stored), 'email');
    expect(html).not.toContain('position:fixed');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('text-align');
    expect(html).toContain('ن');
  });

  it('الحارس نفسه على كتلٍ لم تمرّ بالمخزن', () => {
    const html = renderBlocks(
      [{ type: 'heading', text: 'ع', level: 2, style: { color: 'x;y:z' } } as any], 'email',
    );
    expect(html).not.toContain('y:z');
  });

  it('عرض البطاقة من السمة مسجَّل بالبكسل', () => {
    expect(WIDTH_PX.narrow).toBeLessThan(WIDTH_PX.normal);
    expect(WIDTH_PX.wide).toBeGreaterThan(WIDTH_PX.normal);
  });
});
