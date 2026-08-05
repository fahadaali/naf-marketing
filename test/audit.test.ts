import { describe, it, expect } from 'vitest';
import { renderBlocks } from '../src/services/newsletter';
import type { Block } from '../src/services/newsletter';
import { buildDocx } from '../src/services/docx';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* ===== ما كشفه تدقيق التغطية ===== */

describe('كتلة الفيديو — الرابط غير المزوّد', () => {
  /* mediaUrl يفضّل b.url، فرابطٌ لصفحة عادية كان يصير
     <video src="صفحة HTML> — مشغّلٌ لا يشتغل. وفرعُ بطاقة الرابط
     بعده كان لا يُبلَغ أبداً لأن src صادقٌ كلّما كان b.url صادقاً. */
  it('رابط صفحة عادية يصير بطاقة رابط لا وسم video', () => {
    const h = renderBlocks([{ type: 'video', url: 'https://example.com/page' }], 'web');
    expect(h).not.toContain('<video');
    expect(h).toContain('link-card');
  });
  it('رابط ملف مرئي مباشر يبقى وسم video', () => {
    const h = renderBlocks([{ type: 'video', url: 'https://naf.sa/a.mp4' }], 'web');
    expect(h).toContain('<video');
  });
  it('وسيط مرفوع يبقى وسم video', () => {
    const h = renderBlocks([{ type: 'video', mediaId: 'med_1' }], 'web', 'https://naf.sa');
    expect(h).toContain('<video');
    expect(h).toContain('/api/media/med_1');
  });
  it('مزوّد مسجّل يبقى إطاراً', () => {
    expect(renderBlocks([{ type: 'video', url: 'https://youtu.be/abc123XY' }], 'web')).toContain('<iframe');
  });
});

describe('كتلة الصوت — الرابط غير الصوتي', () => {
  it('رابط صفحة عادية يصير بطاقة رابط لا وسم audio', () => {
    const h = renderBlocks([{ type: 'audio', url: 'https://example.com/page', title: 'حلقة' }], 'web');
    expect(h).not.toContain('<audio');
    expect(h).toContain('link-card');
  });
  it('ملف صوتي مباشر يبقى مشغّلاً', () => {
    expect(renderBlocks([{ type: 'audio', url: 'https://naf.sa/a.mp3' }], 'web')).toContain('<audio');
  });
});

function docxBody(blocks: Block[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'dx-'));
  const f = join(dir, 'a.docx');
  writeFileSync(f, buildDocx('عنوان', blocks));
  execFileSync('unzip', ['-o', '-q', f, '-d', dir]);
  return readFileSync(join(dir, 'word/document.xml'), 'utf8');
}

describe('تصدير Word — الكتل التي كانت تختفي صامتةً', () => {
  it('الصوت يُذكر باسمه', () => {
    expect(docxBody([{ type: 'audio', mediaId: 'm1', title: 'المرافعة' }])).toContain('المرافعة');
  });
  it('الملف يُذكر باسمه', () => {
    expect(docxBody([{ type: 'file', url: 'https://naf.sa/f.pdf', title: 'نموذج العقد' }])).toContain('نموذج العقد');
  });
  it('الفيديو يُذكر برابطه', () => {
    expect(docxBody([{ type: 'video', url: 'https://youtu.be/abc123XY' }])).toContain('abc123XY');
  });
  it('الفهرس يُبنى من العناوين', () => {
    const x = docxBody([{ type: 'toc' }, { type: 'heading', text: 'التمهيد', level: 2 }]);
    expect(x).toContain('المحتويات');
    expect(x).toContain('التمهيد');
  });
});
