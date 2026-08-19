// لا مربّعات متصفح في الواجهة.
//
// ‏`ConfirmModal` و`FieldModal` بُنيا ليحلّا محلّ `confirm` و`prompt`،
// وسببُهما مكتوبٌ في رأس الملف: مربّعٌ بخطّ النظام لا بخطّنا، وأزراره
// «موافق/إلغاء» بلغة المتصفح لا بلغة المستخدم، ولا يقبل عنواناً ولا
// وصفاً ولا زرّاً باسم الفعل — فيسقط منه كلّ ما يفرضه naf-terms §٤
// دفعةً واحدة. ولا يتبع الاتجاه ولا الوضعين.
//
// ثم اعتُمدا في النشرات وحدها، وبقي ثلاثة عشر نداءً في أربع شاشات —
// منها سبب رفضٍ **إلزامي** يُطلب بـ`prompt` وهو بلا تحقّق ولا رسالة.
// هذا الاختبار يمنع عودتها.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const WEB = join(import.meta.dirname, '..', 'web', 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p)) out.push(p);
  }
  return out;
}

/** يُسقط التعليقات كي لا يُحسب شرحُ المنع منعاً. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('مربّعات المتصفح', () => {
  it('لا نداء لـ confirm أو prompt أو alert في أي شاشة', () => {
    const hits: string[] = [];
    for (const file of walk(WEB)) {
      const lines = code(readFileSync(file, 'utf8')).split('\n');
      lines.forEach((line, i) => {
        // نداءٌ مجرَّد لا `x.confirm(` ولا `setConfirming(`
        if (/(^|[^.\w])(confirm|prompt|alert)\s*\(/.test(line)) {
          hits.push(`${file.replace(`${WEB}/`, '')}:${i + 1}  ${line.trim().slice(0, 80)}`);
        }
      });
    }
    expect(hits, 'استعمل ConfirmModal أو FieldModal بدلها').toEqual([]);
  });

  it('البديلان المسجَّلان موجودان ويُصدَّران', () => {
    const src = readFileSync(join(WEB, 'components', 'ConfirmModal.tsx'), 'utf8');
    expect(src).toContain('export default function ConfirmModal');
    expect(src).toContain('export function FieldModal');
    // زرُّ التأكيد يحمل اسم الفعل لا «نعم» — naf-terms §٤
    expect(src).toContain('actionLabel');
  });
});
