// عقدُ الأسرار: ما يقرؤه الكود هو ما يذكره ملفّ المثال، لا أكثر ولا أقلّ.
//
// كانت قائمة الأسرار مكتوبةً في ثلاثة مواضع — `src/types.ts` و`README.md`
// و`.dev.vars.example` — فافترقت: سرّان يقرؤهما الكود ولا يذكرهما ملفّ
// المثال، وثالثٌ في README بلا مقابل. ومن أعدّ بيئته من ملفّ المثال وحده،
// وهو ما يقوله README، لم يعرف بوجودهما.
//
// وغيابُ سرٍّ لا يظهر خطأً واضحاً: ميزةٌ تصمت، أو نقطةٌ تردّ ٥٠٣، أو مصدرٌ
// يبقى «غير مربوط» — فيُقرأ الصمت إتقاناً ويُكتشف بعد النشر. فصار ملفّ
// المثال القائمةَ الوحيدة، وهذا الاختبار ما يمنعها أن تفترق ثانيةً.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const TYPES = readFileSync(join(ROOT, 'src', 'types.ts'), 'utf8');
const EXAMPLE = readFileSync(join(ROOT, '.dev.vars.example'), 'utf8');

/**
 * الأسرار المعلَنة في `Env` — ما بعد الوسم `// secrets` إلى آخر النوع.
 *
 * والوسم حدٌّ مقصود: ما قبله ارتباطاتٌ (قاعدة، وسائط، مساحة مفاتيح) ومتغيّرات
 * غير سرّية تُضبط في `wrangler.toml`، ولا مكان لها في `.dev.vars`.
 */
function declaredSecrets(): string[] {
  const start = TYPES.indexOf('// secrets');
  const end = TYPES.indexOf('\n};', start);
  // التعليقات تُطرح أوّلاً: اسمُ سرٍّ مذكورٌ في شرحٍ ليس إعلاناً عنه
  const region = TYPES.slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  return [...region.matchAll(/^\s*([A-Z][A-Z0-9_]*)\??\s*:\s*string/gm)].map((m) => m[1]);
}

/** الأسرار المذكورة في ملفّ المثال — أسطر الإسناد وحدها دون الشروح. */
function documentedSecrets(): string[] {
  return [...EXAMPLE.matchAll(/^([A-Z][A-Z0-9_]*)\s*=/gm)].map((m) => m[1]);
}

describe('عقد الأسرار', () => {
  /* يسبق كل شيء: تحليلٌ لا يجد شيئاً يجعل بقية الاختبارات تنجح بلا أن تفحص
     حرفاً. فلو نُقل الوسم أو أُعيدت هيكلة `Env`، يسقط هذا أوّلاً بسببه. */
  it('يقرأ الإعلانات من src/types.ts فعلاً', () => {
    const declared = declaredSecrets();
    expect(declared.length).toBeGreaterThan(10);
    expect(declared).toContain('CLAUDE_API_KEY');
    expect(declared).toContain('AUTH_CLIENT_SECRET');
    // ما قبل الوسم لا يُقرأ: ارتباطاتٌ ومتغيّراتٌ في wrangler.toml
    expect(declared).not.toContain('APP_NAME');
    expect(declared).not.toContain('PLATFORM_ID');
  });

  it('كل سرٍّ يقرؤه الكود مذكورٌ في .dev.vars.example', () => {
    const missing = declaredSecrets().filter((k) => !documentedSecrets().includes(k));
    expect(missing, `أسرارٌ في src/types.ts وليست في .dev.vars.example: ${missing.join('، ')}`).toEqual([]);
  });

  it('كل سطرٍ في .dev.vars.example يقابله سرٌّ يقرؤه الكود', () => {
    const stale = documentedSecrets().filter((k) => !declaredSecrets().includes(k));
    expect(stale, `أسطرٌ في .dev.vars.example بلا مقابل في src/types.ts: ${stale.join('، ')}`).toEqual([]);
  });

  it('لا سرَّ مكرَّراً في .dev.vars.example', () => {
    const seen = documentedSecrets();
    const duplicated = seen.filter((k, i) => seen.indexOf(k) !== i);
    // سطران بالاسم نفسه: الثاني يمحو الأول صامتاً، ومن يعدّل الأول لا يرى أثراً
    expect([...new Set(duplicated)]).toEqual([]);
  });
});
