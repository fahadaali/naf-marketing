/* حارس الهوية — يمنع عودة الانحراف الذي أُغلق.
 *
 * سببه: CSS لا يخطئ بل يصمت. إعلانٌ غير صالح يسقطه المتصفّح بلا رسالة،
 * فيمرّ من البناء ومن tsc ومن الاختبارات. حدث فعلاً: شريط مخطّط جانت
 * بقي بلا لون عبر دفعات كاملة لأن رمزاً لُفّ في hsl() ورموز ناف oklch.
 *
 * يفحص أسطح الواجهة فقط. قوالب البريد مستثناة بنصّ CLAUDE.md §1 —
 * عملاء البريد لا يدعمون رموز CSS ولا الخصائص المنطقية.
 *
 * التشغيل: npm run check:identity
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();

/** أسطح الواجهة المفحوصة. */
const ROOTS = ['web/src'];
const EXTRA_FILES = ['src/routes/publicPages.ts', 'src/routes/basecamp.ts'];

/** ملفات السجلّ تُنسخ حرفياً ولا تُعدّل، فلا تُفحص. */
const SKIP_FILES = new Set(['naf-theme.css', 'naf-font.css']);

/** استثناءات منصوص عليها في CLAUDE.md §1 — كل سطر بسببه. */
const ALLOW = [
  {
    file: 'web/src/pages/Newsletters.tsx',
    rule: 'raw-color',
    why: 'معاينة رسالة بريد تطابق القالب حرفياً — لو تبعت الثيم لأظهرت غير ما يصل المشترك',
  },
  {
    file: 'web/src/platforms.tsx',
    rule: 'raw-color',
    why: 'الأبيض فوق خلفية علامة خارجية ثابتة في الوضعين — رمز الثيم ينقلب خطأً في الداكن',
  },
];

const CHECKS = [
  {
    rule: 'hsl-wrapper',
    re: /\bhsla?\(/,
    msg: 'رموز ناف قيم oklch كاملة. لفّها في hsl() يجعل الإعلان غير صالح فيسقط بصمت.',
    fix: 'استعمل الرمز مباشرةً: var(--info)',
  },
  {
    rule: 'raw-color',
    re: /#[0-9a-fA-F]{3,8}\b|\brgba?\(/,
    msg: 'قيمة لون خام.',
    fix: 'استعمل رمزاً من naf-theme.css، والشفافية بـ color-mix(in oklab, var(--x) N%, transparent)',
  },
  {
    rule: 'physical-direction',
    re: /\b(margin|padding|border)-(left|right)\b|\b(marginLeft|marginRight|paddingLeft|paddingRight|borderLeft|borderRight)\b|text-align:\s*(left|right)\b|textAlign:\s*['"](left|right)['"]/,
    msg: 'خاصية اتجاه فيزيائية تكسر التخطيط في RTL.',
    fix: 'استعمل المنطقية: margin-inline-start · padding-inline-end · border-inline-start · text-align: start',
  },
  {
    rule: 'glyph-icon',
    // إيموجي، ومحارف بعينها استُعملت مقام أيقونة. القائمة صريحة لا نطاقات
    // واسعة: «» و— و… طباعةٌ عربية سليمة ولا يجوز أن تُمسك.
    re: /[★☆✦✧●○◆◇■□▪▫✓✔✗✕✖→←↑↓⇒⇐⟵⟶‹›]|[\u{1F300}-\u{1FAFF}]|[\u{2600}-\u{27BF}]/u,
    msg: 'إيموجي أو محرف يقوم مقام أيقونة. §3 يمنع الإيموجي في الواجهات بلا استثناء.',
    fix: 'استعمل أيقونة من Lucide مسجّلة في naf-icons.md',
  },
  {
    rule: 'arabic-indic-digits',
    re: /[٠-٩]/,
    msg: 'أرقام هندية في نصّ ظاهر. naf-terms §5: أرقام غربية دائماً.',
    fix: 'اكتب 123 لا ١٢٣، والأرقام المحسوبة عبر formatNumber من naf-format',
  },
];

/** التعليقات البرمجية ليست واجهة — تُنزع قبل الفحص لا تُتخطّى بالسطر،
 *  لأن التعليق قد يذيّل سطر كود. النزع يحافظ على أرقام الأسطر. */
function stripComments(source) {
  let out = source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, (m) => m.replace(/[^\n]/g, ' '));
  out = out
    .split('\n')
    .map((line) => {
      // شرطتان مائلتان خارج نصّ — تقدير كافٍ لهذا الغرض
      const i = line.indexOf('//');
      if (i === -1) return line;
      const before = line.slice(0, i);
      const quotes = (before.match(/['"`]/g) || []).length;
      return quotes % 2 === 0 ? before : line;
    })
    .join('\n');
  return out;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|css)$/.test(name) && !SKIP_FILES.has(name)) out.push(full);
  }
  return out;
}

const files = [...ROOTS.flatMap((d) => walk(join(root, d))), ...EXTRA_FILES.map((f) => join(root, f))];

const violations = [];
for (const full of files) {
  const rel = relative(root, full);
  const lines = stripComments(readFileSync(full, 'utf8')).split('\n');
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    for (const check of CHECKS) {
      if (!check.re.test(line)) continue;
      if (ALLOW.some((a) => a.file === rel && a.rule === check.rule)) continue;
      violations.push({ rel, line: i + 1, check, text: line.trim().slice(0, 100) });
    }
  });
}

if (violations.length === 0) {
  console.log(`حارس الهوية: نظيف — ${files.length} ملفاً.`);
  process.exit(0);
}

console.error(`حارس الهوية: ${violations.length} مخالفة.\n`);
for (const v of violations) {
  console.error(`${v.rel}:${v.line}  [${v.check.rule}]`);
  console.error(`  ${v.text}`);
  console.error(`  ${v.check.msg}`);
  console.error(`  الصحيح: ${v.check.fix}\n`);
}
console.error('لو كانت المخالفة استثناءً منصوصاً عليه في CLAUDE.md §1، أضفها إلى ALLOW في هذا الملف مع سببها.');
process.exit(1);
