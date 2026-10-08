// قارئ ملفات .xlsx خفيف بلا اعتماديات — الورقة الأولى صفوفاً من النصوص.
//
// تستعمله الواجهة لاستيراد خطة المحتوى من Excel، وهو قرينُ `xlsx.ts` الذي يكتب
// الملف. والقراءة أوسع من الكتابة: Excel يحفظ مضغوطاً (deflate) لا مخزَّناً،
// ويكتب النصوص في جدول مشترك (`sharedStrings.xml`) لا داخل الخلية، ويحفظ
// التاريخ رقماً تسلسلياً — فيبقى رقماً هنا، ويحوّله الاستيراد إلى يوم.

type ZipEntry = { name: string; method: number; data: Uint8Array };

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/** مداخل الحاوية من فهرسها المركزي — أصحّ من الرؤوس المحلية التي قد تُترك أحجامها صفراً. */
function zipEntries(b: Uint8Array): ZipEntry[] {
  let end = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (u32(b, i) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new Error('not a zip');
  const count = u16(b, end + 10);
  let p = u32(b, end + 16);
  const out: ZipEntry[] = [];
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (u32(b, p) !== 0x02014b50) throw new Error('bad central directory');
    const method = u16(b, p + 10);
    const size = u32(b, p + 20);
    const nameLen = u16(b, p + 28);
    const extraLen = u16(b, p + 30);
    const commentLen = u16(b, p + 32);
    const local = u32(b, p + 42);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nameLen));
    const dataStart = local + 30 + u16(b, local + 26) + u16(b, local + 28);
    out.push({ name, method, data: b.subarray(dataStart, dataStart + size) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function inflate(e: ZipEntry): Promise<string> {
  if (e.method === 0) return new TextDecoder().decode(e.data);
  if (e.method !== 8) throw new Error(`unsupported compression ${e.method}`);
  const stream = new Blob([new Uint8Array(e.data)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e.toLowerCase()];
  });
}

/** نصّ عنصرٍ واحد: كل `<t>` فيه متتالية، بلا النطق المرافق `<rPh>`. */
function textOf(xml: string): string {
  const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '';
  for (const m of clean.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += m[1];
  return unescapeXml(out);
}

/** «AB12» ← رقم العمود من الصفر (27). */
function colIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** مسار الورقة الأولى بترتيب المصنّف لا بترتيب الحاوية. */
function firstSheetPath(files: Map<string, string>): string {
  const wb = files.get('xl/workbook.xml');
  const rels = files.get('xl/_rels/workbook.xml.rels');
  const rid = wb && /<sheet\b[^>]*\br:id="([^"]+)"/.exec(wb)?.[1];
  if (rid && rels) {
    const rel = new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*>`).exec(rels)?.[0];
    const target = rel && /Target="([^"]+)"/.exec(rel)?.[1];
    if (target) return target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  }
  return 'xl/worksheets/sheet1.xml';
}

/** الورقة الأولى من ملف .xlsx صفوفاً من النصوص، والخلايا الفارغة نصوصٌ فارغة. */
export async function readXlsx(bytes: Uint8Array): Promise<string[][]> {
  const entries = zipEntries(bytes);
  const wanted = (n: string) => n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || n === 'xl/sharedStrings.xml' || n.startsWith('xl/worksheets/');
  const files = new Map<string, string>();
  for (const e of entries) if (wanted(e.name)) files.set(e.name, await inflate(e));

  const shared = [...(files.get('xl/sharedStrings.xml') ?? '').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
  const sheet = files.get(firstSheetPath(files));
  if (!sheet) throw new Error('no worksheet');

  const rows: string[][] = [];
  for (const rm of sheet.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
    const r = Number(/\br="(\d+)"/.exec(rm[1])?.[1] ?? rows.length + 1) - 1;
    const row: string[] = [];
    let next = 0;
    for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const ci = ref ? colIndex(ref) : next;
      next = ci + 1;
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
      const inner = cm[2] ?? '';
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let val = '';
      if (type === 's') val = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') val = textOf(inner);
      else if (v !== undefined) val = unescapeXml(v);
      while (row.length < ci) row.push('');
      row[ci] = val;
    }
    while (rows.length < r) rows.push([]);
    rows[r] = row;
  }
  return rows;
}
