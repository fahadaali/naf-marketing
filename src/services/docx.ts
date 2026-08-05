import { zipStore } from './xlsx';
import type { Block } from './newsletter';
import { stripInline } from './inline';

/* ===== تصدير المقالة مستنداً Word =====

   حاوية OOXML صغيرة تُبنى بنفس zipStore الذي يبني ملف xlsx — الصيغتان
   حزمة واحدة في جوهرها، وبناء ثانٍ لها هو ما يُنتج نسختين تتباعدان.

   والمستند المولَّد يقع تحت استثناء الطباعة في CLAUDE.md §1: لا يقرأ
   رموز CSS، ويبقى فاتحاً مهما كان وضع القارئ — مذكّرةٌ داكنة لا تُقدَّم.
   ولا قيمة لون هنا أصلاً: Word يحمل أنماطه في styles.xml، والمستند
   أسودُ على أبيض بلا تلوين.

   والاتجاه RTL مكتوب صراحةً في كل فقرة (bidi وrtl): Word لا يستنتج
   اتجاه الفقرة من محتواها، وفقرةٌ بلا تصريح تبدأ يساراً ولو كان نصّها
   عربياً كلّه. */

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

const enc = (s: string) => new TextEncoder().encode(s);

/* فقرة. `style` اسم نمط مسجَّل في styles.xml، وrtl يفرض الاتجاه.
   والنصّ يُقسَّم على الأسطر: Word لا يفهم \n داخل w:t. */
function para(text: string, style?: string): string {
  const runs = String(text ?? '')
    .split('\n')
    .map((line, i) => (i ? '<w:r><w:br/></w:r>' : '') + `<w:r><w:t xml:space="preserve">${esc(line)}</w:t></w:r>`)
    .join('');
  return `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}<w:bidi/><w:jc w:val="both"/></w:pPr>${runs}</w:p>`;
}

function tableXml(rows: string[][], header?: boolean): string {
  const cell = (v: string, head: boolean) =>
    `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${para(v, head ? 'Strong' : undefined)}</w:tc>`;
  const body = rows
    .map((r, ri) => `<w:tr>${r.map((v) => cell(v, !!header && ri === 0)).join('')}</w:tr>`)
    .join('');
  // bidiVisual يعكس ترتيب الأعمدة — بدونه يبدأ الجدول العربي من اليسار
  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:bidiVisual/>` +
    `<w:tblW w:w="5000" w:type="pct"/></w:tblPr>${body}</w:tbl>`;
}

/** يحوّل كتل المقالة إلى جسم المستند. */
function bodyXml(title: string, blocks: Block[]): string {
  const out: string[] = [para(title, 'Title')];
  let noteNo = 0;
  const notes: string[] = [];

  for (const b of blocks) {
    switch (b.type) {
      case 'heading':
        out.push(para(b.text, b.level === 3 ? 'Heading2' : 'Heading1'));
        break;
      case 'text':
        for (const p of String(b.text || '').split(/\n{2,}/)) if (p.trim()) out.push(para(stripInline(p)));
        break;
      case 'quote':
        out.push(para(stripInline(b.text) + (b.cite ? ` — ${b.cite}` : ''), 'Quote'));
        break;
      case 'callout':
        out.push(para((b.title ? `${b.title}: ` : '') + stripInline(b.text), 'Quote'));
        break;
      case 'code':
        // الكود لا يُجرَّد ولا يُبرَّر: نجمةٌ فيه نجمة، وتبريره يفسد محاذاته
        out.push(`<w:p><w:pPr><w:pStyle w:val="Code"/></w:pPr>` +
          String(b.text || '').split('\n')
            .map((l, i) => (i ? '<w:r><w:br/></w:r>' : '') + `<w:r><w:t xml:space="preserve">${esc(l)}</w:t></w:r>`)
            .join('') + '</w:p>');
        break;
      case 'table':
        if (Array.isArray(b.rows) && b.rows.length) out.push(tableXml(b.rows.map((r) => r.map(stripInline)), b.header));
        break;
      case 'checklist':
        for (const it of b.items || []) out.push(para(`${it.done ? '[x]' : '[ ]'} ${stripInline(it.text || '')}`));
        break;
      case 'columns':
        // المستند عمودٌ واحد: عمودان في صفحة A4 عربية يضيّقان السطر
        // دون قراءة. يُدمجان فقرتين متتاليتين.
        out.push(para(stripInline(b.start)), para(stripInline(b.end)));
        break;
      case 'button':
      case 'embed':
        if (b.url) out.push(para(`${(b as any).text || (b as any).title || 'رابط'}: ${b.url}`));
        break;
      case 'image':
        // الصورة لا تُضمَّن: تضمينها يحتاج جلبها وقياسها وربطها في
        // relationships. تُذكر بوصفها البديل كي لا يختفي معناها صامتاً.
        if (b.alt || b.caption) out.push(para(`[صورة: ${b.alt || b.caption}]`, 'Quote'));
        break;
      case 'footnote':
        noteNo += 1;
        notes.push(`${noteNo}. ${stripInline(b.text)}`);
        out.push(para(`(${noteNo})`));
        break;
      case 'divider':
        out.push(para('—'));
        break;
    }
  }

  if (notes.length) {
    out.push(para('الحواشي', 'Heading1'));
    for (const n of notes) out.push(para(n));
  }

  // sectPr: A4 مع اتجاه الصفحة RTL
  return `<w:body>${out.join('')}<w:sectPr><w:bidi/>` +
    `<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>` +
    `</w:sectPr></w:body>`;
}

const CONTENT_TYPES = `${XML_HEAD}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const ROOT_RELS = `${XML_HEAD}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOC_RELS = `${XML_HEAD}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

/* الأنماط. الخط أحاديّ للكود ونسخيّ لما عداه — وهذا ليس خرقاً لقاعدة
   «عائلة واحدة»: تلك تحكم الواجهة، والمستند يُفتح في Word على جهاز
   القارئ حيث خطّ ناف غير مثبَّت أصلاً. */
const STYLES = `${XML_HEAD}
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr>
<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Traditional Arabic"/>
<w:sz w:val="24"/><w:szCs w:val="28"/><w:lang w:bidi="ar-SA"/>
</w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/>
<w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="40"/><w:szCs w:val="44"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>
<w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="32"/><w:szCs w:val="34"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/>
<w:pPr><w:spacing w:before="200" w:after="100"/></w:pPr><w:rPr><w:b/><w:bCs/><w:sz w:val="28"/><w:szCs w:val="30"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/>
<w:pPr><w:ind w:start="454"/><w:spacing w:before="120" w:after="120"/></w:pPr><w:rPr><w:i/><w:iCs/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/>
<w:pPr><w:spacing w:before="120" w:after="120"/></w:pPr>
<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Strong"><w:name w:val="Strong"/><w:rPr><w:b/><w:bCs/></w:rPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/>
<w:tblPr><w:tblBorders>
<w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:start w:val="single" w:sz="4" w:space="0" w:color="auto"/>
<w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:end w:val="single" w:sz="4" w:space="0" w:color="auto"/>
<w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/>
</w:tblBorders></w:tblPr></w:style>
</w:styles>`;

/** يبني مستند Word من عنوان المقالة وكتلها. */
export function buildDocx(title: string, blocks: Block[]): Uint8Array {
  const document = `${XML_HEAD}
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${bodyXml(title, blocks)}</w:document>`;
  return zipStore([
    { name: '[Content_Types].xml', data: enc(CONTENT_TYPES) },
    { name: '_rels/.rels', data: enc(ROOT_RELS) },
    { name: 'word/_rels/document.xml.rels', data: enc(DOC_RELS) },
    { name: 'word/styles.xml', data: enc(STYLES) },
    { name: 'word/document.xml', data: enc(document) },
  ]);
}
