import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDocx } from '../src/services/docx';
import type { Block } from '../src/services/newsletter';

const blocks: Block[] = [
  { type: 'heading', text: 'المادة الأولى', level: 2 },
  { type: 'text', text: 'نصّ **غامق** ورابط [الدليل](https://naf.sa).' },
  { type: 'table', rows: [['المادة', 'المدة'], ['الأولى', '30']], header: true },
  { type: 'code', text: 'const x = 1;' },
  { type: 'footnote', text: 'نظام المعاملات المدنية' },
];

function unzip(bytes: Uint8Array): Record<string, string> {
  const dir = mkdtempSync(join(tmpdir(), 'docx-'));
  const f = join(dir, 'a.docx');
  writeFileSync(f, bytes);
  // unzip حقيقي: يثبت أن الحاوية سليمة لا أن البايتات كُتبت فحسب.
  // ويُستخرج الكلّ دفعةً واحدة — unzip يعامل [Content_Types].xml نمطاً
  // لا اسماً، فطلبه بالاسم لا يطابق شيئاً.
  const names = execFileSync('unzip', ['-Z1', f]).toString().trim().split('\n');
  execFileSync('unzip', ['-o', '-q', f, '-d', dir]);
  const out: Record<string, string> = {};
  for (const n of names) out[n] = readFileSync(join(dir, n), 'utf8');
  return out;
}

describe('buildDocx', () => {
  const parts = unzip(buildDocx('صياغة العقود', blocks));

  it('حاوية OOXML كاملة الأجزاء', () => {
    expect(Object.keys(parts).sort()).toEqual([
      '[Content_Types].xml', '_rels/.rels',
      'word/_rels/document.xml.rels', 'word/document.xml', 'word/styles.xml',
    ].sort());
  });

  it('العنوان والمحتوى في المستند', () => {
    expect(parts['word/document.xml']).toContain('صياغة العقود');
    expect(parts['word/document.xml']).toContain('المادة الأولى');
  });

  it('يجرّد علامات التنسيق ويُبقي النصّ', () => {
    const d = parts['word/document.xml'];
    expect(d).toContain('نصّ غامق ورابط الدليل.');
    expect(d).not.toContain('**');
  });

  it('الاتجاه RTL مصرَّح في الفقرات والقسم والجدول', () => {
    const d = parts['word/document.xml'];
    expect(d).toContain('<w:bidi/>');
    expect(d).toContain('<w:bidiVisual/>');
  });

  it('الجدول يبني صفوفه وخلاياه', () => {
    const d = parts['word/document.xml'];
    expect(d).toContain('<w:tbl>');
    expect((d.match(/<w:tr>/g) || []).length).toBe(2);
  });

  it('الكود لا يُجرَّد — نجمةٌ فيه نجمة', () => {
    expect(parts['word/document.xml']).toContain('const x = 1;');
  });

  it('الحاشية تُرقَّم ويُجمع نصّها آخر المستند', () => {
    const d = parts['word/document.xml'];
    expect(d).toContain('(1)');
    expect(d).toContain('الحواشي');
    expect(d).toContain('1. نظام المعاملات المدنية');
  });

  it('يهرّب XML فلا يكسر المستند', () => {
    const p = unzip(buildDocx('أ & ب <ج>', []));
    expect(p['word/document.xml']).toContain('أ &amp; ب &lt;ج&gt;');
  });
});
