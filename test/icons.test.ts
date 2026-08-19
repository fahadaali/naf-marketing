// خريطة الأيقونات — «معنًى واحد، أيقونة واحدة، عبر المنصات الخمس».
//
// ‏CLAUDE.md §٣ و§١٠ بند ٩. وكان في الواجهة عشرُ أيقوناتٍ مستعمَلة لا
// ذكر لها في `naf-icons.md` — وإحداها يصفها تعليقٌ في الشيفرة بأنها
// «المسجّلة لهذا» وهي ليست مسجَّلة. وهذا الاختبار يمنع تكرارها في
// الاتجاهين: أيقونةٌ تُستعمل بلا تسجيل، واسمٌ يُسجَّل ولا تعرفه الحزمة.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = join(import.meta.dirname, '..');
const WEB = join(ROOT, 'web', 'src');
const MAP = readFileSync(join(ROOT, 'naf-icons.md'), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

/** كل ما يُستورد من lucide-react في الواجهة، بأسمائه بعد فكّ الكنية. */
function imported(): Map<string, string[]> {
  const byName = new Map<string, string[]>();
  for (const file of walk(WEB)) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/import\s+\{([^}]*)\}\s+from\s+'lucide-react'/g)) {
      for (const raw of m[1].split(',')) {
        // `Search as SearchIcon` → الاسم الأصلي وحده هو ما يُسجَّل
        const name = raw.trim().split(/\s+as\s+/)[0].trim();
        if (!name || name === 'type') continue;
        if (!/^[A-Z]/.test(name)) continue; // `type LucideIcon` ونحوه
        byName.set(name, [...(byName.get(name) ?? []), file.replace(`${ROOT}/`, '')]);
      }
    }
  }
  return byName;
}

/** الأسماء المذكورة في الخريطة بين علامتَي `…`. */
function registered(): Set<string> {
  return new Set([...MAP.matchAll(/`([A-Z][A-Za-z0-9]*)`/g)].map((m) => m[1]));
}

describe('naf-icons.md', () => {
  const used = imported();
  const known = registered();

  it('كل أيقونة مستعمَلة مسجَّلة في الخريطة', () => {
    const orphans = [...used.entries()]
      .filter(([name]) => !known.has(name))
      .map(([name, files]) => `${name}  ← ${files[0]}`);
    expect(orphans, 'سجّلها في naf-icons.md أوّلاً — السجلّ يسبق المنصة').toEqual([]);
  });

  it('كل اسمٍ في الخريطة تعرفه الحزمة المثبّتة', () => {
    // الحزمة في `web/node_modules` لا في جذر المستودع — حزمتان لا واحدة
    const req = createRequire(join(ROOT, 'web', 'package.json'));
    const mod = req('lucide-react') as Record<string, unknown>;
    /* أسماءٌ تُذكر في الخريطة وصفاً لا استعمالاً:
       — `AlignLeft`/`AlignRight` كنيتان مهجورتان نُصّ على تركهما.
       — وشعارات العلامات حذفتها Lucide 1.x بلا بديل، وذكرُها في قسم
         «شعارات المنصات» هو بيانُ حذفها نفسه وسببُ وجود `naf-brand-marks`. */
    const documented = new Set([
      'AlignLeft', 'AlignRight',
      'Facebook', 'Instagram', 'Youtube', 'Linkedin',
    ]);
    const unknown = [...known].filter((n) => !documented.has(n) && !(n in mod));
    expect(unknown, 'اسمٌ مسجَّل لا تعرفه lucide-react المثبّتة').toEqual([]);
  });

  it('لا استيراد أيقونات من غير lucide-react', () => {
    const bad: string[] = [];
    for (const file of walk(WEB)) {
      const src = readFileSync(file, 'utf8');
      if (/from\s+'(react-icons|@heroicons|feather-icons|@tabler\/icons)/.test(src)) {
        bad.push(file.replace(`${ROOT}/`, ''));
      }
    }
    expect(bad, 'العائلة المعتمدة Lucide — واحدة فقط، بلا استثناء').toEqual([]);
  });

  it('لا إيموجي في الواجهة', () => {
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
    const hits: string[] = [];
    for (const file of walk(WEB)) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (emoji.test(line)) hits.push(`${file.replace(`${ROOT}/`, '')}:${i + 1}`);
      });
    }
    expect(hits, 'الإيموجي ممنوعة في واجهات ناف بلا استثناء — CLAUDE.md §٣').toEqual([]);
  });
});
