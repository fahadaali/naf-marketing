// قالب استيراد خطة المحتوى: الأعمدة السبعة، وCSV وExcel ذهاباً وإياباً، والإلزاميّ.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync, crc32 } from 'node:zlib';
import {
  PLAN_TEMPLATE_HEADERS, planTemplateRows, toCsv, parseCsv, decodeCsv, requireTitleAndDay,
} from '../web/src/planTemplate';
import { importDay, rowsFromTable, mapImportRow } from '../web/src/planning';
import { buildXlsx } from '../src/services/xlsx';
import { readXlsx } from '../src/services/xlsxRead';

const ROOT = join(import.meta.dirname, '..');

describe('أعمدة القالب', () => {
  it('نسخة السجلّ حرفياً وبترتيبها', () => {
    const md = readFileSync(join(ROOT, 'naf-terms.md'), 'utf8');
    const section = md.slice(md.indexOf('### قالب الاستيراد\n'));
    const cols: string[] = [];
    for (const line of section.split('\n').slice(1)) {
      const m = /^\| ([^|]+?) \| [^|]+ \| (نعم|لا) \|$/.exec(line);
      if (m) cols.push(m[1]);
      else if (cols.length && !line.startsWith('|')) break;
    }
    expect(cols).toEqual([...PLAN_TEMPLATE_HEADERS]);
  });

  it('عناوين القالب تُقرأ إلى حقولها، والأسماء الكاملة والقديمة كذلك', () => {
    const [row] = rowsFromTable([
      [...PLAN_TEMPLATE_HEADERS],
      ['دليل الاشتراك', '2026/10/31', 'كاروسيل', 'إكس، لينكدإن', 'توعية نظامية', 'تبسيط البنود', 'سارة'],
    ]);
    expect(row).toEqual({
      title: 'دليل الاشتراك', planned_on: '2026/10/31', format: 'كاروسيل', planned_platforms: 'إكس، لينكدإن',
      pillar: 'توعية نظامية', brief: 'تبسيط البنود', assignee: 'سارة',
    });
    const [old] = rowsFromTable([['العنوان', 'يوم النشر المستهدف', 'محور المحتوى', 'ملخّص الفكرة'], ['أ', '2026/10/31', 'س', 'ف']]);
    expect(old).toEqual({ title: 'أ', planned_on: '2026/10/31', pillar: 'س', brief: 'ف' });
  });

  it('التصدير بالأعمدة نفسها وقيمها أسماء، فيُعاد استيراده', () => {
    const rows = planTemplateRows(
      [{ title: 'فكرة', planned_on: '2026-10-31', format: 'carousel', planned_platforms: '["x","linkedin"]', pillar: 'قصص عملاء', brief: null, assignee_name: 'سارة' }],
      { format: (k) => ({ carousel: 'كاروسيل' } as Record<string, string>)[k] ?? k, platform: (k) => ({ x: 'إكس', linkedin: 'لينكدإن' } as Record<string, string>)[k] ?? k },
    );
    expect(rows[0]).toEqual([...PLAN_TEMPLATE_HEADERS]);
    expect(rows[1]).toEqual(['فكرة', '2026/10/31', 'كاروسيل', 'إكس، لينكدإن', 'قصص عملاء', '', 'سارة']);

    const [back] = rowsFromTable(rows);
    const { item, unmatched } = mapImportRow(back, {
      platforms: [{ key: 'x', label: 'إكس' }, { key: 'linkedin', label: 'لينكدإن' }],
      assignees: [{ id: 'u2', name: 'سارة' }], pillars: ['قصص عملاء'], campaigns: [], formats: { carousel: 'كاروسيل' },
    });
    expect(unmatched).toBe(0);
    expect(item).toMatchObject({ title: 'فكرة', planned_on: '2026-10-31', format: 'carousel', planned_platforms: ['x', 'linkedin'], pillar: 'قصص عملاء', assignee_id: 'u2' });
  });
});

describe('الإلزاميّ العنوان والتاريخ', () => {
  it('صفٌّ ينقصه أحدهما أو تاريخه غير مقروء يُترك ويُعدّ، والباقي فارغٌ جائز', () => {
    const { valid, skipped } = requireTitleAndDay([
      { title: 'تام', planned_on: '2026/10/31' },
      { title: 'بلا تاريخ' },
      { planned_on: '2026/10/31' },
      { title: 'تاريخ مشوّه', planned_on: 'الأسبوع القادم' },
      { title: '   ', planned_on: '2026/10/31' },
    ]);
    expect(valid.map((r) => r.title)).toEqual(['تام']);
    expect(skipped).toBe(4);
  });
});

describe('قراءة التاريخ', () => {
  it('صيغة التصدير، ويومٌ ثم شهر، وأرقامٌ هندية، ووقتٌ ملحق، ورقم Excel التسلسلي', () => {
    expect(importDay('2026/10/31')).toBe('2026-10-31');
    expect(importDay('2026-10-31')).toBe('2026-10-31');
    expect(importDay('31/10/2026')).toBe('2026-10-31');
    expect(importDay('٢٠٢٦/١٠/٣١')).toBe('2026-10-31');
    expect(importDay('2026-10-31 00:00:00')).toBe('2026-10-31');
    expect(importDay('46326')).toBe('2026-10-31');
  });

  it('ما لا يكون يوماً يُرفض ولا يُطوى', () => {
    expect(importDay('2026/02/30')).toBeNull();
    expect(importDay('12345')).toBeNull();
    expect(importDay('غداً')).toBeNull();
  });
});

describe('CSV', () => {
  it('ذهاباً وإياباً بالفواصل والتنصيص والأسطر، وعلامة البايتات تُزال', () => {
    const rows = [['العنوان', 'الفكرة'], ['أ، ب', 'سطر\nثانٍ و"اقتباس"']];
    const csv = toCsv(rows);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(parseCsv(csv)).toEqual(rows);
  });

  it('الفاصلة المنقوطة تُكتشف من السطر الأول', () => {
    expect(parseCsv('العنوان;التاريخ\nأ, ب;2026/10/31\n')).toEqual([['العنوان', 'التاريخ'], ['أ, ب', '2026/10/31']]);
  });

  it('ملف Excel العربي بترميز Windows-1256 يُقرأ سليماً', () => {
    expect(decodeCsv(new Uint8Array([0xc7, 0xe1, 0xda, 0xe4, 0xe6, 0xc7, 0xe4]))).toBe('العنوان');
    expect(decodeCsv(new TextEncoder().encode('العنوان'))).toBe('العنوان');
  });
});

/** حاوية zip مضغوطة (deflate) كما يحفظ Excel — لا «مخزَّنة» كما يكتب مولّدنا. */
function zipDeflate(files: Record<string, string>): Uint8Array {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text, 'utf8');
    const data = deflateRawSync(raw);
    const nameBuf = Buffer.from(name);
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(8, 10);
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(data.length, 20); cen.writeUInt32LE(raw.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28); cen.writeUInt32LE(offset, 42);
    parts.push(local, nameBuf, data);
    central.push(cen, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, cd, end]));
}

describe('Excel', () => {
  it('ما يكتبه مولّدنا يُقرأ كما هو — ورقةٌ من اليمين بعرض أعمدتها', async () => {
    const rows = [[...PLAN_TEMPLATE_HEADERS], ['فكرة & "عنوان"', '2026/10/31', '', 'إكس', '', '', '']];
    const bytes = buildXlsx([{ name: 'خطة المحتوى', rows, rtl: true, widths: [40, 14] }]);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('rightToLeft="1"');
    expect(text).toContain('<col min="1" max="1" width="40" customWidth="1"/>');
    const back = await readXlsx(bytes);
    expect(back[0]).toEqual(rows[0]);
    expect(back[1].slice(0, 4)).toEqual(['فكرة & "عنوان"', '2026/10/31', '', 'إكس']);
  });

  it('ملف Excel الحقيقي: مضغوط، ونصوصه في الجدول المشترك، وتاريخه رقمٌ تسلسلي، وخلاياه متفرّقة', async () => {
    const shared = PLAN_TEMPLATE_HEADERS.map((h) => `<si><t>${h}</t></si>`).join('') +
      '<si><r><t>دليل </t></r><r><rPr><b/></rPr><t>الاشتراك</t></r><rPh><t>x</t></rPh></si>';
    const file = zipDeflate({
      '[Content_Types].xml': '<Types/>',
      'xl/workbook.xml': '<workbook xmlns:r="r"><sheets><sheet name="خطة" sheetId="1" r:id="rId7"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId7" Type="ws" Target="worksheets/sheet3.xml"/></Relationships>',
      'xl/sharedStrings.xml': `<sst>${shared}</sst>`,
      'xl/worksheets/sheet3.xml':
        '<worksheet><sheetData>' +
        `<row r="1">${PLAN_TEMPLATE_HEADERS.map((_, i) => `<c r="${String.fromCharCode(65 + i)}1" t="s"><v>${i}</v></c>`).join('')}</row>` +
        '<row r="2"><c r="A2" t="s"><v>7</v></c><c r="B2" s="3"><v>46326</v></c><c r="G2" t="inlineStr"><is><t>سارة</t></is></c></row>' +
        '</sheetData></worksheet>',
    });
    const table = await readXlsx(file);
    expect(table[0]).toEqual([...PLAN_TEMPLATE_HEADERS]);
    expect(table[1]).toEqual(['دليل الاشتراك', '46326', '', '', '', '', 'سارة']);
    const { valid } = requireTitleAndDay(rowsFromTable(table));
    expect(valid).toHaveLength(1);
    expect(importDay(valid[0].planned_on!)).toBe('2026-10-31');
  });

  it('ما ليس ملف Excel يُرفض ولا يُقرأ صفوفاً', async () => {
    await expect(readXlsx(new TextEncoder().encode('العنوان,التاريخ'))).rejects.toThrow();
  });
});
