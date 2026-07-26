/* يولّد ورقة أنماط للصفحات العامة المُخدَّمة من الخادم (صفحات المقالات).
 *
 * لماذا: تلك الصفحات HTML يبنيها الـ Worker، فلا تمرّ بـ Vite ولا تستطيع
 * استيراد naf-theme.css مباشرةً (يبدأ بـ @import "tailwindcss").
 *
 * الحل: تُستخرج كتلتا :root و.dark من ملف الثيم كما هي، ويُنسخ خطّ ناف
 * المستضاف ذاتياً. المخرَج **مولَّد لا مكتوب بيد** — السجلّ يبقى المصدر
 * الوحيد، وتغيير رمز في naf-theme.css ينتقل هنا بإعادة البناء وحدها.
 *
 * لا تعدّل web/public/naf-public.css — أي تعديل يضيع في البناء التالي.
 */
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '..');
const themePath = resolve(webRoot, 'src/naf-theme.css');
const fontPkg = resolve(webRoot, 'node_modules/@fontsource/ibm-plex-sans-arabic');
const outDir = resolve(webRoot, 'public');
const fontsOut = resolve(outDir, 'fonts');

/** يقتطع كتلة `<selector> { … }` من نص CSS مع احترام تداخل الأقواس. */
function extractBlock(css, selector) {
  const start = css.indexOf(selector + ' {');
  if (start === -1) throw new Error(`لم يُعثر على الكتلة ${selector} في naf-theme.css`);
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(start, i + 1);
    }
  }
  throw new Error(`كتلة ${selector} غير مغلقة`);
}

const theme = readFileSync(themePath, 'utf8');
const root = extractBlock(theme, ':root');
const dark = extractBlock(theme, '.dark');

const WEIGHTS = ['400', '500', '600', '700'];
// تُنسخ المجموعتان المستعملتان فقط — لا كل مجموعات المحارف في الحزمة.
mkdirSync(resolve(fontsOut, 'files'), { recursive: true });
for (const w of WEIGHTS) {
  for (const subset of ['arabic', 'latin']) {
    copyFileSync(resolve(fontPkg, `${subset}-${w}.css`), resolve(fontsOut, `${subset}-${w}.css`));
    for (const ext of ['woff2', 'woff']) {
      const file = `ibm-plex-sans-arabic-${subset}-${w}-normal.${ext}`;
      copyFileSync(resolve(fontPkg, 'files', file), resolve(fontsOut, 'files', file));
    }
  }
}

const imports = WEIGHTS.flatMap((w) => [
  `@import "./fonts/arabic-${w}.css";`,
  `@import "./fonts/latin-${w}.css";`,
]).join('\n');

const out = `/* ملف مولَّد — لا تعدّله. المصدر: web/src/naf-theme.css من سجلّ ناف.
   أعد توليده بـ: npm run build:public-css */

${imports}

${root}

/* الوضع الداكن في الصفحات العامة يتبع تفضيل النظام — لا مبدّل فيها. */
@media (prefers-color-scheme: dark) {
  :root${dark.slice(dark.indexOf('{'))}
}
`;

writeFileSync(resolve(outDir, 'naf-public.css'), out, 'utf8');
console.log('كُتب public/naf-public.css و public/fonts');
