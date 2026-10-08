/* قالب استيراد خطة المحتوى — naf-terms «قالب الاستيراد» (v1.62.0).

   سبعة أعمدة بترتيبٍ ثابت، يُنزَّل بها القالب فارغاً ويُصدَّر بها المحتوى، فما
   يُصدَّر يُعاد استيراده بعد تعديله في Excel. والإلزاميّ العنوان والتاريخ وحدهما.
   دوالّ صافية بلا React تُختبر من `test/`؛ والحفظ والقراءة من الملف في
   `components/PlanImport.tsx`. */

import { importDay, exportDay, type ImportRow } from './planning';
import { parsePlatforms } from './campaigns';

/** عناوين الأعمدة كما في السجلّ، وبهذا الترتيب. */
export const PLAN_TEMPLATE_HEADERS = ['العنوان', 'التاريخ', 'الشكل', 'المنصات', 'السلسلة', 'الفكرة', 'مسؤول التنفيذ'] as const;

/** عرض كل عمود في ورقة Excel بعدد المحارف — العنوان والفكرة أعرضها. */
export const PLAN_TEMPLATE_WIDTHS = [40, 14, 14, 24, 20, 48, 20];

/** اسم الورقة في الملف — «خطة المحتوى» مسجّلةٌ اسماً للطبقة في التقويم. */
export const PLAN_SHEET_NAME = 'خطة المحتوى';

type PlanPost = {
  title?: string | null; planned_on?: string | null; format?: string | null; content_type?: string | null;
  planned_platforms?: string | null; pillar?: string | null; brief?: string | null; assignee_name?: string | null;
};

/** صفوف الملف: الرؤوس ثم صفٌّ لكل عنصر، والقيم أسماءٌ كما تظهر في المنصة. */
export function planTemplateRows(
  posts: readonly PlanPost[],
  names: { format: (key: string) => string; platform: (key: string) => string },
): string[][] {
  return [
    [...PLAN_TEMPLATE_HEADERS],
    ...posts.map((p) => {
      const format = p.format || p.content_type || '';
      return [
        p.title || '',
        exportDay(p.planned_on),
        format ? names.format(format) : '',
        parsePlatforms(p.planned_platforms).map(names.platform).join('، '),
        p.pillar || '',
        p.brief || '',
        p.assignee_name || '',
      ];
    }),
  ];
}

/** علامةُ ترتيب البايتات — بدونها يقرأ Excel العربية محارفَ مبعثرة. */
const BOM = '﻿';

/** صفوفٌ ← نصّ CSV يفتحه Excel بالعربية سليمةً، وكل خليةٍ بين علامتي تنصيص. */
export function toCsv(rows: readonly (readonly string[])[]): string {
  const esc = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return BOM + rows.map((r) => r.map(esc).join(',')).join('\r\n');
}

/**
 * نصّ CSV ← صفوف. الفاصل يُكتشف من السطر الأول: Excel في إعداداتٍ إقليمية
 * كثيرة يحفظ بالفاصلة المنقوطة لا بالفاصلة، وملفٌّ كهذا كان يُقرأ عموداً واحداً.
 */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const first = src.slice(0, src.search(/\r?\n|$/));
  const count = (ch: string) => first.split(ch).length - 1;
  const delim = [',', ';', '\t'].reduce((a, b) => (count(b) > count(a) ? b : a), ',');
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') q = false;
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { cur.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (field !== '' || cur.length) { cur.push(field); rows.push(cur); cur = []; field = ''; }
      if (ch === '\r' && src[i + 1] === '\n') i++;
    } else field += ch;
  }
  if (field !== '' || cur.length) { cur.push(field); rows.push(cur); }
  return rows;
}

/**
 * بايتات ملف CSV ← نصّ. Excel العربي يحفظ «CSV» العادي بترميز Windows-1256
 * لا UTF-8، فيصل الملف حروفاً مبعثرة؛ فإن لم يكن UTF-8 سليماً قُرئ بذاك.
 */
export function decodeCsv(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1256').decode(bytes);
  }
}

/**
 * الصفوف الصالحة للقالب: لكلٍّ عنوانٌ ويومٌ مقروء. وما ينقصه أحدهما يُترك
 * ويُعدّ — صفٌّ ناقص لا يُسقط الملف كلّه (naf-terms «صفوف متروكة في الاستيراد»).
 */
export function requireTitleAndDay(rows: readonly ImportRow[]): { valid: ImportRow[]; skipped: number } {
  const valid = rows.filter((r) => !!r.title?.trim() && !!r.planned_on && importDay(r.planned_on) !== null);
  return { valid, skipped: rows.length - valid.length };
}
