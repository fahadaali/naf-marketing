import { describe, it, expect } from 'vitest';
import {
  builtinSummaries, builtinById, isBuiltinId, sanitizeBlocks, readTemplateFile, buildTemplateFile,
  TEMPLATE_FILE_KIND,
} from '../src/services/newsletterTemplates';
import { htmlToBlocks, htmlTitle, parseHtml } from '../src/services/newsletterImport';
import { renderBlocks } from '../src/services/newsletter';

describe('القوالب الجاهزة', () => {
  it('كلّها لها معرّف مميّز واسم ووصف وكتل', () => {
    const all = builtinSummaries();
    expect(all.length).toBeGreaterThan(0);
    expect(new Set(all.map((t) => t.id)).size).toBe(all.length);
    for (const t of all) {
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.blocks).toBeGreaterThan(0);
      expect(isBuiltinId(t.id)).toBe(true);
    }
  });

  it('كتل كل قالب تُصيَّر في الوجهتين بلا سقوط', () => {
    for (const s of builtinSummaries()) {
      const t = builtinById(s.id)!;
      expect(() => renderBlocks(t.blocks, 'email', '', t.theme)).not.toThrow();
      expect(() => renderBlocks(t.blocks, 'web', '', t.theme)).not.toThrow();
    }
  });

  it('نسخة القالب مستقلّة — تعديلها لا يمسّ الأصل', () => {
    const a = builtinById('builtin:issue')!;
    (a.blocks[0] as any).text = 'غُيّر';
    expect((builtinById('builtin:issue')!.blocks[0] as any).text).not.toBe('غُيّر');
  });

  it('القالب الجاهز غير موجود يعود null', () => expect(builtinById('builtin:لا-شيء')).toBeNull());
});

describe('sanitizeBlocks', () => {
  it('يُسقط النوع المجهول', () => {
    expect(sanitizeBlocks([{ type: 'iframe', src: 'x' }, { type: 'text', text: 'ن' }]))
      .toEqual([{ type: 'text', text: 'ن' }]);
  });
  it('ينظّف التخصيص الوارد', () => {
    const [b] = sanitizeBlocks([{ type: 'text', text: 'ن', style: { color: 'javascript:x', align: 'center' } }]);
    expect((b as any).style).toEqual({ align: 'center' });
  });
  it('يُسقط الوسيط المرفوع — معرّفه لا يعني شيئاً في مستودع آخر', () => {
    const [b] = sanitizeBlocks([{ type: 'image', mediaId: 'med_1', url: 'https://naf.sa/a.png' }]);
    expect((b as any).mediaId).toBeUndefined();
    expect((b as any).url).toBe('https://naf.sa/a.png');
  });
});

describe('ملف القالب', () => {
  it('يرفض ما ليس ملف قالب', () => {
    expect(readTemplateFile('ليس JSON').ok).toBe(false);
    expect(readTemplateFile('{"kind":"other","blocks":[]}').ok).toBe(false);
  });
  it('يرفض القالب الفارغ', () => {
    expect(readTemplateFile(JSON.stringify({ kind: TEMPLATE_FILE_KIND, blocks: [] })).ok).toBe(false);
  });
  it('يدور كاملاً: تصدير ثم استيراد يعيدان الكتل نفسها', () => {
    const file = buildTemplateFile({
      name: 'نشرة',
      blocksJson: JSON.stringify([{ type: 'heading', text: 'ع', level: 2, style: { color: '#123456' } }]),
      themeJson: '{"text":"#0A0A0A"}',
    });
    const back = readTemplateFile(JSON.stringify(file));
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.file.blocks).toEqual(file.blocks);
    expect(back.file.theme?.text).toBe('#0A0A0A');
  });
});

describe('محلّل HTML', () => {
  it('يبني شجرةً من وسمٍ لم يُغلق', () => {
    const root = parseHtml('<div><p>أ<p>ب</div>');
    expect(root.children.length).toBe(1);
  });
  it('لا يقرأ ما داخل script وstyle وسماً', () => {
    const blocks = htmlToBlocks('<body><script>if (a < b) { x() }</script><p>نصّ</p></body>');
    expect(blocks).toEqual([{ type: 'text', text: 'نصّ' }]);
  });
  it('ينتشل عنوان المستند', () => {
    expect(htmlTitle('<html><head><title>قالب الشهر</title></head></html>')).toBe('قالب الشهر');
  });
});

describe('استيراد قالب HTML خارجي', () => {
  const template = `<!doctype html><html><head><title>نشرة</title>
    <style>.x{color:red}</style></head><body>
    <table role="presentation" width="100%"><tr><td style="padding:20px">
      <h1 style="color:#1B4B5A">عنوان القالب</h1>
      <p>فقرة فيها <strong>غامق</strong> و<a href="https://naf.sa">رابط</a>.</p>
      <p><span style="color:#FF0000">كلمة ملوّنة</span></p>
      <img src="https://naf.sa/hero.png" alt="غلاف">
      <img src="https://track.example/o.gif" width="1" height="1">
      <hr>
      <ul><li>بند أول</li><li>بند ثانٍ</li></ul>
      <table><tr><th>الموضع</th><th>قبل</th></tr><tr><td>المادة</td><td>خمسة</td></tr></table>
      <p><a href="https://naf.sa/go" style="background-color:#937133;padding:12px 22px;display:inline-block;color:#ffffff">التسجيل</a></p>
      <blockquote>اقتباس</blockquote>
    </td></tr></table></body></html>`;

  const blocks = htmlToBlocks(template);
  const kinds = blocks.map((b) => b.type);

  it('يفتح جدول التخطيط ويقرأ ما بداخله', () => {
    // جدولٌ بخانةٍ واحدة ليس جدول بيانات — ولو صار كذلك لضاع المحتوى كلّه
    expect(kinds).toContain('heading');
    expect(kinds.filter((k) => k === 'table')).toHaveLength(1);
  });

  it('ينقل العنوان بلونه', () => {
    const h = blocks.find((b) => b.type === 'heading') as any;
    expect(h.text).toBe('عنوان القالب');
    expect(h.style?.color).toBe('#1B4B5A');
  });

  it('يحوّل الوسوم إلى علامات المحرر لا إلى HTML', () => {
    const p = blocks.find((b) => b.type === 'text' && (b as any).text.includes('غامق')) as any;
    expect(p.text).toContain('**غامق**');
    expect(p.text).toContain('[رابط](https://naf.sa)');
    expect(JSON.stringify(blocks)).not.toContain('<strong>');
  });

  it('لون الكلمة يصير علامة لون', () => {
    expect(JSON.stringify(blocks)).toContain('{c:#FF0000|كلمة ملوّنة}');
  });

  it('يُسقط بكسل التتبّع ويُبقي الصورة', () => {
    const imgs = blocks.filter((b) => b.type === 'image') as any[];
    expect(imgs).toHaveLength(1);
    expect(imgs[0].url).toBe('https://naf.sa/hero.png');
  });

  it('القائمة تصير أسطراً في فقرة — لا كتلة قائمة في النموذج', () => {
    expect(JSON.stringify(blocks)).toContain('بند أول');
  });

  it('جدول البيانات يبقى جدولاً بصفّ عناوينه', () => {
    const t = blocks.find((b) => b.type === 'table') as any;
    expect(t.header).toBe(true);
    expect(t.rows[0]).toEqual(['الموضع', 'قبل']);
    expect(t.rows[1]).toEqual(['المادة', 'خمسة']);
  });

  it('الرابط الذي يبدو زرّاً يصير زرّاً بلونه', () => {
    const btn = blocks.find((b) => b.type === 'button') as any;
    expect(btn.text).toBe('التسجيل');
    expect(btn.url).toBe('https://naf.sa/go');
    expect(btn.style?.background).toBe('#937133');
  });

  it('الاقتباس والفاصل ينتقلان', () => {
    expect(kinds).toContain('quote');
    expect(kinds).toContain('divider');
  });

  it('المستورد يُصيَّر بلا حقن — كل شيء مرّ على التهريب', () => {
    const evil = htmlToBlocks('<p>نصّ <img src="x" onerror="alert(1)"> و<b>«وسم»</b></p>');
    const html = renderBlocks(sanitizeBlocks(evil), 'email');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('<img');
  });

  it('ملفٌّ بلا محتوى يعود بلا كتل فتقولها الواجهة', () => {
    expect(htmlToBlocks('<html><head><title>ف</title></head><body></body></html>')).toEqual([]);
  });

  it('محاذاة اليمين لا تُنقل — القالب اللاتيني يقلب النشرة العربية', () => {
    const b = htmlToBlocks('<p style="text-align:right">ن</p><p style="text-align:center">م</p>');
    expect((b[0] as any).style).toBeUndefined();
    expect((b[1] as any).style).toEqual({ align: 'center' });
  });

  it('لون rgb() يُقرأ — مخرَجات المحرّرات المرئية تكتبه', () => {
    const b = htmlToBlocks('<p style="color:rgb(147, 113, 51)">ن</p>');
    expect((b[0] as any).style.color).toBe('#937133');
  });
});
